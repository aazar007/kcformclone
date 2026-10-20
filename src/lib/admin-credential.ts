/**
 * The grand admin's password: how it is hashed, and how strong it has to be.
 *
 * Pure on purpose — no database, no environment. `admin-auth.ts` supplies the pepper and
 * `store.ts` owns the row, so this module is nothing but arithmetic and policy, and can be
 * tested without either.
 *
 * ## The pepper is optional, and separate from `ADMIN_SECRET`
 *
 * With `ADMIN_PEPPER` set, the stored value is `HMAC(pepper, scrypt(password, salt))` and the
 * pepper never touches the database. A dump alone then cannot be tested against a guess at
 * all — not even to confirm one — and a leaked server secret alone has no hash to test.
 *
 * **It is off by default, and it used to be mandatory and derived from `ADMIN_SECRET`.** That
 * coupled the password to a variable that means something else entirely: a password set where
 * one `ADMIN_SECRET` was in force stopped verifying where another was, silently, with the
 * symptom of "wrong password". A dedicated variable makes the choice explicit and keeping it
 * in step across environments a decision rather than an accident.
 *
 * What protects a weak password is the strength policy below, and that is enforced. scrypt
 * with these work factors is expensive in its own right. The pepper is defence in depth for
 * anyone who wants it, not the thing standing between a guess and the console.
 *
 * ## Why the strength policy is enforced rather than advised
 *
 * A hash protects a good password; it does not rescue a bad one. `1234` has ten thousand
 * possibilities, and no amount of scrypt makes ten thousand expensive.
 */

import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/** Salt length. 16 random bytes is standard and cheap. */
const SALT_BYTES = 16;

/** Derived-key length. 64 bytes is comfortably beyond any collision concern. */
const KEY_BYTES = 64;

/**
 * scrypt work factors.
 *
 * `N = 16384, r = 8` needs about 16 MB and takes roughly 50–100 ms per guess — slow
 * enough to make offline guessing expensive, fast enough that one sign-in is imperceptible.
 * `maxmem` is set explicitly because Node's 32 MB default sits close to the line and the
 * failure mode is an exception rather than a slower hash.
 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Tags the two stored formats, so verification never has to guess which it is looking at. */
const TAG = "scrypt";
const PEPPERED_TAG = "scrypt-pepper";

/** Warned once per process, so a busy log is not spammed. */
let warnedAboutPepper = false;

const encodePart = (input: Buffer) =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decodePart = (value: string) =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/* -------------------------------------------------------------------------- */
/* Strength                                                                   */
/* -------------------------------------------------------------------------- */

/** Shortest password accepted. See the note at the top of the file. */
export const MIN_PASSWORD_LENGTH = 12;

/** Longest accepted, so a pasted novel cannot turn into a scrypt denial of service. */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * The length at which a password is accepted on length alone, whatever it is made of.
 *
 * This is the passphrase allowance, and it exists because a composition rule gets the
 * security backwards: it accepts `Ksu!Crown-2026` — short, and shaped like a hundred
 * thousand other passwords — while rejecting `correct horse battery staple`, which is
 * longer, far harder to guess, and easier to remember. Requiring classes anyway would push
 * people towards the weaker of the two.
 *
 * So: mix classes *or* be long. Either is a real answer, and the ones that are neither are
 * the ones worth refusing.
 */
const PASSPHRASE_LENGTH = 20;

/**
 * Values that are weak however long they are.
 *
 * Not a password dictionary — that is a losing game and a big list would be its own
 * maintenance problem. These are the strings someone reaches for when they are setting a
 * password they do not intend to remember, which is exactly the case this policy is for.
 */
const WEAK_SUBSTRINGS = [
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "qwerty",
  "asdfgh",
  "zxcvbn",
  "monkey",
  "dragon",
  "iloveyou",
  "abc123",
  "123456",
  "111111",
  "000000",
  "admin",
  "root",
  "crown",
  "ksu",
  "grand",
];

/** Whether the characters run in an obvious sequence, like `abcdefghijkl` or `987654321`. */
function isSequential(value: string): boolean {
  const lower = value.toLowerCase();
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i += 1) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/**
 * Why a proposed password is not acceptable, or null when it is.
 *
 * Returns a sentence rather than a boolean so the console can say what to change. A policy
 * that refuses without explaining is a policy people work around.
 */
export function passwordProblem(password: string): string | null {
  /* A hash pasted into the password field — which is an easy mistake, because the same
     project tells people to produce hashes with `npm run admin:hash` for `ADMIN_SECRET`.
     Left unchecked it "succeeds": the field accepts it, a hash of the hash is stored, and
     the passwords that work from then on are the hash string and nothing else. The person
     then signs in with their real password, is refused, and has no way to see why.
     Detected before anything else, so the message is about the actual mistake. */
  if (/^(scrypt-pepper|scrypt|sha256):/i.test(password.trim())) {
    return "That looks like a hash, not a password. Paste the password itself — it is hashed here on the server, and a hash typed into this field would only ever be matched by that exact hash text.";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. This password protects the whole tournament, and its hash is stored in the database — so its own strength is what keeps it safe.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That is longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }

  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  if (classes < 3 && password.length < PASSPHRASE_LENGTH) {
    return `Either mix at least three of lower-case letters, capitals, digits and symbols — or make it ${PASSPHRASE_LENGTH} characters or more, which a few unrelated words will do easily.`;
  }

  if (new Set(password).size < 5) {
    return "That is too repetitive — try a passphrase of a few unrelated words.";
  }

  if (isSequential(password)) {
    return "That runs in a sequence. A sequence is the first thing anyone tries.";
  }

  const lower = password.toLowerCase();
  for (const weak of WEAK_SUBSTRINGS) {
    if (lower.includes(weak)) {
      return `That contains “${weak}”, which is one of the first things anyone tries.`;
    }
  }

  return null;
}

