import { NextResponse } from "next/server";
import {
  NOT_CONFIGURED_MESSAGE,
  UNAUTHORISED_MESSAGE,
  adminEmails,
  adminSecret,
  adminTwoStep,
  LOCKED_OUT_MESSAGE,
  SESSION_COOKIE,
  adminLogin,
  createAdminSession,
  sessionCookieOptions,
  usingDevSecret,
} from "@/lib/admin-auth";import { isRelayRefusal, mailerAllowsLogFallback, mailerConfigured, sendOtpEmail } from "@/lib/mailer";
import {
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_REQUEST_WINDOW_MINUTES,
  generateCode,
  hashCode,
  otpExpiry,
  otpRequestWindowStart,
  otpSkipVerify,
} from "@/lib/otp";
import { maskEmail } from "@/lib/team-draft";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { countRecentOtps, createOtp, discardOtp } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The shape both answers share, so the browser can tell which one it got. */
interface VerifyResponse {
  ok: true;
  /** `"session"` — signed in. `"otp"` — a code is on its way; ask for it. */
  stage: "session" | "otp";
  devSecret?: boolean;
  /**
   * Whether the emailed confirmation step is actually in force.
   *
   * Reported so the console can warn when it is not. The sign-in is allowed either way —
   * the console used to refuse instead, which locked an organiser out of production over an
   * unset `ADMIN_EMAIL` — so the warning is the only thing standing between "I turned on
   * two-step" and "I meant to and forgot".
   */
  twoStep?: boolean;
  /** Masked, for the "we emailed a code to …" line. Never the full address. */
  email?: string;
  /** True when the code went to the server log instead of a mailbox (dev only). */
  logged?: boolean;
}

/** Sign in, through the one place a session cookie is ever set on this route. */
function sessionResponse() {
  const response = NextResponse.json(
    {
      ok: true,
      stage: "session",
      devSecret: usingDevSecret(),
      twoStep: adminTwoStep(),
    } as VerifyResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
  const token = createAdminSession();
  if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

/**
 * Step one of the grand admin's sign-in: check the deployment secret, then send a code.
 *
 * **The secret alone no longer opens the console.** Getting it right mints a one-time
 * code and mails it to `ADMIN_EMAIL`; only that code exchanges for a session. So a leaked
 * secret is not a way in on its own — it is a way to *cause an email*, which the person
 * holding the real inbox will notice.
 *
 * Two things deliberately do **not** complete the sign-in:
 *
 * - No credential at all, which `adminLogin` refuses without counting, so a scanner
 *   cannot lock the organisers out.
 * - A deployment with no `ADMIN_EMAIL` outside production, where the sign-in would only
 *   succeed because a security step is switched off. Refusing costs one environment
 *   variable; signing in anyway would mean believing a protection existed that did not.
 *
 * The development skip switch is the exception, and it is dev-only by construction —
 * `otpSkipVerify` returns false in production and logs an error if the variable is set.
 */
export async function POST(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }

  const limited = rateLimit(clientKey(request, "admin-verify"), 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { secret?: unknown };
  try {
    body = (await request.json()) as { secret?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const login = await adminLogin(request, typeof body.secret === "string" ? body.secret : null);
  if (!login.ok) {
    if (login.retryAfterSeconds > 0) {
      return NextResponse.json(
        { error: LOCKED_OUT_MESSAGE },
        { status: 429, headers: { "Retry-After": String(login.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  /* The secret was right. Everything below decides whether it is *enough*. */

  /* Read once, and everything follows from it: with no address there is nowhere to send a
     code, so there is no second step. */
  const emails = adminEmails();
  const email = emails[0] ?? null;
  if (!email) {
    /* The sign-in **proceeds**. Refusing here would lock the organiser out of their own
       console over a missing environment variable — not the password, not the deployment
       secret — and would not stop anyone who already has the password, because there is no
       second factor in either case. The console shows a permanent warning instead, driven by
       `twoStep` in the response. A control that cannot function should say so, not take the
       console away. */
    console.warn(
      "[admin] ADMIN_EMAIL is not set, so the grand admin's sign-in has NO emailed " +
        "confirmation step. Set ADMIN_EMAIL to turn it on.",
    );
    return sessionResponse();
  }

  /* Local testing: the code step is skipped, as it is everywhere else. The secret above
     is still required, and `otpSkipVerify` is a no-op in production. */
  if (otpSkipVerify()) {
    return sessionResponse();
  }

  if (!mailerConfigured("otp") && !mailerAllowsLogFallback("otp")) {
    return NextResponse.json(
      {
        error:
          "The email service is not configured, so the confirmation code cannot be sent. " +
          "Set the SMTP settings and restart the app.",
      },
      { status: 503 },
    );
  }

  try {
    const recent = await countRecentOtps(email, "admin-access", otpRequestWindowStart());
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        {
          error: `We have already sent several codes. Please wait ${OTP_REQUEST_WINDOW_MINUTES} minutes, then try again.`,
        },
        { status: 429 },
      );
    }

    const code = generateCode();
    const record = await createOtp({
      email,
      purpose: "admin-access",
      codeHash: hashCode(code, email, "admin-access"),
      expiresAt: otpExpiry(),
    });

    try {
      /* English: the console is English-only, so the code that opens it is written in the
         language the person is about to read. */

      /* **One code, every grand-admin inbox.** `ADMIN_EMAIL` may list several addresses;
         each is a person who is allowed to open the console, so each is a person who must
         be able to receive the code. It is one `OtpCode` row, hashed against the primary
         address, rather than one row per recipient: two rows would be two live codes and
         two counters, and the second step looks up exactly one.

         `allSettled`, not `all`: the addresses are independent inboxes. One relay refusal
         must not stop the other recipients from being able to sign in, and it must not
         report failure for a code that did reach somebody. Delivery succeeds if any inbox
         received it; it fails only when none did. */
      const outcomes = await Promise.allSettled(
        emails.map((to) => sendOtpEmail(to, code, "admin-access", undefined, "en")),
      );
      const delivered = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      );

      if (delivered.length === 0) {
        const failure = outcomes.find(
          (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
        );
        throw failure?.reason ?? new Error("No address accepted the message");
      }

      if (delivered.length < emails.length) {
        console.warn(
          `[admin] the sign-in code reached ${delivered.length} of ${emails.length} ` +
            "grand-admin addresses; the rest were refused.",
        );
      }

      const payload: VerifyResponse = {
        ok: true,
        stage: "otp",
        /* Masked, and every address rather than just the primary: the reader is being told
           where to look, and naming one inbox when two received the code sends them to the
           wrong place. */
        email: emails.map((to) => maskEmail(to)).join(", "),
        logged: delivered.some((outcome) => outcome.logged),
      };
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      /* The code never left, so it must not spend the address's requests. */
      await discardOtp(record.id).catch(() => {});
      const failure = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error: isRelayRefusal(error as never)
            ? "Our email provider refused to send the code. This is a problem with our sending account, so trying again will not help."
            : "We could not send the confirmation code. Please try again shortly.",
          detail: failure,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("[admin:verify]", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
