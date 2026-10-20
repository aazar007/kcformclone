import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { toWesternDigits } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip everything that isn't a digit so numbers compare reliably.
 *
 * Digits are folded to Western first: `/\D/` is ASCII-only, so a student on an
 * Arabic keyboard typing `٠٥٥…` would otherwise have every character deleted and
 * be told their phone number was empty.
 */
export function digitsOnly(value: string) {
  return toWesternDigits(value).replace(/\D/g, "");
}

/**
 * Normalise a Saudi mobile number to +9665XXXXXXXX.
 * Accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX and +9665XXXXXXXX.
 */
export function normalisePhone(value: string): string | null {
  const digits = digitsOnly(value);
  let local: string | null = null;

  if (digits.length === 9 && digits.startsWith("5")) local = digits;
  else if (digits.length === 10 && digits.startsWith("05")) local = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("9665")) local = digits.slice(3);
  else if (digits.length === 13 && digits.startsWith("009665")) local = digits.slice(5);

  return local ? `+966${local}` : null;
}

/** Pretty print for the review step: +966 55 123 4567 */
export function formatPhone(normalised: string) {
  const local = normalised.replace("+966", "");
  return `+966 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
}

export function domainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/** Deterministic pseudo-random generator so decorative art is stable. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Reference code shown to the team, e.g. KSU-26-4KQ7TN */
export function makeReference() {
  let out = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `KSU-${String(new Date().getFullYear()).slice(2)}-${out}`;
}
