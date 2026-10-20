/**
 * One-time passcodes.
 *
 * Two things need proving: that a roster member really owns the address they
 * typed, and that whoever is asking to edit a registration really holds its
 * reference code. Both are done with a 6-digit code mailed to the address, and
 * both finish by handing the browser a short-lived, signed proof.
 *
 * Nothing secret is ever stored: the database holds an HMAC of the code, and the
 * proof is signed with `OTP_SECRET` — so a leaked database does not grant access
 * to anything.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * What a code is being used for.
 *
 * The purpose is bound into the hash, so a code minted for one of these can never
 * be replayed for another — a staff sign-in code cannot be used to verify a
 * player's email, and vice versa.
 */
export type OtpPurpose = "player-email" | "edit-access" | "staff-access" | "admin-access";

/** How long a code stays valid. */
export const OTP_TTL_MINUTES = 15;

/** How long the proof the browser gets back stays valid. */
const PROOF_TTL_MINUTES = 60;

/** Digits in a code. Six is the sweet spot between typing and guessing. */
const CODE_LENGTH = 6;

/** Codes a single address may ask for before it has to wait. */
export const OTP_MAX_REQUESTS_PER_WINDOW = 5;
export const OTP_REQUEST_WINDOW_MINUTES = 15;

/**
 * Codes of one purpose the whole site may mint in that window.
 *
 * The per-address cap bounds one identity; it bounds nothing at all when the identity
 * changes every request. Rotating references in the edit-lookup flow, or rotating target
 * addresses in the player flow, gets a fresh allowance each time — so without a site-wide
 * ceiling one script writes unbounded rows and sends unbounded mail.
 *
 * Set far above real use: a few hundred teams each asking a handful of times stays under it
 * by two orders of magnitude. It is a brake on abuse, not a quota.
 *
 * `OTP_GLOBAL_MAX` overrides it, which exists for two reasons: an operator whose tournament
 * is larger than this guess can raise it, and the test suite can lower it to exercise the
 * ceiling without minting three hundred codes. A value that is not a positive integer is
 * ignored rather than trusted — a typo must not disable the brake.
 */
function globalMax(): number {
  const raw = process.env.OTP_GLOBAL_MAX?.trim();
  if (!raw) return 300;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 300;
}

export const OTP_GLOBAL_MAX_PER_WINDOW = globalMax();

/** Re-exported so callers do not have to import the window separately. */
export const OTP_GLOBAL_WINDOW_MINUTES = OTP_REQUEST_WINDOW_MINUTES;

/**
 * Wrong guesses allowed against one code before it is burned.
 *
 * Three, at the organisers' request. A 6-digit code has a million possibilities, so
 * three guesses is already hopeless odds for a stranger — and the ceiling is what
 * stops a slow grind against a code somebody else's address was sent. The person
 * it actually belongs to needs one, occasionally two.
 */
export const OTP_MAX_ATTEMPTS = 3;

/** Signing key for both the stored hashes and the proofs handed to browsers. */
function secret(): string {
  const value = process.env.OTP_SECRET?.trim();
  if (!value) {
    throw new OtpNotConfiguredError();
  }
  return value;
}

/** Thrown when `OTP_SECRET` is missing — verification cannot work without it. */
export class OtpNotConfiguredError extends Error {
  constructor() {
    super(
      "OTP_SECRET is not set, so email verification is unavailable. " +
        "Generate one with: openssl rand -base64 32",
    );
    this.name = "OtpNotConfiguredError";
  }
}

export function otpConfigured() {
  return Boolean(process.env.OTP_SECRET?.trim());
}

/** Warned once per process, so a busy dev log is not spammed. */
let skipVerifyWarned = false;

/**
 * Whether email verification is skipped — local testing only.
 *
 * Honoured exclusively outside production. The guard is part of the function, not a
 * convention the callers must remember, so `OTP_SKIP_VERIFY=1` in a live deployment
 * silently falls back to full verification and logs an error rather than waving
 * people through.
 */
export function otpSkipVerify(): boolean {
  const requested = process.env.OTP_SKIP_VERIFY?.trim() === "1";

  if (requested && process.env.NODE_ENV === "production") {
    console.error(
      "[otp] OTP_SKIP_VERIFY is set but ignored in production — email verification stays enforced.",
    );
    return false;
  }

  if (requested && !skipVerifyWarned) {
    skipVerifyWarned = true;
    console.warn(
      "[otp] OTP_SKIP_VERIFY is on — email verification is DISABLED. Testing only.",
    );
  }

  return requested;
}

/**
 * A proof minted without a code, for `OTP_SKIP_VERIFY`.
 *
 * Skip mode is dev-only and the registration route ignores proofs while it is on, so
 * this is signed with a fixed key rather than `OTP_SECRET` — which lets a fresh
 * checkout skip OTP before any secret is generated. It is deliberately **not**
 * verifiable by `verifyProof`, so a skipped proof can never pass a real check.
 */
export function makeSkipProof(email: string, purpose: OtpPurpose): string {
  const payload = {
    e: normaliseEmail(email),
    p: purpose,
    x: Date.now() + PROOF_TTL_MINUTES * 60_000,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", "otp-skip-verify").update(encoded).digest());
  return `${encoded}.${signature}`;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64url = (input: string) => Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** A fresh 6-digit code, uniformly distributed including leading zeros. */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += String(randomInt(0, 10));
  return code;
}

/**
 * Hash a code for storage. Binding the address and purpose into the hash means a
 * code minted for one member cannot be replayed for another.
 */
export function hashCode(code: string, email: string, purpose: OtpPurpose): string {
  return createHmac("sha256", secret())
    .update(`${purpose}:${normaliseEmail(email)}:${code}`)
    .digest("hex");
}

/** Constant-time comparison, so a wrong code cannot be found byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * The proof handed to the browser once an address is verified: the address, an
 * expiry, and an HMAC over both. It is not a session — it proves exactly one
 * thing, and only for the address it names.
 */
export function makeProof(email: string, purpose: OtpPurpose, scope?: string): string {
  const payload = {
    e: normaliseEmail(email),
    p: purpose,
    x: Date.now() + PROOF_TTL_MINUTES * 60_000,
    // What the proof is for (a team id for edit access), so it opens nothing else.
    ...(scope ? { s: scope } : {}),
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", secret()).update(encoded).digest());
  return `${encoded}.${signature}`;
}

/** Whether a proof is genuine, unexpired, and about this address and purpose. */
export function verifyProof(
  token: string | undefined,
  email: string,
  purpose: OtpPurpose,
  scope?: string,
): boolean {
  if (!token) return false;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  let expected: string;
  try {
    expected = base64url(createHmac("sha256", secret()).update(encoded).digest());
  } catch {
    return false;
  }
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(fromBase64url(encoded).toString("utf8")) as {
      e?: unknown;
      p?: unknown;
      x?: unknown;
      s?: unknown;
    };
    if (payload.p !== purpose) return false;
    if ((payload.s ?? undefined) !== (scope ?? undefined)) return false;
    if (typeof payload.x !== "number" || payload.x < Date.now()) return false;
    return typeof payload.e === "string" && payload.e === normaliseEmail(email);
  } catch {
    return false;
  }
}

export function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
}

export function otpRequestWindowStart() {
  return new Date(Date.now() - OTP_REQUEST_WINDOW_MINUTES * 60_000);
}
