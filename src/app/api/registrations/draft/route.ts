import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadConfig } from "@/lib/config-store";
import { runAfterResponse } from "@/lib/deferred";
import { databaseConfigured } from "@/lib/db";
import { pruneDrafts, upsertDraft, type DraftMemberFacts } from "@/lib/draft-store";
import { sendDraftCompletionRequest } from "@/lib/confirmation-email";
import { requestedLanguage } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { gameById, isGameAllowedForDivision, rosterRulesFor, universityById } from "@/lib/tournament";
import { EMAIL_PATTERN } from "@/lib/validation";
import { acceptedEmailDomains, emailMatchesUniversity } from "@/lib/universities";
import { isGender, isMemberRole } from "@/lib/games";
import { findMemberClashes } from "@/lib/store";

export const dynamic = "force-dynamic";

/** What the browser sends for one teammate: the three things the captain decides. */
interface DraftMemberPayload {
  role?: unknown;
  universityId?: unknown;
  email?: unknown;
}

/**
 * Start — or refresh — a registration draft and email every teammate their link.
 *
 * Called when the captain leaves the roster step, before anything is submitted.
 * That ordering is the point of the whole draft: a teammate's details arrive while
 * the captain is still on the review step, so the roster is complete by the time
 * they press Submit rather than days afterwards.
 *
 * The team name is **not** reserved: an abandoned attempt must not lock a name for
 * a team that never registered. Uniqueness is still checked on submission.
 */
export async function POST(request: Request) {
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  /* Each call can send mail, so the ceiling is tighter than a plain read. A real
     captain refreshes this once per roster change. */
  const limited = rateLimit(await clientKey(request, "draft"), 30, 10 * 60_000);
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

  const raw = (body ?? {}) as Record<string, unknown>;
  const { config } = await loadConfig();

  /* A closed tournament has nothing to draft. A signed-in organiser is exempt, for
     the same reason the form itself is. */
  if (
    !config.registrationOpen &&
    !(config.allowOrganiserEntriesClosed && (await hasAdminSession(request)))
  ) {
    return NextResponse.json(
      { error: "Registration is closed.", registrationClosed: true },
      { status: 403 },
    );
  }

  const gameId = typeof raw.gameId === "string" ? raw.gameId : "";
  const game = gameById(config, gameId);
  const gender = isGender(raw.gender) ? raw.gender : "";
  if (!game) {
    return NextResponse.json({ error: "Choose a game first." }, { status: 400 });
  }
  if (!gender || !isGameAllowedForDivision(config, game.id, gender)) {
    return NextResponse.json({ error: "Choose the section this team enters." }, { status: 400 });
  }

  const teamName = typeof raw.teamName === "string" ? raw.teamName.trim() : "";
  const rows = Array.isArray(raw.members) ? (raw.members as DraftMemberPayload[]) : [];
  const rules = rosterRulesFor(config, game);
  if (rows.length === 0 || rows.length > rules.maxTotal) {
    return NextResponse.json({ error: "That roster cannot be sent yet." }, { status: 400 });
  }

  const leaderIndex =
    typeof raw.leaderIndex === "number" && Number.isInteger(raw.leaderIndex)
      ? raw.leaderIndex
      : 0;
  if (leaderIndex < 0 || leaderIndex >= rows.length) {
    return NextResponse.json({ error: "Choose the team leader." }, { status: 400 });
  }

  /* Names are resolved here from the config, never taken from the browser: the
     university a row names decides which addresses are acceptable, and a
     hand-written request must not be able to invent one. */
  const members: DraftMemberFacts[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const role = isMemberRole(row?.role) ? row.role : "STARTER";
    const universityId = typeof row?.universityId === "string" ? row.universityId : "";
    const email = typeof row?.email === "string" ? row.email.trim().toLowerCase() : "";
    const university = universityId ? universityById(config, universityId) : null;

    /* A coach need not be a student, so their row may name no institution — the
       same exemption the public form makes. Everyone else must, because the
       university is what their address is checked against. */
    if (!university && role !== "COACH") {
      return NextResponse.json(
        { error: `Choose a university for member ${index + 1}.` },
        { status: 400 },
      );
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: `Enter a valid email for member ${index + 1}.` },
        { status: 400 },
      );
    }
    if (role !== "COACH" && university && !emailMatchesUniversity(email, university)) {
      return NextResponse.json(
        {
          error: `${email} is not a ${university.name} address (expected ${acceptedEmailDomains(university)[0]})`,
        },
        { status: 400 },
      );
    }

    members.push({
      role,
      universityId: university?.id ?? "",
      universityName: university?.name ?? "",
      universityRegion: university?.region ?? "Other",
      email,
    });
  }

  try {
    /*
     * **Duplicate and ban checks belong here too.**
     *
     * This is the first point at which the whole roster of addresses exists, and it
     * is what sends the emails. Letting a banned player, or somebody already on
     * another team, be entered and mailed here would mean the captain only learns at
     * the very end — after three teammates have been asked to fill in a form for a
     * team that cannot be registered.
     */
    const clashes = await findMemberClashes(members.map((member) => ({ email: member.email, studentId: "" })));
    const banned = clashes.filter((clash) => clash.banned);
    if (banned.length > 0) {
      return NextResponse.json(
        {
          error:
            banned.length === 1
              ? "One of these players is suspended and cannot be registered."
              : `${banned.length} of these players are suspended and cannot be registered.`,
          banned: banned.map((clash) => ({ email: clash.email, teamName: clash.teamName })),
        },
        { status: 403 },
      );
    }
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error:
            clashes.length === 1
              ? "One of these players is already registered with another team."
              : `${clashes.length} of these players are already registered with another team.`,
          alreadyRegistered: clashes.map((clash) => ({
            email: clash.email,
            teamName: clash.teamName,
          })),
        },
        { status: 409 },
      );
    }

    await pruneDrafts();

    /* The secret is minted once and returned to the browser, which sends it back on
       every refresh and on the submission. It must be reused rather than reissued:
       the row stores only its hash, so a new value would no longer match and the
       "refresh" would quietly become a second draft. */
    const provided = typeof raw.secret === "string" ? raw.secret : "";
    const secret = provided.length >= 20 ? provided : randomBytes(32).toString("base64url");
    const draftId = typeof raw.draftId === "string" ? raw.draftId : null;

    const draft = await upsertDraft({
      id: draftId,
      secret,
      facts: {
        teamName,
        tournamentName: config.tournamentName,
        gameName: game.name,
        gender,
        leaderIndex,
        members,
      },
    });

    /* The sends are started together and finished after the response, for the same
       reason the receipt is: the captain should not wait on SMTP to see the next
       step. Each teammate is emailed their own link. */
    if (draft.needsLink.length > 0) {
      const baseUrl = await appBaseUrl(request);
      const language = requestedLanguage(body);
      const recipients = draft.needsLink;
      await runAfterResponse(async () => {
        await Promise.allSettled(
          recipients.map((recipient) =>
            sendDraftCompletionRequest(
              { draftId: draft.id, teamName, tournamentName: config.tournamentName },
              recipient,
              baseUrl,
              language,
            ),
          ),
        );
      });
    }

    return NextResponse.json({
      ok: true,
      draftId: draft.id,
      secret,
      mailed: draft.needsLink.length,
      members: draft.members,
    });
  } catch (error) {
    console.error("[registrations:draft]", error);
    return NextResponse.json(
      {
        error: "We could not save your progress. Please try again.",
        detail: process.env.NODE_ENV === "production" ? undefined : String(error),
      },
      { status: 502 },
    );
  }
}
