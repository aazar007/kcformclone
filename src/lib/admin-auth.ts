/**
 * The admin gate.
 *
 * The secret never leaves the server: the browser posts it once, the API checks
 * it, and every subsequent write carries it in the `x-admin-secret` header. The
 * admin console therefore cannot be "unlocked" by editing client state — the
 * server refuses the write regardless.
 */

import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { databaseConfigured } from "@/lib/db";
import { isCredentialHash, verifyCredential } from "@/lib/admin-credential";
import { clearFailures, clientKey, lockoutSeconds, recordFailure } from "@/lib/rate-limit";
import {
  addAdminFailure,
  clearAdminFailures,
  countAllAdminFailures,
  readAdminCredential,
  recentAdminFailures,
} from "@/lib/store";
import { getEnv } from "@/lib/env";

/**
 * The optional pepper for the stored grand admin password.
 *
 * **Its own variable, and empty by default.** It used to be derived from `ADMIN_SECRET`, and
 * that coupling was a real defect: a password set where one `ADMIN_SECRET` was in force simply
 * stopped verifying where another was — a local password failing on a deployment — with no
 * error and nothing on screen to explain it. The symptom is "the password is wrong", which
 * sends you looking in entirely the wrong place. Twice.
 *
 * So the default is no pepper, and the password then depends only on itself and the database.
 * Set `ADMIN_PEPPER` (the same value everywhere) to turn it on — a stolen database can then
 * not be tested against a guess at all, at the cost of one more value to keep in step. That is
 * now a choice with a name, rather than a side effect of a variable that means something else.
 *
 * A password hashed *with* a pepper cannot be verified without it; that case is reported
 * rather than silently refused, because "wrong password" is the one message it must not be
 * mistaken for.
 */
export async function adminPepper(): Promise<Buffer> {
  const configured = (await getEnv("ADMIN_PEPPER"))?.trim();
  if (!configured) return Buffer.alloc(0);
  /* Hashed rather than used raw, so the value in the environment is not itself the key
     material, and so a short passphrase-style pepper still yields a full-length key. */
  return createHmac("sha256", "ksu-crown-admin-pepper:v1").update(configured).digest();
}

/**
 * Check a candidate against the grand admin's **stored password**.
 *
 * **The hashed password is the credential.** `ADMIN_SECRET` is not a way in once a
 * password exists — it is only the *bootstrap*: on a deployment that has never had a
 * password set, the secret is accepted so that somebody can get in and set one. After
 * that first setting, the console password is the only thing the sign-in form accepts.
 *
 * That ordering matters for what a leaked secret is worth. While `ADMIN_SECRET` was a
 * permanent alternative, holding it meant owning the console for ever, and no password
 * rotation could take that away — which defeated the point of having a password at all.
 * Now the secret is worth exactly one thing: access to a deployment whose password has
 * never been set.
 *
 * Three distinct outcomes, and the difference between them is deliberate:
 *
 * - **A password row exists and is valid** — only it decides. A wrong password is a wrong
 *   password, even when the deployment secret would have matched.
 * - **The row exists but is not in our format** — refused, and reported. Falling through
 *   to the secret here would hide a broken credential behind one that still worked, which
 *   is how a "wrong password" report becomes unfixable.
 * - **No row at all** — bootstrap: the deployment secret is accepted, and a warning says a
 *   password should be set. This is the fresh-deployment path, not a second credential.
 *
 * A database that is configured but **unreachable** is not "no row": it is refused. The
 * alternative would silently promote the secret back to a full credential whenever the
 * database hiccuped, which is the exact behaviour this function exists to remove.
 *
 * Deliberately async-only for show: scrypt is slow by design, and doing it on the thread
 * that serves every other request would make one organiser's sign-in everyone's delay.
 */
