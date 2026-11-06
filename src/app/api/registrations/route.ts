import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/app-url";
import { UNAUTHORISED_MESSAGE, hasAdminSession, isAdminRequest } from "@/lib/admin-auth";
import {
  confirmationMailerReady,
  pendingMemberConfirmations,
  sendMemberConfirmationRequests,
  sendRegistrationConfirmation,
} from "@/lib/confirmation-email";
import { runAfterResponse } from "@/lib/deferred";
import { requestedLanguage } from "@/lib/i18n";
import { loadConfig } from "@/lib/config-store";
import { DatabaseNotConfiguredError, databaseConfigured } from "@/lib/db";
import { makeReference } from "@/lib/utils";
import { otpConfigured, otpSkipVerify, playerProofChecker } from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { validatePayload } from "@/lib/validation";
import { checkSheetConnection, sheetsConfigured } from "@/lib/sheets";
import { toTeamInput } from "@/lib/team-input";
import { applyDraftProfiles, withCompletionReceipts } from "@/lib/draft-merge";
import { consumeDraft, draftProfilesById } from "@/lib/draft-store";
import {
  DuplicateValueError,
  createTeam,
  findMemberClashes,
  findTeamNameClash,
  referenceExists,
  registrationCounts,
} from "@/lib/store";
import { teamNameKey } from "@/lib/team-name";

export const dynamic = "force-dynamic";

/**
 * Deployment diagnostic — open `/api/registrations` to see whether the database
 * and the optional spreadsheet export are reachable. Admin-only
 * (send the `x-admin-secret` header). Details are only spelled out outside
 * production, so a live site never advertises its own configuration.
 */
export async function GET(request: Request) {
  // Counts and service status are for organisers only — not for the public internet.
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const verbose = process.env.NODE_ENV !== "production";

  const database = (await databaseConfigured())
    ? await registrationCounts()
        .then((counts) => ({ ok: true as const, ...counts }))
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }))
    : { ok: false as const, error: "DATABASE_URL is not set" };

  const sheets = (await sheetsConfigured()) ? await checkSheetConnection() : null;

  const ok = database.ok;
  return NextResponse.json(
    {
      ok,
      database: verbose
        ? database
        : { ok: database.ok, ...(database.ok ? { teams: database.teams, players: database.players } : {}) },
      // The sheet is an export now, never a registration path.
      sheets: sheets
        ? { configured: true, ok: sheets.ok, ...(verbose ? { error: sheets.error } : {}) }
        : { configured: false },
    },
    { status: ok ? 200 : 503 },
  );
}

