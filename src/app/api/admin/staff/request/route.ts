import { NextResponse } from "next/server";
import { isDatabaseUnavailable } from "@/lib/db";
import { adminSecret } from "@/lib/admin-auth";
import { isRelayRefusal, mailerAllowsLogFallback, mailerConfigured, sendOtpEmail } from "@/lib/mailer";
import {
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_REQUEST_WINDOW_MINUTES,
  generateCode,
  hashCode,
  normaliseEmail,
  otpExpiry,
  otpRequestWindowStart,
  otpSkipVerify,
} from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { countRecentOtps, createOtp, discardOtp, findLiveStaffAccess } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Email a sign-in code to a granted staff member.
 *
 * The allowlist check happens **before** anything is sent, which is the whole
 * point: an address the grand admin has not granted never receives a code, so it
 * cannot sign in even if it guesses one. The refusal is deliberately explicit
 * rather than a reassuring "we sent you a code" — the second leaves someone who
 * was *never* granted access waiting for a message that will never arrive, with no
 * way to tell the difference between "not allowed" and "the email failed".
 *
 * The cost of that honesty is that it confirms whether an address has access to
 * anyone who asks. It is rate limited for that reason, and the alternative would
 * be worse: silently mailing codes to strangers is how a registration site becomes
 * a spam relay.
 */
export async function POST(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json(
      { error: "Admin access is not configured on this deployment." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "staff-request"), 10, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const email = normaliseEmail(typeof body.email === "string" ? body.email : "");
  if (!email) {
    return NextResponse.json({ error: "Enter your email address" }, { status: 400 });
  }

  /* The gate. An address with no live grant is refused here and no code is minted,
     so the OTP table never holds a code for somebody who is not allowed in.

     Guarded, because this is the one database call in the route that would otherwise sit
     outside every `try`. When the database was unreachable it threw here, Next answered
     with its own **HTML** 500 and an empty body, and the sign-in page had no error string
     to show — so the organiser saw a generic "Something went wrong" and nothing anywhere
     pointed at the database. A reachability problem should say it is one. */
  let grant;
  try {
    grant = await findLiveStaffAccess(email);
  } catch (error) {
    console.error("[staff:request] could not check the grant", error);
    return NextResponse.json(
      {
        error: isDatabaseUnavailable(error)
          ? "The organiser database cannot be reached right now, so no sign-in code can be sent. This is a problem with the deployment, not with your address."
          : "We could not check your access just now. Please try again shortly.",
      },
      { status: 503 },
    );
  }
  if (!grant) {
    return NextResponse.json(
      { error: "That email address does not have access to the console." },
      { status: 403 },
    );
  }

  /* Local testing: skip the email entirely. The flag is ignored in production (see
     `otpSkipVerify`), so this branch cannot ship — and the grant check above still
     runs first, because that check *is* the feature; a test aid that stepped over it
     would test nothing. Placed before the mailer guard so skip mode works on a
     deployment with no sending account at all, which is where a fresh clone starts. */
  if (await otpSkipVerify()) {
    return NextResponse.json({ ok: true, email, skipVerify: true });
  }

  if (!(await (await mailerConfigured("otp"))) && !(await mailerAllowsLogFallback("otp"))) {
    return NextResponse.json(
      { error: "The email service is not configured on this deployment." },
      { status: 503 },
    );
  }

  try {
    const recent = await countRecentOtps(email, "staff-access", otpRequestWindowStart());
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        {
          error: `We have already sent several codes to ${email}. Please wait ${OTP_REQUEST_WINDOW_MINUTES} minutes, then try again.`,
        },
        { status: 429 },
      );
    }

    const code = generateCode();
    const record = await createOtp({
      email,
      purpose: "staff-access",
      codeHash: await hashCode(code, email, "staff-access"),
      expiresAt: otpExpiry(),
    });

    try {
      /* English: the console itself is English-only, so the code that opens it is
         written in the same language the person is about to read. */
      const sent = await sendOtpEmail(email, code, "staff-access", undefined, "en");
      return NextResponse.json({
        ok: true,
        email,
        delivered: sent.delivered,
        logged: sent.logged,
      });
    } catch (error) {
      /* The code never left, so it must not spend one of the address's requests. */
      await discardOtp(record.id).catch(() => {});
      const failure = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error: isRelayRefusal(error as never)
            ? "Our email provider refused to send the code. This is a problem with our sending account, so trying again will not help."
            : "We could not send the code. Please try again shortly.",
          detail: failure,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("[staff:request]", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