export async function verifyAdminCredentials(candidate: string): Promise<boolean> {
  /* No database configured at all — a fresh clone, or local development. There is nowhere
     a password could be stored, so the secret is all there is. */
  if (!(await databaseConfigured())) return checkEnvAdminSecret(candidate);

  let stored: Awaited<ReturnType<typeof readAdminCredential>>;
  try {
    /* `readAdminCredential`, not `getAdminCredential`: the latter answers null for a read
       failure as well as for a missing row, and here those two mean opposite things —
       "no row" is the bootstrap exception, "could not read" must refuse. */
    stored = await readAdminCredential();
  } catch (error) {
    /* Configured but unreachable: fail closed. See the note above — falling through to the
       secret would make an outage into a credential upgrade. */
    console.error("[admin-auth] could not read the stored grand admin password", error);
    return false;
  }

  if (!stored) {
    /* Bootstrap. Loud, because a deployment that stays this way is a deployment whose
       console opens with a value that may be in a shell history or a chat message. */
    console.warn(
      "[admin-auth] no grand admin password is set, so ADMIN_SECRET is accepted as the " +
        "bootstrap credential. Sign in and set a password from the console; after that " +
        "ADMIN_SECRET no longer signs in.",
    );
    return checkEnvAdminSecret(candidate);
  }

  if (!isCredentialHash(stored.passwordHash)) {
    console.error(
      "[admin-auth] the stored grand admin password is not in a recognised format. " +
        "Set it again with `npm run admin:reset`, or clear the AdminCredential row.",
    );
    return false;
  }

  return verifyCredential(stored.passwordHash, candidate, await adminPepper());
}

/**
 * Development fallback so a fresh clone is usable before anyone has thought
 * about secrets. Production requires a real one: without it the admin API
 * returns 503 rather than silently accepting a guessable default.
 */
export const DEV_ADMIN_SECRET = "crown-admin";

/** The expected admin secret, or null when admin access is not configured. */
export async function adminSecret(): Promise<string | null> {
  const configured = (await getEnv("ADMIN_SECRET"))?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return DEV_ADMIN_SECRET;
  return null;
}

/** True when the built-in development secret is what would be accepted. */
export async function usingDevSecret(): Promise<boolean> {
  return !(await getEnv("ADMIN_SECRET"))?.trim() && process.env.NODE_ENV !== "production";
}

/**
 * Every address the grand admin's second-factor code is sent to.
 *
 * `ADMIN_EMAIL` may name **more than one** grand admin: comma, semicolon or whitespace
 * separated, so `"a@ksu.edu.sa, b@ksu.edu.sa"` and a newline-separated list both work.
 * This exists because a tournament is rarely run by one person and the second factor is
 * the only way in — a single address means a single inbox, and an organiser who is asleep
 * (or has left the committee) holds the console shut for everybody else.
 *
 * Normalisation is deliberately forgiving about *shape* and strict about *meaning*:
 *
 * - `Ali <ali@ksu.edu.sa>` is understood, because that is what a mail client copies.
 * - Entries with no `@` are dropped. Keeping them would make `adminEmail()` return
 *   `"ali"` and the code would be sent nowhere; dropping them leaves that address
 *   unconfigured, which the console reports rather than pretends about.
 * - Order is preserved and duplicates collapse, because the first entry is the primary
 *   (see `adminEmail`) and it must not change just because a duplicate was pasted.
 *
 * Addresses are not validated beyond that: they are the operator's, typed into their own
 * deployment's environment, and the send either works or the error says so.
 */
export async function adminEmails(): Promise<string[]> {
  const raw = (await getEnv("ADMIN_EMAIL")) ?? "";
  const addresses: string[] = [];

  for (const entry of raw.split(/[\s,;]+/)) {
    /* `Ali <ali@ksu.edu.sa>` splits into `Ali` and `<ali@ksu.edu.sa>` on the space, so the
       bracketed form has to be unwrapped per token rather than per list entry. */
    const bracketed = /<([^<>]+)>/.exec(entry);
    const address = (bracketed ? bracketed[1] : entry).trim().toLowerCase();
    if (!address.includes("@")) continue;
    if (!addresses.includes(address)) addresses.push(address);
  }

  return addresses;
}