/** Register a team for KSU Crown. */
export async function POST(request: Request) {
  /* A real roster is a few kilobytes. Refuse anything far larger before parsing it,
     and limit how often one address can submit. */
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 200_000) {
    return NextResponse.json({ error: "That request is too large." }, { status: 413 });
  }
  const limited = rateLimit(await clientKey(request, "register"), 10, 10 * 60_000);
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

  if (!(await databaseConfigured())) {
    console.error("[registrations:create] DATABASE_URL is not set");
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  // Never trust the browser — the same rules run again here, against the same
  // tournament config the form was rendered from, plus the signed email proofs
  // that only the server can check.
  const { config } = await loadConfig();

  // "Registration closed" is a rule, not just a hidden form: refuse here too.
  //
  // An organiser who is signed in to the console is exempt. They reach the form
  // through "View form", and the point of that button is to be able to complete a
  // registration after the public window has shut — a team that turned up late, a
  // correction that has to be entered as a fresh entry. The exemption is the signed
  // session cookie, not a flag in the request body, so it cannot be forged by the
  // public form the way a query parameter could.
  if (
    !config.registrationOpen &&
    !(config.allowOrganiserEntriesClosed && (await hasAdminSession(request)))
  ) {
    return NextResponse.json(
      { error: "Registration is closed.", registrationClosed: true },
      { status: 403 },
    );
  }

  /*
   * Teammates fill in their own details before the captain submits, so the roster
   * on screen is only part of the answer: the rest lives in the draft. It is folded
   * in here, from the server's own copy, rather than trusting the browser to send
   * fields it never collected.
   *
   * The draft is optional — an older client, or a submission after the sweeper has
   * cleared an abandoned attempt, simply has nothing to merge.
   */
  const draftId = typeof (body as { draftId?: unknown })?.draftId === "string"
    ? (body as { draftId: string }).draftId
    : "";
  const draftSecret = typeof (body as { draftSecret?: unknown })?.draftSecret === "string"
    ? (body as { draftSecret: string }).draftSecret
    : "";
  const draftProfiles = draftId && draftSecret
    ? await draftProfilesById(draftId, draftSecret).catch(() => null)
    : null;

  const submitted = draftProfiles
    ? applyDraftProfiles(
        body,
        draftProfiles,
        typeof (body as { leaderIndex?: unknown })?.leaderIndex === "number"
          ? (body as { leaderIndex: number }).leaderIndex
          : null,
      )
    : body;

  const parsed = validatePayload(submitted, config, {
    // Without OTP_SECRET nothing can be verified, so every submission fails the
    // email check with a clear message rather than being waved through — unless
    // OTP_SKIP_VERIFY is on (local testing only), which accepts any address.
    verifyEmail: (await otpSkipVerify())
      ? () => true
      : (await otpConfigured())
        ? await playerProofChecker(body)
        : undefined,
  });
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Some details are invalid", errors: parsed.errors },
      { status: 400 },
    );
  }

  const data = parsed.data;

  /* The completion receipts are attached after validation: they are not something
     the browser may assert, and only a draft this caller proved they own can
     produce one. */
  if (draftProfiles) {
    data.members = withCompletionReceipts(data.members, draftProfiles, data.leaderIndex);
  }

  try {
    /* The friendly duplicate checks. The database constraints below are the real
       authority; these exist so the player is told *what* clashed. */
    const takenName = await findTeamNameClash(teamNameKey(data.teamName));
    if (takenName) {
      return NextResponse.json(
        { error: `The team name “${takenName}” is already taken`, field: "teamName" },
        { status: 409 },
      );
    }

    const clashes = await findMemberClashes(
      data.members.map((member) => ({ email: member.email, studentId: member.studentId })),
    );
    /* A banned player must not get a second entry — that is what the ban is for.
       Refused before the ordinary "already registered" answer, which would invite
       them to try another spelling. */
    const banned = clashes.filter((clash) => clash.banned);
    if (banned.length > 0) {
      return NextResponse.json(
        {
          error:
            banned.length === 1
              ? "One of your members is suspended and cannot be registered."
              : `${banned.length} of your members are suspended and cannot be registered.`,
          banned: banned.map((clash) => ({
            email: clash.email,
            studentId: clash.studentId,
            teamName: clash.teamName,
          })),
        },
        { status: 403 },
      );
    }
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error:
            clashes.length === 1
              ? "One of your members is already registered with another team"
              : `${clashes.length} of your members are already registered with another team`,
          alreadyRegistered: clashes.map((clash) => ({
            email: clash.email,
            studentId: clash.studentId,
            teamName: clash.teamName,
            field: clash.field,
          })),
          teamNames: Array.from(new Set(clashes.map((clash) => clash.teamName))),
        },
        { status: 409 },
      );
    }

    /* A minted reference can, very rarely, already belong to another team. That
       is the one outcome worth retrying with a fresh code. */
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = makeReference();
      if (await referenceExists(reference)) continue;

      try {
        const team = await createTeam(reference, toTeamInput(data));

        /* The draft has become a real registration, so it must not linger — its
           rows would look like a registration in progress whose captain has
           disappeared, and the sweeper would eventually delete them anyway. The
           completion tokens were carried into the team above, so links already in
           players' inboxes keep working. */
        if (draftId) {
          await consumeDraft(draftId, draftSecret).catch(() => {});
        }
        const leader = team.members[team.leaderIndex] ?? team.members[0];
        const baseUrl = await appBaseUrl(request);
        const language = requestedLanguage(body);
        const mailReady = await confirmationMailerReady();
        const pendingLinks = pendingMemberConfirmations(team).length;

        /* **Both sends start together, and the response does not wait for them.**
         *
         * They used to run one after the other — the leader's receipt first, then
         * each member in turn — so a three-person roster meant three SMTP sessions
         * back to back. The last member's link could leave minutes after the first,
         * which is exactly what was reported.
         *
         * Neither send can change what the captain is told: the team is stored and
         * the reference code is already on screen. So they are kicked off now
         * (concurrently) and finished after the response is flushed, which keeps the
         * submit button instant. `runAfterResponse` still keeps the request alive
         * until they complete, which serverless runtimes require. */
        await runAfterResponse(async () => {
          await Promise.allSettled([
            sendRegistrationConfirmation(team, baseUrl, language),
            sendMemberConfirmationRequests(team, baseUrl, language),
          ]);
        });

        return NextResponse.json(
          {
            ok: true,
            reference: team.reference,
            /*
             * The link the leader passes round the team. It opens the role-scoped
             * edit flow with the reference already filled in, so a player adds only
             * their own address — and the address is what decides which card they
             * see, never the link itself.
             */
            teamUrl: `${baseUrl.replace(/\/$/, "")}/?tab=edit&ref=${encodeURIComponent(team.reference)}`,
            submittedAt: team.createdAt.toISOString(),
            tournamentName: team.tournamentName,
            teamName: team.teamName,
            gameName: team.gameName,
            universities: Array.from(new Set(team.members.map((m) => m.universityName))),
            memberCount: team.members.length,
            leaderName: leader?.fullName ?? "",
            /* Whether mail can leave at all. The message itself is sent just after
               this response, so a broken relay is reported in the server log rather
               than failing a registration that has already been stored. */
            confirmationEmailSent: mailReady,
            memberConfirmationsQueued: mailReady ? pendingLinks : 0,
          },
          { status: 201 },
        );
      } catch (error) {
        if (error instanceof DuplicateValueError) {
          /* Two submissions raced and the database caught what the pre-check
             missed. A `P2002` names the constraint, not the row, so rather than
             guessing which member clashed, re-run the same lookup the pre-check
             uses and report what is actually there now. */
          const { field, message } = error.violation;

          const clashes =
            field === "teamName"
              ? []
              : await findMemberClashes(
                  data.members.map((member) => ({
                    email: member.email,
                    studentId: member.studentId,
                  })),
                ).catch(() => []);

          return NextResponse.json(
            {
              error: message,
              field,
              alreadyRegistered: clashes.map((clash) => ({
                email: clash.email,
                studentId: clash.studentId,
                teamName: clash.teamName,
                field: clash.field,
              })),
              teamNames: Array.from(new Set(clashes.map((clash) => clash.teamName))),
            },
            { status: 409 },
          );
        }
        throw error;
      }
    }

    console.error("[registrations:create] could not mint an unused reference code");
    return NextResponse.json(
      { error: "We could not save your registration. Please try again." },
      { status: 500 },
    );
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return NextResponse.json(
        { error: "Registration is temporarily unavailable. Please try again later." },
        { status: 503 },
      );
    }

    console.error("[registrations:create]", error);
    return NextResponse.json(
      {
        error: "We could not save your registration. Please try again.",
        detail: process.env.NODE_ENV !== "production" ? String(error) : undefined,
      },
      { status: 502 },
    );
  }
}
