import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminEmail,
  adminSecret,
  adminTwoStep,
  createAdminSession,
  sessionCookieOptions,
  usingDevSecret,
} from "@/lib/admin-auth";
import { OTP_MAX_ATTEMPTS, hashCode, otpSkipVerify, safeEqual } from "@/lib/otp";
import { digitsOnly } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { claimOtpAttempt, consumeOtp, consumeOtpOnce, findActiveOtp } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Step two of the grand admin's sign-in: exchange the emailed code for a session.
 *
 * The address is never taken from the request — it is always `ADMIN_EMAIL`, read from the
 * environment. That removes a whole class of problem: there is no address to enumerate,
 * no signed challenge to carry between steps, and no way to redirect the second factor to
 * somewhere else. The code is bound to that address in its hash anyway, so it could not
 * be redeemed elsewhere even if a caller did name one.
 *
 * A wrong code spends one of `OTP_MAX_ATTEMPTS` and burns the code at the ceiling, which
 * is what keeps this from being a guessable endpoint: the browser has no secret in hand at
 * this point, so the code is the only credential in play.
 */
export async function POST(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json(
      { error: "Admin access is not configured on this deployment." },
      { status: 503 },
    );
  }

  const limited = rateLimit(clientKey(request, "admin-verify-otp"), 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  /* Local testing, dev only. `otpSkipVerify` is a no-op in production and the caller has
     already passed the secret check by this point in that flow. */
  if (otpSkipVerify()) return sessionResponse();

  if (!adminTwoStep()) {
    /* No second factor is configured, so there is no code to check — which means there is
       nothing this endpoint can legitimately do. Refusing is the only safe answer: it is
       reachable without the secret, so completing a sign-in here would be a way in that
       skips step one entirely. */
    return NextResponse.json(
      { error: "Two-step sign-in is not configured. Set ADMIN_EMAIL and restart the app." },
      { status: 503 },
    );
  }

  const email = adminEmail();
  if (!email) {
    return NextResponse.json(
      { error: "Two-step sign-in is not configured. Set ADMIN_EMAIL and restart the app." },
      { status: 503 },
    );
  }

  const code = digitsOnly(typeof body.code === "string" ? body.code : "");
  if (code.length !== 6) {
    return NextResponse.json({ error: "Enter the 6-digit code we emailed you" }, { status: 400 });
  }

  try {
    const record = await findActiveOtp(email, "admin-access");
    if (!record) {
      return NextResponse.json(
        { error: "That code has expired. Enter the secret again to be sent a new one." },
        { status: 400 },
      );
    }

    /* Claim the attempt before comparing, so two requests racing on the same code cannot
       both get a fresh allowance out of one counter. */
    const withinBudget = await claimOtpAttempt(record.id, OTP_MAX_ATTEMPTS);
    if (!withinBudget) {
      await consumeOtp(record.id).catch(() => {});
      return NextResponse.json(
        { error: "Too many incorrect attempts. Enter the secret again to be sent a new one." },
        { status: 429 },
      );
    }

    if (!safeEqual(hashCode(code, email, "admin-access"), record.codeHash)) {
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (record.attempts + 1));
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `That code is not correct. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
              : "Too many incorrect attempts. Enter the secret again to be sent a new one.",
        },
        { status: 400 },
      );
    }

    /* One use only. Losing this race means another request already spent the code, which
       must not sign a second session in. */
    if (!(await consumeOtpOnce(record.id))) {
      return NextResponse.json(
        { error: "That code has already been used. Enter the secret again." },
        { status: 400 },
      );
    }

    return sessionResponse();
  } catch (error) {
    console.error("[admin:verify:otp]", error);
    return NextResponse.json({ error: "We could not verify that code. Try again." }, { status: 502 });
  }
}

/** The only place a grand admin session cookie is set. */
function sessionResponse() {
  const response = NextResponse.json(
    { ok: true, stage: "session" as const, devSecret: usingDevSecret() },
    { headers: { "Cache-Control": "no-store" } },
  );
  const token = createAdminSession();
  if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