/**
 * The grand admin's primary address — the first one configured.
 *
 * The code is hashed against this address and stored under it, so it stays the single
 * anchor no matter how many inboxes receive a copy. `null` means none is configured,
 * which is what turns the second step off.
 */
export async function adminEmail(): Promise<string | null> {
  return (await adminEmails())[0] ?? null;
}

/** Whether an address belongs to a grand admin — used to keep staff grants from shadowing one. */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  const address = (email ?? "").trim().toLowerCase();
  return address.length > 0 && (await adminEmails()).includes(address);
}

/**
 * Whether the grand admin's sign-in is confirmed by an emailed code.
 *
 * **True exactly when there is somewhere to send the code** — so this answers "is the second
 * factor actually in force", not "ought it to be". Those came apart in production once and
 * it cost a lockout, which is the whole lesson recorded here.
 *
 * The earlier version returned true in production even with no address configured, and the
 * verify route then refused the sign-in outright. That reads as "fail closed", and it was
 * justified as not silently dropping a security step. In practice it locked the organiser
 * out of their own console with nothing working — not the password, not the deployment
 * secret — because one environment variable, whose absence looks like an omission rather
 * than a setting, was unset.
 *
 * Refusing bought nothing. An attacker holding the password gets no further with the sign-in
 * refused than with it allowed but unwatched, and there is no second factor in either case;
 * the only difference is that the legitimate owner is shut out. **A control that cannot
 * function should say so, not take the console away** — so the sign-in proceeds and the
 * console carries a permanent warning that the step is off and how to turn it on. The same
 * shape as `usingDevSecret()`: warn, never break.
 */
export async function adminTwoStep(): Promise<boolean> {
  return Boolean(await adminEmail());
}

/* ------------------------------------------------------------------ */
/* How the grand admin's secret is stored                              */
/* ------------------------------------------------------------------ */

/*
 * `ADMIN_SECRET` may hold either the secret itself or a **hash** of it.
 *
 * Hashing it means the deployment's environment holds nothing replayable: someone who
 * reads the value learns the constraint it satisfies, not the password that satisfies
 * it — and the same password can be reused elsewhere with confidence.
 *
 * **The browser always sends the password, never a hash.** Hashing in the browser would
 * turn the hash into the password: anyone holding it could send it verbatim and be let
 * in, so it would stop being one-way in the only way that matters. The comparison
 * happens here, on the server, against a value the browser never sees.
 *
 * Recognised forms, detected by prefix, so an ordinary secret keeps working unchanged:
 *
 *   scrypt:<salt>:<digest>   recommended — memory-hard, so a stolen hash stays
 *                            expensive to attack even if the password is weak
 *   sha256:<64 hex>          for a hash from a general-purpose tool
 *   anything else            the secret itself, compared directly
 *
 * Produce one with `npm run admin:hash`, which reads the password from stdin rather
 * than the command line so it cannot be read out of the process list.
 */

/** Key length for scrypt. 64 bytes is comfortably beyond any collision concern. */
const SCRYPT_KEYLEN = 64;

/**
 * scrypt work factors.
 *
 * `N = 16384, r = 8` needs about 16 MB and takes roughly 50–100 ms — slow enough to
 * make offline guessing expensive, fast enough that one sign-in is imperceptible.
 * `maxmem` is raised explicitly because Node's 32 MB default is close to the line and
 * the failure mode is an exception rather than a slower hash.
 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const encodePart = (input: Buffer) =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decodePart = (value: string) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** What a recognised `ADMIN_SECRET` turned out to be. */
type StoredSecret =
  | { kind: "plaintext"; value: string }
  | { kind: "sha256"; digest: Buffer }
  | { kind: "scrypt"; salt: Buffer; digest: Buffer }
  /** Recognised as a password hash we cannot verify without another package. */
  | { kind: "unsupported"; label: string };

