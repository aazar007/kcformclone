/**
 * The token in a member's completion link.
 *
 * Deliberately its own module: the link is minted while the registration is still
 * a draft and verified once it is a real team, so both `draft-store` and
 * `member-confirm` need the same primitives. Importing one from the other would
 * make a cycle.
 *
 * **The raw token is never stored.** The database holds a SHA-256 hash, so a
 * leaked dump cannot be used to fill in — or confirm — somebody else's profile.
 */

import { createHash, randomBytes } from "node:crypto";
import { appUrl } from "./app-url";

/** 32 random bytes = 256 bits, far beyond guessing range and URL-safe. */
export function generateConfirmToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The value stored in `Member.confirmTokenHash` / `DraftMember.confirmTokenHash`. */
export function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Where a member's completion button points. */
export function memberConfirmUrl(baseUrl: string, token: string, language: "en" | "ar"): string {
  return appUrl(
    baseUrl,
    `/confirm-email?token=${encodeURIComponent(token)}&lang=${language}`,
  );
}

/** The stored hash for a token, or null when the value cannot be one. */
export function tokenHash(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 20) return null;
  return hashConfirmToken(trimmed);
}
