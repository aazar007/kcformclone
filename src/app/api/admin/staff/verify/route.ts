import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminSecret,
  createStaffSession,
  sessionCookieOptions,
} from "@/lib/admin-auth";
import { OTP_MAX_ATTEMPTS, hashCode, normaliseEmail, otpSkipVerify, safeEqual } from "@/lib/otp";
import { digitsOnly } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { claimOtpAttempt, consumeOtpOnce, findActiveOtp, findLiveStaffAccess, markStaffLogin } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Exchange a mailed code for a staff session.
 *
 * Two things must both still be true at this moment, and they are checked in this
 * order deliberately:
 *
 *   1. the code is right, and
 *   2. the grant is *still* live.
 *
 * The second matters because a code lives for fifteen minutes. If the grand admin
 * withdraws someone's access while a code is in flight, finishing that sign-in
 * must not work — revocation has to take effect immediately, not when the code
 * happens to expire.
 */
export async function POST(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json(
      { error: "Admin access is not configured on this deployment." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "staff-verify"), 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const email = normaliseEmail(typeof body.email === "string" ? body.email : "");
  const code = digitsOnly(typeof body.code === "string" ? body.code : "");

  /* Local testing: sign in with no code. `otpSkipVerify` is a no-op in production,
     and the live-grant check below is *not* skipped — somebody who was never granted
     access, or whose grant has been withdrawn, still cannot get in. */
  if (await otpSkipVerify()) {
    if (!email) {
      return NextResponse.json({ error: "Enter your email address" }, { status: 400 });
    }
    const granted = await findLiveStaffAccess(email).catch(() => null);
    if (!granted) {
      return NextResponse.json(
        { error: "That email address does not have access to the console." },
        { status: 403 },
      );
    }
    await markStaffLogin(email).catch(() => {});
    return await sessionResponse(email);
  }

  if (!email || code.length !== 6) {
    return NextResponse.json({ error: "Enter the 6-digit code we emailed you" }, { status: 400 });
  }

  try {
    const record = await findActiveOtp(email, "staff-access");
    if (!record) {
      return NextResponse.json(
        { error: "That code has expired. Ask for a new one." },
        { status: 400 },
      );
    }

    /* Claim the attempt before comparing, so two requests racing on the same code
       cannot both get a fresh allowance out of one counter. */
    const withinBudget = await claimOtpAttempt(record.id, OTP_MAX_ATTEMPTS);
    if (!withinBudget) {
      return NextResponse.json(
        { error: "Too many incorrect attempts. Ask for a new code." },
        { status: 429 },
      );
    }

    if (!safeEqual(await hashCode(code, email, "staff-access"), record.codeHash)) {
      return NextResponse.json({ error: "That code is not correct." }, { status: 400 });
    }

    /* Correct code, but access may have been withdrawn while it was in the air. */
    const grant = await findLiveStaffAccess(email);
    if (!grant) {
      await consumeOtpOnce(record.id);
      return NextResponse.json(
        { error: "That email address no longer has access to the console." },
        { status: 403 },
      );
    }

    /* One use only. Losing this race means the code was already spent by another
       request, which must not sign a second session in. */
    const claimed = await consumeOtpOnce(record.id);
    if (!claimed) {
      return NextResponse.json(
        { error: "That code has already been used. Ask for a new one." },
        { status: 400 },
      );
    }

    await markStaffLogin(email).catch(() => {});

    return await sessionResponse(email);
  } catch (error) {
    console.error("[staff:verify]", error);
    return NextResponse.json({ error: "We could not verify that code. Try again." }, { status: 502 });
  }
}

/**
 * The session cookie response, shared by the code path and the skip path.
 *
 * Two ways in must not be two chances to get the cookie attributes subtly different —
 * one of them would end up without `HttpOnly`, or with the wrong `SameSite`, and the
 * difference would only be noticed by an attacker.
 */
async function sessionResponse(email: string) {
  const response = NextResponse.json(
    { ok: true, email, role: "staff" as const },
    { headers: { "Cache-Control": "no-store" } },
  );
  const token = await createStaffSession(email);
  if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
