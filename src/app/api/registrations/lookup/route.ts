import { createHmac } from "node:crypto";
import { NextResponse, after } from "next/server";
import { LOCKED_OUT_MESSAGE, adminLogin, adminSecret, hasAdminSession } from "@/lib/admin-auth";
import { loadConfig } from "@/lib/config-store";
import { databaseConfigured } from "@/lib/db";
import { digitsOnly } from "@/lib/i18n";
import { mailerAllowsLogFallback, mailerConfigured, sendOtpEmail } from "@/lib/mailer";
import {
  otpGlobalMax,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_REQUEST_WINDOW_MINUTES,
  OTP_TTL_MINUTES,
  generateCode,
  hashCode,
  makeProof,
  normaliseEmail,
  otpConfigured,
  otpExpiry,
  otpRequestWindowStart,
  safeEqual,
} from "@/lib/otp";
import { requestedLanguage } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import {
  claimOtpAttempt,
  consumeOtp,
  consumeOtpOnce,
  countAllRecentOtps,
  countRecentOtps,
  createOtp,
  discardOtp,
  findActiveOtp,
  findTeamByReference,
  pruneOtps,
} from "@/lib/store";
import { leaderEmail, teamToDraft } from "@/lib/team-draft";
import {
  accessRoleFor,
  memberRole,
  maySeeRoster,
  proofScope,
  type AccessRole,
} from "@/lib/team-access";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * A stand-in "leader email" for a reference that does not exist.
 *
 * Deterministic (the same unknown reference always masks the same way, matching
 * how a real team's masked address never changes between calls) and unguessable
 * without OTP_SECRET (so a caller cannot derive it themselves and tell it apart
 * from a real one). It is never used to send mail — see the Phase 1 comment below.
 */
async function fakeLeaderEmail(reference: string): Promise<string> {
  const secret = (await getEnv("OTP_SECRET"))?.trim() || "ksu-crown-lookup-fallback";
  const local = createHmac("sha256", secret).update(reference).digest("hex").slice(0, 10);
  return `${local}@ksu.edu.sa`;
}

/**
 * The two halves of "I want to edit my registration".
 *
 * Called without a code it mails a code to the team leader; called with the code
 * it returns the team loaded into an editable draft, plus a proof that this
 * caller is allowed to change it.
 *
 * A reference code alone is not treated as a password — it is short, it gets
 * forwarded around team chats, and it is the only thing standing between a
 * stranger and every member's phone number. Requiring the leader's inbox as well
 * costs one email and closes that off.
 *
 * That guarantee only holds if a reference that does not exist is answered
 * exactly like one that does — same status, same response shape, same checks —
 * because otherwise this endpoint becomes a yes/no oracle for which reference
 * codes are real. See the block below the organiser path for how that is kept
 * true without special-casing every branch.
 */
export async function POST(request: Request) {
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
  if (!(await otpConfigured())) {
    return NextResponse.json(
      { error: "Editing is not configured on this deployment." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "edit-lookup"), 10, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const raw = body as {
    reference?: unknown;
    code?: unknown;
    adminSecret?: unknown;
    email?: unknown;
  };
  const reference = (typeof raw?.reference === "string" ? raw.reference : "").trim().toUpperCase();
  const code = digitsOnly(typeof raw?.code === "string" ? raw.code : "");
  const presentedAdminSecret = typeof raw?.adminSecret === "string" ? raw.adminSecret : "";
  /* The address being claimed. Optional for compatibility with links minted before
     it was asked for, in which case the leader's address is assumed — which is
     exactly what those links meant. */
  const claimedEmail =
    typeof raw?.email === "string" ? normaliseEmail(raw.email) : "";

  if (!reference) {
    return NextResponse.json({ error: "Enter the reference code from your confirmation" }, { status: 400 });
  }

  try {
    const team = await findTeamByReference(reference);

    /* A ban is a decision about the entry, so the edit flow is closed to it. The
       console can still read and unban it. */
    if (team?.bannedAt) {
      return NextResponse.json(
        {
          error: "This registration has been suspended by the organisers.",
          banned: true,
        },
        { status: 403 },
      );
    }

    /* ---------------------------------------------------------------- */
    /* Who is claiming to be here?                                       */
    /* ---------------------------------------------------------------- */
    /*
     * The reference names a team; the address names a person on it. Only a pair that
     * actually belongs together has an identity, and only that identity is ever sent
     * a code — so an address with no row on this team gets the same answer as a
     * reference that does not exist, and learns nothing from it.
     *
     * The leader's address is the fallback for links minted before the address was
     * asked for: those links meant "the leader", so assuming them changes nothing.
     */
    const identified = team
      ? claimedEmail
        ? (team.members.find((member) => member.email.toLowerCase() === claimedEmail) ?? null)
        : null
      : null;

    /* A ban covers everybody on the team. Checking the member's own flag as well as
       the team's is what makes a per-player suspension close the same door. */
    if (team && identified && (team.bannedAt || identified.bannedAt)) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers.", banned: true },
        { status: 403 },
      );
    }

    /* ---------------------------------------------------------------- */
    /* Organiser path — no emailed code.                                 */
    /* ---------------------------------------------------------------- */
    /*
     * The code for a team goes to the *leader's* inbox, which is usually a
     * student's university address. An organiser helping a team out — "fix my
     * surname" — can neither read that inbox nor ask the student to relay a code.
     *
     * The admin secret is already the master key to every write in `/admin`, so
     * accepting it here grants strictly less than the console already allows: a
     * single registration, rather than every registration and every setting.
     *
     * The secret is checked *before* looking at whether the reference is real,
     * so a wrong secret always behaves the same way — and always counts toward
     * the lockout — whatever reference was sent alongside it. Only once the
     * caller has proven they hold the admin secret does this branch say whether
     * the reference exists; that is a deliberate, narrow exception to the
     * "never confirm a reference" rule below, granted to someone who has
     * already authenticated as the organiser.
     */
    if (presentedAdminSecret) {
      if (!(await adminSecret())) {
        return NextResponse.json(
          { error: "Organiser access is not configured on this deployment." },
          { status: 503 },
        );
      }
      const login = await adminLogin(request, presentedAdminSecret);
      if (!login.ok) {
        if (login.retryAfterSeconds > 0) {
          return NextResponse.json(
            { error: LOCKED_OUT_MESSAGE },
            { status: 429, headers: { "Retry-After": String(login.retryAfterSeconds) } },
          );
        }
        return NextResponse.json({ error: "That admin code is not correct." }, { status: 401 });
      }

      if (!team) {
        return NextResponse.json(
          { error: "No registration matches that reference code" },
          { status: 404 },
        );
      }

      const leaderAddress = leaderEmail(team);
      if (!leaderAddress) {
        return NextResponse.json(
          { error: "That registration has no contact address on file. Contact the organisers." },
          { status: 409 },
        );
      }

      const { config } = await loadConfig();
      return NextResponse.json({
        ok: true,
        stage: "verified",
        openedAs: "organiser",
        role: "ORGANISER" satisfies AccessRole,
        reference: team.reference,
        teamName: team.teamName,
        gameName: team.gameName,
        proof: await makeProof(
          normaliseEmail(leaderAddress),
          "edit-access",
          proofScope(team.id, "ORGANISER", ""),
        ),
        /* An organiser outranks every role in this flow, so the full editable draft
           stays available to them — the console already grants this and more. */
        draft: teamToDraft(team, config),
        roster: team.members.map((member) => ({
          id: member.id,
          position: member.position,
          fullName: member.fullName,
          role: memberRole(member.role),
        })),
      });
    }

    /*
     * Everything from here on runs the same way whether `team` is real or not.
     * An unknown reference is given a deterministic, unguessable stand-in
     * "leader email" (see fakeLeaderEmail above) and is carried through the
     * exact same rate limits, OTP table and code checks as a real team, so its
     * response is indistinguishable in shape, status and (for the durable,
     * per-identity limits) rate-limiting behaviour. The only two differences:
     * no mail is ever sent for an unknown reference — there is no inbox to send
     * it to — and the final "editing unlocked" response below is only ever
     * reachable when `team` is real, because a fake identity's stored code is
     * never handed to anyone.
     */
    /*
     * The address a code would go to. For a real team this is the row the caller
     * named — the leader's when they named nobody — and for anything else it is a
     * deterministic stand-in that is never delivered.
     */
    const identity = team
      ? claimedEmail
        ? identified?.email ?? null
        : leaderEmail(team)
      : null;

    const deliverable = Boolean(team && identity);
    const normalised = normaliseEmail(
      identity ?? (await fakeLeaderEmail(`${reference}:${claimedEmail}`)),
    );

    /* ---------------------------------------------------------------- */
    /* Phase 1 — no code yet: send one to the leader.                    */
    /* ---------------------------------------------------------------- */
    if (!code) {
      /* Edits close with registration, so there is nothing to send a code for —
         except for a signed-in organiser, who may reopen an entry after the window
         has shut to correct it. */
      const lookupConfig = (await loadConfig()).config;
      if (
        !lookupConfig.registrationOpen &&
        !(lookupConfig.allowOrganiserEntriesClosed && (await hasAdminSession(request)))
      ) {
        return NextResponse.json(
          { error: "Registration is closed, so registrations can no longer be edited." },
          { status: 403 },
        );
      }

      if (!(await (await mailerConfigured("otp"))) && !(await mailerAllowsLogFallback("otp"))) {
        return NextResponse.json(
          { error: "Email is temporarily unavailable. Please contact the organisers." },
          { status: 503 },
        );
      }

      /* The durable cap: however many instances or addresses the requests come from,
         one identity is sent (or, for an unknown reference, charged as if sent) at most
         a handful of edit codes per window. This is what stops a known or guessed
         reference code being used to spam the captain, or to probe this endpoint
         faster than the per-client rate limit above allows. */
      const recent = await countRecentOtps(normalised, "edit-access", otpRequestWindowStart());
      if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
        return NextResponse.json(
          {
            error: `We have already sent several codes for this registration. Please wait ${OTP_REQUEST_WINDOW_MINUTES} minutes, then try again.`,
          },
          { status: 429 },
        );
      }

      /*
       * The site-wide ceiling, and **it applies only to unknown references**.
       *
       * The per-identity cap above bounds nothing when the identity changes every request,
       * which is exactly what rotating references does: each unknown reference derives a
       * new address, so each one gets a fresh allowance and a new row. This ceiling is the
       * bound on that.
       *
       * It used to refuse *everybody* once tripped, which handed any script a trivial denial
       * of service: burn the quota with junk references and no team can fetch an edit code
       * for the rest of the window. Measured — with the ceiling at four, seven consecutive
       * requests were refused including legitimate ones.
       *
       * So for a **real** reference it does not refuse. Growth from real references is
       * already bounded by something much tighter: their address is fixed, so the
       * per-identity cap of five per window applies, and the number of real teams is finite.
       * For an **unknown** reference it does refuse to *create a row* — but it still answers
       * exactly as it would have, because the response never depended on that row. The
       * attacker gets the same 200 and the same body; the only thing that stops is the
       * growth. Nothing observable changes, so this is not a new oracle.
       */
      const overGlobalCeiling =
        (await countAllRecentOtps("edit-access", otpRequestWindowStart())) >= (await otpGlobalMax());

      if (!deliverable && overGlobalCeiling) {
        console.warn(
          "[registrations:lookup] site-wide edit-code ceiling reached; answering normally " +
            "without creating a row for an unknown reference",
        );
        return NextResponse.json(
          { ok: true, stage: "code-sent", reference, expiresInMinutes: OTP_TTL_MINUTES },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const fresh = generateCode();
      const record = await createOtp({
        email: normalised,
        purpose: "edit-access",
        codeHash: await hashCode(fresh, normalised, "edit-access"),
        expiresAt: otpExpiry(),
      });

      /* Kept tidy on every path, not just the unknown-reference one: 24 hours of rows is
         plenty for an OTP, and pruning here keeps the growth of the table tied to real use
         rather than to how long the process has been up. */
      void pruneOtps().catch(() => {});

      if (deliverable) {
        /*
         * Sent **after** the response, on purpose.
         *
         * Awaiting the SMTP round trip here made a real reference take seconds while an
         * unknown one returned in milliseconds — a timing oracle that needed no guessing and
         * no failure to observe. The send still happens, and still gets its error handling;
         * it simply no longer decides how long the reply takes. `after` is Next's hook for
         * exactly this: work that must complete before the function is frozen, but must not
         * delay the response.
         *
         * A send that fails is logged and the row is discarded, so a code that never left
         * does not spend one of the team's sends. The caller is not told which happened —
         * that distinction is the oracle — so the response is the same for every reference.
         */
        after(async () => {
          try {
            await sendOtpEmail(normalised, fresh, "edit-access", team!.teamName, requestedLanguage(body));
          } catch (mailError) {
            await discardOtp(record.id).catch(() => {});
            console.error("[registrations:lookup] could not send the edit code:", mailError);
          }
        });
      }

      /*
       * One body for every reference, real or not.
       *
       * It used to carry `maskedEmail`, and that alone gave the game away three ways: the
       * unknown-reference stand-in was `@ksu.edu.sa` with a ten-character local part while
       * every real team is `@student.ksu.edu.sa` with nine, so the mask itself said whether
       * the reference existed. It also disclosed part of a real address to anyone who typed
       * a reference code they had found. Neither is worth the convenience of showing the
       * captain an inbox they already know: they are reading the code out of a message we
       * sent them, so the address is not news to them.
       */
      return NextResponse.json({
        ok: true,
        stage: "code-sent",
        reference,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    }

    /* ---------------------------------------------------------------- */
    /* Phase 2 — code supplied: check it and unlock editing.             */
    /* ---------------------------------------------------------------- */
    const record = await findActiveOtp(normalised, "edit-access");
    if (!record) {
      return NextResponse.json(
        { error: "That code has expired. Start again to get a new one." },
        { status: 400 },
      );
    }

    /* Spend the guess first, atomically, then compare. Checking the count and
       raising it in separate steps let simultaneous guesses all see "0 so far". */
    if (!(await claimOtpAttempt(record.id, OTP_MAX_ATTEMPTS))) {
      await consumeOtp(record.id).catch(() => {});
      return NextResponse.json(
        { error: "Too many incorrect attempts. Start again to get a new code." },
        { status: 429 },
      );
    }

    if (!safeEqual(await hashCode(code, normalised, "edit-access"), record.codeHash)) {
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (record.attempts + 1));
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `That code is not correct. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
              : "Too many incorrect attempts. Start again to get a new code.",
        },
        { status: 400 },
      );
    }

    // Single use: if a simultaneous request already spent this code, this one gets nothing.
    if (!(await consumeOtpOnce(record.id))) {
      return NextResponse.json({ error: "That code has already been used. Start again to get a new code." }, { status: 400 });
    }

    /* A code is only ever minted for a real identity in Phase 1 above and never
       delivered for a fake one, so a correct guess against an unknown reference or a
       non-member address is not just unlikely — it is unreachable. This check
       enforces that invariant rather than trusting it silently. */
    if (!team || !identity) {
      return NextResponse.json(
        { error: "That code has expired. Start again to get a new one." },
        { status: 400 },
      );
    }

    const member = team.members.find(
      (entry) => entry.email.toLowerCase() === normaliseEmail(identity),
    );
    if (!member) {
      return NextResponse.json(
        { error: "That code has expired. Start again to get a new one." },
        { status: 400 },
      );
    }

    const { config } = await loadConfig();
    const role = accessRoleFor(
      memberRole(member.role),
      member.position === team.leaderIndex,
    );

    /* The proof names the team, the role and the row, so every endpoint that acts on
       it can check its own part without re-deriving who this is from a reference
       code the browser could have changed in between. */
    const proof = await makeProof(
      normalised,
      "edit-access",
      proofScope(team.id, role, member.id),
    );

    return NextResponse.json({
      ok: true,
      stage: "verified",
      role,
      reference: team.reference,
      teamName: team.teamName,
      gameName: team.gameName,
      memberId: member.id,
      proof,
      /*
       * **Only what the role may see.**
       *
       * A player gets their own card and nothing else — no sibling names, no
       * addresses, no phone numbers. The leader gets every name and position so they
       * can order the roster, but not the personal details behind those names, which
       * were never theirs to know. An organiser's full draft is returned above.
       */
      self: {
        fullName: member.fullName,
        gameTag: member.gameTag,
        studentId: member.studentId ?? "",
        discord: member.discord,
        phone: member.phone,
        universityId: member.universityId,
        universityName: member.universityName,
        email: member.email,
        role: memberRole(member.role),
        requirements: Array.isArray(member.requirements) ? member.requirements : [],
        completedAt: member.profileCompletedAt
          ? member.profileCompletedAt.toISOString()
          : null,
      },
      roster: maySeeRoster(role)
        ? team.members.map((entry) => ({
            id: entry.id,
            position: entry.position,
            fullName: entry.fullName,
            role: memberRole(entry.role),
          }))
        : undefined,
      requiresSetup: member.profileCompletedAt === null,
    });
  } catch (error) {
    console.error("[registrations:lookup]", error);
    return NextResponse.json(
      { error: "We could not open that registration. Please try again." },
      { status: 502 },
    );
  }
}
