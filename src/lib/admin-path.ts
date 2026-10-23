/**
 * Where the organiser console answers.
 *
 * The console used to live at `/admin`, which meant anyone could reach the sign-in
 * form by typing the most obvious word in the language — and scanners work through
 * exactly that kind of list. It now answers on a secret segment, and `/admin` is
 * refused outright.
 *
 * **This is obscurity, not authorisation.** What protects the console is the admin
 * secret and the signed session cookie; the path only decides who *stumbles* onto
 * the sign-in form. Anyone who reads the page source can see the segment, because
 * the keyboard shortcut has to know where to send the organiser — so it is worth
 * about as much as not printing the URL in the footer, and no more. What it buys is
 * still real: a student typing `/admin` learns nothing, and a bot working through a
 * list of login paths gets a 404 like any other missing page.
 *
 * The segment is derived from `ADMIN_SECRET`, which means it is unguessable without
 * anyone having to configure it, and it rotates when the master secret does. Set
 * `ADMIN_PATH` / `STAFF_PATH` to choose one yourself.
 *
 * **There are two addresses, one per way in.** The grand admin's page offers only the
 * deployment secret; the staff page offers only the emailed code. They are separate
 * paths because the two audiences are separate — a captain who is handed the staff
 * address should never be shown a field asking for the master secret, and the grand
 * admin should not have to pick their way past a form meant for someone else.
 */

import { getEnv } from "./env";

/** Which way in an address belongs to. */
export type ConsoleRole = "owner" | "staff";

/**
 * The signed messages the segments are derived from.
 *
 * One per role, and never shared: if both used the same context they would produce the
 * same segment, and the grand admin's page would answer at the staff address. Changing
 * either string rotates every address for that role.
 */
const HASH_CONTEXT: Record<ConsoleRole, string> = {
  owner: "ksu-crown-admin-path:v1",
  staff: "ksu-crown-staff-path:v1",
};

/** The visible prefixes. They leak nothing — the entropy is the hex that follows. */
const PREFIX: Record<ConsoleRole, string> = {
  owner: "crown-",
  staff: "crew-",
};

/** The environment variable that overrides each role's segment. */
const OVERRIDE: Record<ConsoleRole, string> = {
  owner: "ADMIN_PATH",
  staff: "STAFF_PATH",
};

/** Matches `adminSecret()`'s development fallback, so dev works with no configuration. */
const DEV_ADMIN_SECRET = "crown-admin";

/** How much of the digest to keep. 12 hex chars is 48 bits: far beyond guessing. */
const DIGEST_LENGTH = 12;

/**
 * What a usable path segment looks like: lower-case letters, digits and hyphens.
 *
 * Enforced rather than sanitised because the segment is compared against a URL and
 * is also a rewrite target — a value with a slash or a space in it would silently
 * become a *different* path, and the console would simply be unreachable.
 */
const SEGMENT = /^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/;

/**
 * The secret the segment is derived from, or null when there is nothing to derive
 * from.
 *
 * Deliberately mirrors `adminSecret()`: outside production an unset variable falls
 * back to the development secret so a fresh checkout works, and in production a
 * missing one disables the console — which is not a new consequence, because the
 * verify route already answers 503 without it. A *guessable* fallback segment in
 * production would be worse than none: it would look like protection while the
 * console sat at a path anybody could compute.
 */
export async function adminPathSecret(): Promise<string | null> {
  const configured = (await getEnv("ADMIN_SECRET"))?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return DEV_ADMIN_SECRET;
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Warned once per process per variable, so a busy log is not spammed by one typo. */
const overrideWarned = new Set<string>();

/** The override for a role, normalised and validated — null when unset or unusable. */
async function explicitPath(role: ConsoleRole): Promise<string | null> {
  const variable = OVERRIDE[role];
  const raw = (await getEnv(variable))?.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!raw) return null;

  if (!SEGMENT.test(raw)) {
    if (!overrideWarned.has(variable)) {
      overrideWarned.add(variable);
      console.warn(
        `[admin-path] ${variable}="${raw}" is not a usable path segment ` +
          `(use 5–63 lower-case letters, digits or hyphens). Falling back to the derived path.`,
      );
    }
    return null;
  }
  return raw;
}

/* The digest is async, and middleware runs on every page view, so the answers are kept
   for the life of the process. Keyed by secret *and* role, so a test that swaps
   `ADMIN_SECRET` gets a fresh value rather than a stale one, and the two roles can never
   be served each other's memo. */
const memo = new Map<string, string>();

/**
 * The header the middleware stamps on a request it has routed to the console.
 *
 * The console page refuses to render without it, which is what stops `/admin` serving
 * the console when the middleware does not run. That is not hypothetical: the matcher
 * deliberately skips prefetch requests, so a request carrying `Next-Router-Prefetch`
 * reaches the route below the middleware — and before this check it rendered the
 * whole sign-in form at a URL anyone could type.
 *
 * The value is the segment itself rather than a constant, so forging the header
 * requires already knowing the secret path — at which point there is nothing left to
 * discover. A constant would be one leaked string away from re-exposing the console.
 *
 * Holding the *segment* rather than the role also means each page can check for its own
 * address specifically: the staff page does not accept the grand admin's segment.
 */
export const CONSOLE_HEADER = "x-ksu-console";

/**
 * One role's path segment, or null when the console is not configured.
 *
 * Returning null is a real answer: callers must treat it as "there is no console to
 * link to", not as "use a default". A default here would be a public URL.
 */
export async function consolePath(role: ConsoleRole): Promise<string | null> {
  const explicit = await explicitPath(role);
  if (explicit) return explicit;

  const secret = await adminPathSecret();
  if (!secret) return null;

  const key = `${role}:${secret}`;
  const cached = memo.get(key);
  if (cached) return cached;

  const digest = await sha256Hex(`${HASH_CONTEXT[role]}:${secret}`);
  const path = `${PREFIX[role]}${digest.slice(0, DIGEST_LENGTH)}`;
  memo.set(key, path);
  return path;
}

/** The grand admin console's segment. */
export function adminPath(): Promise<string | null> {
  return consolePath("owner");
}

/** The staff sign-in page's segment. A different segment from the grand admin's. */
export function staffPath(): Promise<string | null> {
  return consolePath("staff");
}

/**
 * A segment with a leading slash — or null when that page does not exist.
 *
 * A convenience for links, so no caller has to remember the slash and risk
 * `//crown-…`, which browsers read as a protocol-relative URL to a *different host*.
 */
async function href(role: ConsoleRole): Promise<string | null> {
  const path = await consolePath(role);
  return path ? `/${path}` : null;
}

/** The grand admin console's address. */
export function adminHref(): Promise<string | null> {
  return href("owner");
}

/** The staff sign-in address. */
export function staffHref(): Promise<string | null> {
  return href("staff");
}