/**
 * A hash we can see but not verify, described as a clause that follows "ADMIN_SECRET".
 *
 * Deliberately *not* treated as plaintext. Falling through would compare the literal
 * string `$2b$10$…` as the password, which "works" for whoever knows the hash — the
 * opposite of the point. `bcrypt` and `argon2` both need a package this project does not
 * depend on, and adding one to satisfy a maybe is a poor trade, so the message names the
 * fix instead.
 */
function unsupportedLabel(value: string): string | null {
  if (/^\$2[aby]\$/.test(value)) {
    return "looks like a bcrypt hash, which this build cannot verify";
  }
  if (/^\$argon2(a?i|id|d)\$/.test(value)) {
    return "looks like an argon2 hash, which this build cannot verify";
  }
  return null;
}

const SUPPORTED_FORMS =
  'a plaintext secret, a "sha256:<64 hex>" value or a "scrypt:<salt>:<digest>" value';

function parseStoredSecret(value: string): StoredSecret {
  if (value.startsWith("scrypt:")) {
    const [, salt, digest] = value.split(":");
    if (!salt || !digest) {
      return { kind: "unsupported", label: 'starts with "scrypt:" but is not a valid scrypt value' };
    }
    return { kind: "scrypt", salt: decodePart(salt), digest: decodePart(digest) };
  }

  if (value.startsWith("sha256:")) {
    const hex = value.slice("sha256:".length).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      return {
        kind: "unsupported",
        label: 'starts with "sha256:" but is not 64 hexadecimal characters',
      };
    }
    return { kind: "sha256", digest: Buffer.from(hex, "hex") };
  }

  const unsupported = unsupportedLabel(value);
  if (unsupported) return { kind: "unsupported", label: unsupported };

  return { kind: "plaintext", value };
}

/** Whether `ADMIN_SECRET` holds a hash rather than the secret itself. */
export async function adminSecretIsHashed(): Promise<boolean> {
  const value = await adminSecret();
  if (!value) return false;
  return parseStoredSecret(value).kind !== "plaintext";
}

/** Warned once per process, so a busy log is not spammed by one misconfiguration. */
const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function scryptDigest(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (error, derived) =>
      error ? reject(error) : resolve(derived as Buffer),
    );
  });
}

/**
 * Check a candidate as the grand admin.
 *
 * Thin by design: the rule lives in `verifyAdminCredentials`, and this exists so callers do
 * not each re-implement the empty-input guard. What it accepts is the **stored password**;
 * `ADMIN_SECRET` is accepted only while no password has been set (bootstrap).
 *
 * Async because scrypt is deliberately slow: hashing on the main thread would block every
 * other request for the duration, which on a registration site is the difference between
 * one organiser waiting 80 ms and every entrant waiting 80 ms.
 */
export async function checkAdminSecret(candidate: string | null | undefined): Promise<boolean> {
  if (typeof candidate !== "string" || !candidate.trim()) return false;
  return verifyAdminCredentials(candidate.trim());
}

/**
 * Check a candidate against `ADMIN_SECRET` alone.
 *
 * **Bootstrap only.** This is reached in exactly two situations, both meaning "there is no
 * stored password to check": a deployment that has never had one set, and a machine with no
 * database configured at all. It is never consulted when a password row exists — that is the
 * whole point of the change; see `verifyAdminCredentials`.
 *
 * Not exported: callers should use `checkAdminSecret`, which applies the rule.
 */
