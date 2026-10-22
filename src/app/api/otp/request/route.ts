import { NextResponse } from "next/server";
import {
  sendOtpEmail,
  mailerConfigured,
  mailerAllowsLogFallback,
  isRelayRefusal,
} from "@/lib/mailer";
import {
  OTP_GLOBAL_MAX_PER_WINDOW,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_REQUEST_WINDOW_MINUTES,
  OTP_TTL_MINUTES,
  generateCode,
  hashCode,
  normaliseEmail,
  otpConfigured,
  otpExpiry,
  otpRequestWindowStart,
  otpSkipVerify,
} from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { countAllRecentOtps, countRecentOtps, createOtp, discardOtp, pruneOtps } from "@/lib/store";
import { requestedLanguage } from "@/lib/i18n";
import { EMAIL_PATTERN } from "@/lib/validation";
import { loadConfig } from "@/lib/config-store";

export const dynamic = "force-dynamic";

/**
 * Send a verification code to a roster member's university address.
 *
 * Codes for editing a registration are issued by `/api/registrations/lookup`
 * instead, because that flow has to confirm the requester holds the reference
 * code first — accepting a caller-chosen address here would turn this into an
 * open relay.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const email = normaliseEmail(
    typeof (body as { email?: unknown })?.email === "string"
      ? ((body as { email: string }).email ?? "")
      : "",
  );

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      /* Shape only. Whether the address belongs to the member's university is decided
         where the university is known — `validateDraft` in the browser and
         `validatePayload` on the server — because this endpoint is also used by the
         edit flow, which has no university in hand. */
      { error: "Enter a valid university email address" },
      { status: 400 },
    );
  }

  /* Local testing: skip the email entirely. The flag is ignored in production (see
     `otpSkipVerify`), so this branch can never ship — but the address still has to
     be a well-formed university email, because the rest of the form treats it as one. */
  if (otpSkipVerify()) {
    return NextResponse.json({ ok: true, email, skipVerify: true });
  }

  if (!otpConfigured()) {
    return NextResponse.json(
      { error: "Email verification is not configured on this deployment." },
      { status: 503 },
    );
  }
  if (!mailerConfigured("otp") && !mailerAllowsLogFallback("otp")) {
    return NextResponse.json(
      { error: "Email verification is temporarily unavailable. Please contact the organisers." },
      { status: 503 },
    );
  }

  // A closed tournament has nothing to verify an address for; don't send mail.
  if (!(await loadConfig()).config.registrationOpen) {
    return NextResponse.json({ error: "Registration is closed." }, { status: 403 });
  }

  const limited = rateLimit(clientKey(request, "otp-request"), 12, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  try {
    // The durable limit: how many codes this address has asked for recently.
    const recent = await countRecentOtps(email, "player-email", otpRequestWindowStart());
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        {
          error: `We have already sent several codes to ${email}. Please wait ${OTP_REQUEST_WINDOW_MINUTES} minutes, then try again.`,
        },
        { status: 429 },
      );
    }

    /* The site-wide ceiling. A per-address cap is no bound at all against a script that
       changes the address each time — which is how an arbitrary number of rows and emails
       is achievable here. This caps the whole endpoint rather than one identity. */
    if ((await countAllRecentOtps("player-email", otpRequestWindowStart())) >= OTP_GLOBAL_MAX_PER_WINDOW) {
      console.warn("[otp:request] global verification-code ceiling reached; refusing");
      return NextResponse.json(
        { error: "We are sending a lot of codes right now. Please try again in a few minutes." },
        { status: 429 },
      );
    }

    const code = generateCode();
    /* The row is created before the send so a crash mid-send cannot leave a code
       delivered but unverifiable. It is the *send* that decides whether the row
       was earned — see the catch below. */
    const record = await createOtp({
      email,
      purpose: "player-email",
      codeHash: hashCode(code, email, "player-email"),
      expiresAt: otpExpiry(),
    });

    try {
      const sent = await sendOtpEmail(email, code, "player-email", undefined, requestedLanguage(body));

      // Housekeeping, not part of the response — failures here are harmless.
      void pruneOtps().catch(() => {});

      return NextResponse.json({
        ok: true,
        email,
        expiresInMinutes: OTP_TTL_MINUTES,
        delivered: sent.delivered,
        // Lets the UI tell a developer where to find the code.
        logged: sent.logged,
      });
    } catch (error) {
      /* The code never left the building, so it must not spend one of the
         address's five requests. Without this, five failed sends locked the
         student out with "we have already sent several codes" — which was false,
         and blamed them for a fault in our sending account. */
      await discardOtp(record.id).catch(() => {});

      /* A relay that answered and refused is the likeliest failure in practice,
         and "try again shortly" is the worst possible advice for it: the sending
         account is throttled, so retrying changes nothing and the person keeps
         pressing a button that cannot work. Say what actually happened, and say it
         is not their fault — a student reading "unusual sending activity" would
         assume they did something wrong.

         A relay that never answered is the opposite case, and gets the opposite
         advice: nothing is wrong with the account, so trying again is reasonable. */
      const refused = isRelayRefusal(error);
      console.error("[otp:request] could not send the code:", error);

      return NextResponse.json(
        {
          error: refused
            ? "Your email address is fine — this is a problem with our sending account, so trying again will not help. Please contact the organisers and tell them you could not get a verification code."
            : "We could not reach the email service just now. Please try again in a moment.",
          /* Lets the UI stop offering a retry that cannot succeed, and lets an
             organiser see the relay's own words when diagnosing. */
          deliveryFailed: true,
          detail: process.env.NODE_ENV !== "production" && refused ? (error as { response?: string }).response : undefined,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    /* Anything reaching here failed before or after the send — a database
       problem, most likely. The specific message above has already handled the
       delivery case. */
    console.error("[otp:request]", error);
    return NextResponse.json(
      { error: "We could not send the code. Please try again shortly." },
      { status: 502 },
    );
  }
}