export function isPasswordStrong(password: string): boolean {
  return passwordProblem(password) === null;
}

/* -------------------------------------------------------------------------- */
/* Hashing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Combine the derived key with the pepper.
 *
 * `HMAC` rather than concatenation: the pepper is a fixed-length key and the derived key is
 * another, so an HMAC is the standard construction for "key this material with that key".
 * It also means the stored digest is not recognisable as a scrypt output.
 */
function pepperDigest(derived: Buffer, pepper: Buffer): Buffer {
  return createHmac("sha256", pepper).update(derived).digest();
}

function scryptDerive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derived) =>
      error ? reject(error) : resolve(derived as Buffer),
    );
  });
}

/**
 * Hash a password for storage.
 *
 * **An empty pepper means no pepper, and that is the default.** Peppering is opt-in via
 * `ADMIN_PEPPER`, and the tag records which was used so verification never has to guess.
 *
 * It used to be mandatory and derived from `ADMIN_SECRET`, and that coupling was a mistake:
 * a password set where one `ADMIN_SECRET` was in force simply stopped verifying where another
 * was, with no error and nothing on screen to explain it — the failure reads as "wrong
 * password". Twice that cost real debugging time, and the benefit it bought was narrower than
 * it looked, because the strength policy below is what actually protects a guessable password.
 *
 * Kept as an option because it is genuinely good defence-in-depth for anyone who wants it —
 * with `ADMIN_PEPPER` set, a stolen database cannot be tested against a guess at all. It is
 * now explicit, and its own variable, so keeping it in step across environments is a thing
 * you choose rather than a side effect of a variable that means something else.
 */
export function hashCredential(password: string, pepper: Buffer): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
  const digest = pepper.length > 0 ? pepperDigest(derived, pepper) : derived;
  const tag = pepper.length > 0 ? PEPPERED_TAG : TAG;
  return `${tag}:${encodePart(salt)}:${encodePart(digest)}`;
}

/** The async form, for writing on the request path so scrypt cannot block the loop. */
export async function hashCredentialAsync(password: string, pepper: Buffer): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptDerive(password, salt);
  const digest = pepper.length > 0 ? pepperDigest(derived, pepper) : derived;
  const tag = pepper.length > 0 ? PEPPERED_TAG : TAG;
  return `${tag}:${encodePart(salt)}:${encodePart(digest)}`;
}

/**
 * Whether a candidate password matches a stored value.
 *
 * The tag decides how: a peppered value needs the pepper, a plain one must not have it
 * applied. Both are supported so an existing row keeps working through the change — and so a
 * deployment that sets `ADMIN_PEPPER` later does not invalidate the password it already has.
 *
 * Constant-time in the comparison, so a wrong password cannot be discovered one byte at a
 * time. Returns false on anything malformed rather than throwing: this runs on a request
 * path, and a corrupted row should refuse a sign-in, not take the route down.
 */
export async function verifyCredential(
  stored: string | null | undefined,
  password: string,
  pepper: Buffer,
): Promise<boolean> {
  if (!stored || !password) return false;

  const [tag, saltPart, digestPart] = stored.split(":");
  const peppered = tag === PEPPERED_TAG;
  if ((!peppered && tag !== TAG) || !saltPart || !digestPart) return false;

  /* A peppered value cannot be checked without the pepper. Said out loud once, because the
     alternative — silently returning false — is indistinguishable from a wrong password,
     which is exactly the confusion this module exists to reduce. */
  if (peppered && pepper.length === 0) {
    if (!warnedAboutPepper) {
      warnedAboutPepper = true;
      console.error(
        "[admin-credential] the stored grand admin password was hashed with a pepper, but " +
          "ADMIN_PEPPER is not set here, so it cannot be verified. Sign in with ADMIN_SECRET " +
          "and set the password again.",
      );
    }
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = decodePart(digestPart);
    salt = decodePart(saltPart);
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptDerive(password, salt);
  } catch {
    return false;
  }

  const actual = peppered ? pepperDigest(derived, pepper) : derived;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether a stored value was produced by this module, for diagnostics. */
export function isCredentialHash(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith(`${TAG}:`) || value.startsWith(`${PEPPERED_TAG}:`);
}

/** Whether a stored value carries a pepper, for diagnostics. */
export function isPepperedCredential(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PEPPERED_TAG}:`);
}