async function checkEnvAdminSecret(candidate: string | null | undefined): Promise<boolean> {
  const expected = await adminSecret();
  if (!expected || typeof candidate !== "string" || !candidate.trim()) return false;

  const submitted = candidate.trim();
  const stored = parseStoredSecret(expected);

  switch (stored.kind) {
    case "unsupported": {
      warnOnce(
        `unsupported:${stored.label}`,
        `[admin-auth] ADMIN_SECRET ${stored.label}. This deployment can only verify ` +
          `${SUPPORTED_FORMS}, so nobody can sign in as grand admin until it is replaced. ` +
          `Run \`npm run admin:hash\` to produce a supported hash of the same password.`,
      );
      return false;
    }

    case "sha256": {
      const digest = createHash("sha256").update(submitted, "utf8").digest();
      return digest.length === stored.digest.length && timingSafeEqual(digest, stored.digest);
    }

    case "scrypt": {
      let digest: Buffer;
      try {
        digest = await scryptDigest(submitted, stored.salt);
      } catch (error) {
        console.error("[admin-auth] scrypt failed", error);
        return false;
      }
      return digest.length === stored.digest.length && timingSafeEqual(digest, stored.digest);
    }

    case "plaintext": {
      const a = Buffer.from(stored.value, "utf8");
      const b = Buffer.from(submitted, "utf8");
      // timingSafeEqual throws on a length mismatch, so compare lengths first.
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    }
  }
}

/**
 * Hash a secret for `ADMIN_SECRET`.
 *
 * Exported so the generator script and the tests use *this* implementation rather than
 * a copy: a tool that produced a format the verifier did not accept would be worse than
 * no tool at all.
 */
