import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  sendOtpEmail,
  mailerConfigured,
  mailerAllowsLogFallback,
  isRelayRefusal,
} from "@/lib/mailer";
import {
  otpGlobalMax,
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
import { countAllRecentOtps, countRecentOtps, createOtp, discardOtp, findMemberClashes, pruneOtps } from "@/lib/store";
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
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  }

  /* Local testing: skip the email entirely. The flag is ignored in production (see
     `otpSkipVerify`), so this branch can never ship — but the address still has to
     be a well-formed university email, because the rest of the form treats it as one. */
  if (await otpSkipVerify()) {
    return NextResponse.json({ ok: true, email, skipVerify: true });
  }

  if (!(await otpConfigured())) {
    return NextResponse.json(
      { error: "Email verification is not configured on this deployment." },
      { status: 503 },
    );
  }
  if (!(await (await mailerConfigured("otp"))) && !(await mailerAllowsLogFallback("otp"))) {
    return NextResponse.json(
      { error: "Email verification is temporarily unavailable. Please contact the organisers." },
      { status: 503 },
    );
  }

  /* A closed tournament has nothing to verify an address for; don't send mail.
     A signed-in organiser is exempt, because the form they open from "View form"
     still needs the team leader's code before it can be submitted — unless the
     organisers have switched that exemption off for this window. */
  const otpConfig = (await loadConfig()).config;
  if (
    !otpConfig.registrationOpen &&
    !(otpConfig.allowOrganiserEntriesClosed && (await hasAdminSession(request)))
  ) {
    return NextResponse.json({ error: "Registration is closed." }, { status: 403 });
  }

  const limited = rateLimit(await clientKey(request, "otp-request"), 12, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  try {
    /*
     * **Is this address already registered? Asked before a code is sent, not after.**
     *
     * The live duplicate check cannot answer this, and deliberately so: it refuses to say
     * whether an *unproven* address is registered, because that would let a stranger sweep
     * student-number ranges and learn who has entered. The consequence was the wrong order
     * of work for the person the check exists to help — they verified an address, waited
     * for the code, entered it, and only then were told the address was already in use.
     *
     * Asking here fixes that, at the only moment the answer can be given without the oracle:
     * the requester has already named the address they want to receive mail at, and the
     * endpoint is capped at twelve requests per ten minutes per client. A sweep is therefore
     * thousands of times slower here than on the check endpoint, and every failed probe
     * spends that address's own quota. The alternative — a student spending a code and a
     * mail round trip on an address that can never be used — is the worse trade.
     *
     * A database that cannot answer must not block verification, so a failure here is logged
     * and the send proceeds: the authoritative clash check still runs on submit.
     */
    const clashes = await findMemberClashes([{ email, studentId: "" }]);
    if (clashes.some((clash) => clash.field === "email")) {
      return NextResponse.json(
        { error: "That email address is already registered", alreadyRegistered: true },
        { status: 409 },
      );
    }
  } catch (error) {
    console.warn("[otp:request] could not check the address for clashes:", error);
  }

  try {
    /* Both counts read the same window, and neither depends on the other — asked together
       they cost one round of latency instead of two. */
    const windowStart = otpRequestWindowStart();
    const [recent, allRecent, globalMax] = await Promise.all([
      countRecentOtps(email, "player-email", windowStart),
      /* The site-wide ceiling. A per-address cap is no bound at all against a script that
         changes the address each time — which is how an arbitrary number of rows and emails
         is achievable here. This caps the whole endpoint rather than one identity. */
      countAllRecentOtps("player-email", windowStart),
      otpGlobalMax(),
    ]);

    // The durable limit: how many codes this address has asked for recently.
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        {
          error: `We have already sent several codes to ${email}. Please wait ${OTP_REQUEST_WINDOW_MINUTES} minutes, then try again.`,
        },
        { status: 429 },
      );
    }

    if (allRecent >= globalMax) {
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
      codeHash: await hashCode(code, email, "player-email"),
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
