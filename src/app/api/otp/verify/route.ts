import { NextResponse } from "next/server";
import {
  OTP_MAX_ATTEMPTS,
  hashCode,
  makeProof,
  makeSkipProof,
  normaliseEmail,
  otpConfigured,
  otpSkipVerify,
  safeEqual,
} from "@/lib/otp";
import { digitsOnly } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { claimOtpAttempt, consumeOtp, consumeOtpOnce, findActiveOtp } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Check a code and, if it is right, hand back a signed proof that the caller owns
 * the address.
 *
 * The proof is what a submission actually carries: the API never takes the
 * browser's word that a field was verified, it re-checks the signature.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const raw = body as { email?: unknown; code?: unknown };
  const email = normaliseEmail(typeof raw?.email === "string" ? raw.email : "");

  /* Local testing: accept the address with no code. `otpSkipVerify` is a no-op in
     production, so the proof minted here can never stand in for a real one. */
  if (await otpSkipVerify()) {
    if (!email) {
      return NextResponse.json({ error: "Enter your email address" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, email, proof: makeSkipProof(email, "player-email") });
  }

  if (!(await otpConfigured())) {
    return NextResponse.json(
      { error: "Email verification is not configured on this deployment." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "otp-verify"), 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  /* `digitsOnly`, never `.replace(/\D/g, "")`: JavaScript's `\d`/`\D` are ASCII-only,
   * so the obvious form deletes Arabic-Indic numerals and turns a correct code into
   * an empty string. Students reading an Arabic email typed Arabic digits and were
   * rejected with no explanation. */
  const code = digitsOnly(typeof raw?.code === "string" ? raw.code : "");

  if (!email || code.length !== 6) {
    return NextResponse.json({ error: "Enter the 6-digit code we emailed you" }, { status: 400 });
  }

  try {
    const record = await findActiveOtp(email, "player-email");
    if (!record) {
      return NextResponse.json(
        { error: "That code has expired. Ask for a new one." },
        { status: 400 },
      );
    }

    /* Spend the guess first, atomically, then compare. Checking the count and
       raising it in separate steps let simultaneous guesses all see "0 so far". */
    if (!(await claimOtpAttempt(record.id, OTP_MAX_ATTEMPTS))) {
      await consumeOtp(record.id).catch(() => {});
      return NextResponse.json(
        { error: "Too many incorrect attempts. Ask for a new code." },
        { status: 429 },
      );
    }

    if (!safeEqual(await hashCode(code, email, "player-email"), record.codeHash)) {
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (record.attempts + 1));
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `That code is not correct. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
              : "Too many incorrect attempts. Ask for a new code.",
        },
        { status: 400 },
      );
    }

    // Single use: if a simultaneous request already spent this code, this one gets nothing.
    if (!(await consumeOtpOnce(record.id))) {
      return NextResponse.json({ error: "That code has already been used. Ask for a new code." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, email, proof: await makeProof(email, "player-email") });
  } catch (error) {
    console.error("[otp:verify]", error);
    return NextResponse.json({ error: "We could not verify that code. Try again." }, { status: 502 });
  }
}