export function hashAdminSecret(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt:${encodePart(salt)}:${encodePart(digest)}`;
}

/* ------------------------------------------------------------------ */
/* Server-managed session                                              */
/* ------------------------------------------------------------------ */

/*
 * After a correct code the server sets a signed, HttpOnly cookie. The browser's
 * JavaScript never sees the admin code again — not in storage, not in a header —
 * so a script-injection bug cannot lift it. The cookie is SameSite=Strict, and
 * state-changing requests must also come from this site's own origin.
 *
 * The signing key is derived from ADMIN_SECRET, so rotating the secret ends every
 * session at once.
 */
const PRODUCTION = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = PRODUCTION ? "__Host-ksu_admin" : "ksu_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sessionSignature(payload: string, secret: string) {
  return b64url(createHmac("sha256", `ksu-admin-session:${secret}`).update(payload).digest());
}

/**
 * Who is behind a session.
 *
 * `owner` is the grand admin, who holds the deployment secret; `staff` is someone
 * the grand admin granted access to by email. The distinction is what stops a
 * granted staff member from granting further access, or from reading the email
 * allowlist, so it lives inside the signed cookie rather than being decided by the
 * page that renders the console.
 */
export type AdminRole = "owner" | "staff";

export interface AdminSession {
  role: AdminRole;
  /** The staff member's own address. Null for the grand admin, who is not a person
   *  in the database — they are a secret in the environment. */
  email: string | null;
}

async function mintSession(payload: Record<string, unknown>): Promise<string | null> {
  const secret = await adminSecret();
  if (!secret) return null;
  const encoded = b64url(
    JSON.stringify({ ...payload, x: Date.now() + SESSION_TTL_SECONDS * 1000 }),
  );
  return `${encoded}.${sessionSignature(encoded, secret)}`;
}

/** A fresh session token for the grand admin, or null when not configured. */
export async function createAdminSession(): Promise<string | null> {
  return mintSession({ r: "owner" });
}

/**
 * A session for a granted staff member.
 *
 * The address is carried inside the signed payload, so a session cannot be
 * re-labelled as somebody else's, and the audit line can name who did what
 * instead of reporting one anonymous "admin".
 */
export async function createStaffSession(email: string): Promise<string | null> {
  return mintSession({ r: "staff", s: email.trim().toLowerCase() });
}

/** Cookie attributes shared by set and clear. */
export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: PRODUCTION,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/**
 * The session on this request, or null when there is none.
 *
 * A payload with no role is read as `owner`: that is what every session looked
 * like before roles existed, and deriving the role rather than rejecting the
 * cookie means deploying this does not sign the organiser out mid-tournament.
 */
export async function adminSession(request: Request): Promise<AdminSession | null> {
  const secret = await adminSecret();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!secret || !token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sessionSignature(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { x?: unknown; r?: unknown; s?: unknown };

    if (typeof parsed.x !== "number" || parsed.x <= Date.now()) return null;

    const role: AdminRole = parsed.r === "staff" ? "staff" : "owner";
    const email = typeof parsed.s === "string" && parsed.s ? parsed.s : null;
    /* A staff session that names nobody is not usable: the console shows who is
       signed in, and the audit line records it. Treat it as no session rather than
       as an anonymous staff member. */
    if (role === "staff" && !email) return null;

    return { role, email: role === "staff" ? email : null };
  } catch {
    return null;
  }
}

/** True when the request carries a genuine, unexpired session of either role. */
export async function hasAdminSession(request: Request): Promise<boolean> {
  return (await adminSession(request)) !== null;
}

/**
 * Whether a state-changing request really came from this site. Browsers always send
 * `Origin` on cross-site and on same-site non-GET fetches, so a missing or foreign
 * one is refused.
 */
export function isSameOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The secret as presented by a request — header only. A `?secret=` query string is
 * deliberately not accepted: URLs end up in server logs, browser history and
 * Referer headers.
 */
export function presentedSecret(request: Request): string | null {
  return request.headers.get("x-admin-secret");
}

/** Wrong guesses allowed from one address before it is locked out for a while. */
const ADMIN_MAX_FAILURES = 3;
const ADMIN_LOCKOUT_WINDOW_MS = 15 * 60_000;

/**
 * Wrong codes from *all* addresses combined before new code logins pause.
 *
 * The per-address limit alone is beaten by spreading guesses over many addresses (a
 * proxy pool rotates per request). Past this many failures site-wide, code logins
 * pause for the window. Organisers already signed in keep working — their session
 * cookie does not go through this check — so an attack can delay a new sign-in but
 * not take the console away from people using it.
 */
const ADMIN_GLOBAL_MAX_FAILURES = 50;

const callerKey = (request: Request) => clientKey(request, "admin-fail");

/**
 * Seconds this caller must wait before trying an admin code again; 0 if free to try.
 *
 * Checked in two places: this instance's memory (instant) and the database (shared
 * by every serverless instance, so the limit cannot be dodged by landing on a
 * different one). If the database is unreachable the memory check still applies.
 */
export async function adminLockout(request: Request): Promise<number> {
  const key = await callerKey(request);
  const local = lockoutSeconds(key, ADMIN_MAX_FAILURES, ADMIN_LOCKOUT_WINDOW_MS);
  if (local > 0) return local;

  if (!(await databaseConfigured())) return 0;
  try {
    const since = new Date(Date.now() - ADMIN_LOCKOUT_WINDOW_MS);
    if ((await countAllAdminFailures(since)) >= ADMIN_GLOBAL_MAX_FAILURES) {
      return Math.ceil(ADMIN_LOCKOUT_WINDOW_MS / 1000);
    }
    const failures = await recentAdminFailures(key, since);
    if (failures.length < ADMIN_MAX_FAILURES) return 0;
    const unlocksAt = failures[0].getTime() + ADMIN_LOCKOUT_WINDOW_MS;
    return Math.max(1, Math.ceil((unlocksAt - Date.now()) / 1000));
  } catch (error) {
    console.error("[admin-auth] lockout lookup failed", error);
    return 0;
  }
}

/**
 * Check a candidate secret on behalf of a request, with brute-force protection:
 * after three wrong guesses in 15 minutes the caller is refused even with the right
 * code, until the window passes.
 */
export async function checkAdminSecretGuarded(
  request: Request,
  candidate: string | null | undefined,
): Promise<boolean> {
  return (await adminLogin(request, candidate)).ok;
}

/**
 * A login attempt with its outcome spelled out, so callers can answer 429 (locked
 * out, with a wait time) rather than 401 (wrong code) from a single database lookup.
 */
export async function adminLogin(
  request: Request,
  candidate: string | null | undefined,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  /* No credential at all is not a password guess: refuse it without touching the
     failure counters, so a scanner or a stray unauthenticated read cannot lock the
     organisers out. Only a presented-but-wrong code counts. */
  if (typeof candidate !== "string" || !candidate.trim()) {
    return { ok: false, retryAfterSeconds: 0 };
  }

  const wait = await adminLockout(request);
  if (wait > 0) return { ok: false, retryAfterSeconds: wait };

  const key = await callerKey(request);
  if (await checkAdminSecret(candidate)) {
    clearFailures(key);
    if (await databaseConfigured()) await clearAdminFailures(key).catch(() => {});
    return { ok: true };
  }

  recordFailure(key);
  if (await databaseConfigured()) await addAdminFailure(key, ADMIN_LOCKOUT_WINDOW_MS).catch(() => {});
  return { ok: false, retryAfterSeconds: 0 };
}

/**
 * One line per admin request that touched data, in the server log: who, what, how
 * they authenticated, and whether it was allowed.
 *
 * Before staff accounts existed there was one shared organiser code, so this was
 * the only trail of who read or changed anything — and it could not say *who*.
 * Now a staff session names its owner, and a refusal is recorded too, so a staff
 * member probing an owner-only route is visible rather than silent.
 *
 * The secret is never logged.
 */
async function auditAdmin(
  request: Request,
  via: "session" | "header",
  actor: AdminSession,
  outcome: "allowed" | "refused" = "allowed",
) {
  try {
    console.info(
      JSON.stringify({
        audit: "admin",
        at: new Date().toISOString(),
        method: request.method,
        path: new URL(request.url).pathname,
        ip: (await callerKey(request)).replace(/^admin-fail:/, ""),
        role: actor.role,
        ...(actor.email ? { staff: actor.email } : {}),
        via,
        outcome,
      }),
    );
  } catch {
    // Logging must never break a request.
  }
}

/**
 * Any signed-in admin — the grand admin or a granted staff member.
 *
 * This is the gate for the registration data, which is what staff access is for.
 * Anything that changes the tournament itself is behind `isOwnerRequest`.
 */
export async function isAdminRequest(request: Request): Promise<boolean> {
  // The console's own session: no secret travels, no failure is counted.
  const session = await adminSession(request);
  if (session) {
    if (!isSameOrigin(request)) return false;
    await auditAdmin(request, "session", session);
    return true;
  }
  // Scripts and tools may still present the secret in a header.
  if (await checkAdminSecretGuarded(request, presentedSecret(request))) {
    await auditAdmin(request, "header", { role: "owner", email: null });
    return true;
  }
  return false;
}

/**
 * The grand admin only.
 *
 * Guards the things that decide who else gets in, and what the tournament is:
 * the staff allowlist, the rulebook, the game logos and the tournament config.
 * A granted staff member is a trusted helper for the *registrations*, not a second
 * owner — otherwise the first person granted access could grant it onwards, and
 * revoking one address would mean auditing all of them.
 *
 * A staff session is refused without counting as a failed login: it is a genuine
 * credential, just not a sufficient one, and locking the person out for reaching
 * an endpoint their own console never shows would be punishing a mistake.
 */
export async function isOwnerRequest(request: Request): Promise<boolean> {
  const session = await adminSession(request);
  if (session) {
    if (!isSameOrigin(request)) return false;
    const allowed = session.role === "owner";
    await auditAdmin(request, "session", session, allowed ? "allowed" : "refused");
    return allowed;
  }
  // A presented secret is the grand admin by definition — it is their credential.
  if (await checkAdminSecretGuarded(request, presentedSecret(request))) {
    await auditAdmin(request, "header", { role: "owner", email: null });
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export const NOT_CONFIGURED_MESSAGE =
  "Admin access is not configured. Set ADMIN_SECRET in the server environment and restart the app.";

export const UNAUTHORISED_MESSAGE = "That code is not the admin code.";
export const LOCKED_OUT_MESSAGE = "Too many incorrect attempts. Please wait a few minutes and try again.";
