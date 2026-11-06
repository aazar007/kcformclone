import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { appBaseUrl } from "@/lib/app-url";
import { requestedLanguage } from "@/lib/i18n";
import {
  confirmationMailerReady,
  pendingMemberConfirmations,
  sendMemberConfirmationRequests,
} from "@/lib/confirmation-email";
import { runAfterResponse } from "@/lib/deferred";
import { loadConfig } from "@/lib/config-store";
import { databaseConfigured } from "@/lib/db";
import { normaliseEmail, otpConfigured, playerProofChecker, readProof } from "@/lib/otp";import { clientKey, rateLimit } from "@/lib/rate-limit";
import { toTeamInput } from "@/lib/team-input";
import { teamVerifiedEmails } from "@/lib/team-draft";
import {
  DuplicateValueError,
  findMemberClashes,
  findTeamByReference,
  findTeamNameClash,
  updateTeam,
} from "@/lib/store";
import { teamNameKey } from "@/lib/team-name";
import { parseProofScope } from "@/lib/team-access";
import { validatePayload } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Save an edit to an existing registration.
 *
 * Authorised by the signed proof issued by `/api/registrations/lookup`, which can
 * only be obtained by reading a code sent to the team leader's address. That is
 * also what lets the members' existing addresses count as verified — the captain
 * has proved they control the team, and re-verifying every player on every tweak
 * would make editing unusable.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
  if (!(await otpConfigured())) {
    return NextResponse.json({ error: "Editing is not configured on this deployment." }, { status: 503 });
  }

  const limited = rateLimit(await clientKey(request, "edit-save"), 20, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const { reference } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const raw = body as { proof?: unknown; payload?: unknown };
  const proof = typeof raw?.proof === "string" ? raw.proof : "";

  try {
    const team = await findTeamByReference(reference);
    if (!team) {
      return NextResponse.json({ error: "No registration matches that reference code" }, { status: 404 });
    }

    /*
     * **This is the organiser's door now.**
     *
     * It replaces a whole roster in one request, which is exactly the access a
     * leader must not have: their own edit flow changes the order of the rows and
     * nothing else, so that a leader can never read or rewrite a teammate's phone
     * number. A proof scoped to `LEADER`, `PLAYER`, `SUBSTITUTE` or `COACH` is
     * therefore refused here, and only `ORGANISER` — minted from the console's own
     * credential — is accepted.
     */
    const claims = await readProof(proof);
    const scope = parseProofScope(claims?.scope ?? null);
    if (
      !claims ||
      claims.purpose !== "edit-access" ||
      !scope ||
      scope.teamId !== team.id ||
      scope.role !== "ORGANISER"
    ) {
      return NextResponse.json(
        { error: "That editing session has expired. Reopen your registration to continue." },
        { status: 401 },
      );
    }

    /* A banned entry stays readable in the console but is not the captain's to
       change any more. */
    if (team.bannedAt) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers.", banned: true },
        { status: 403 },
      );
    }

    const { config } = await loadConfig();

    /* Edits close with registration, matching what the page already shows — except
       for a signed-in organiser, who uses the same form to correct an entry after the
       window has shut. The exemption is the session cookie, so it cannot be claimed by
       an ordinary visitor. */
    if (
      !config.registrationOpen &&
      !(config.allowOrganiserEntriesClosed && (await hasAdminSession(request)))
    ) {
      return NextResponse.json(
        { error: "Registration is closed, so registrations can no longer be edited.", registrationClosed: true },
        { status: 403 },
      );
    }

    // Addresses already on this team stay verified; anything new needs its own proof.
    const parsed = validatePayload(raw?.payload, config, {
      alreadyVerified: teamVerifiedEmails(team),
      verifyEmail: await playerProofChecker(raw?.payload),
    });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Some details are invalid", errors: parsed.errors },
        { status: 400 },
      );
    }

    const data = parsed.data;

    const takenName = await findTeamNameClash(teamNameKey(data.teamName), team.id);
    if (takenName) {
      return NextResponse.json(
        { error: `The team name “${takenName}” is already taken`, field: "teamName" },
        { status: 409 },
      );
    }

    const clashes = await findMemberClashes(
      data.members.map((member) => ({ email: member.email, studentId: member.studentId })),
      team.id,
    );
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
        },
        { status: 409 },
      );
    }

    const updated = await updateTeam(team.id, toTeamInput(data));
    const leader = updated.members[updated.leaderIndex] ?? updated.members[0];

    /* Members added by this edit start pending, exactly as they would on a new
       registration; existing members keep their status, so nothing is re-emailed
       and no confirmation is forgotten. Started now, finished after the response —
       the save itself has already succeeded and should not wait for mail. */
    const mailReady = await confirmationMailerReady();
    const pendingLinks = pendingMemberConfirmations(updated).length;
    if (pendingLinks > 0) {
      const baseUrl = await appBaseUrl(request);
      const language = requestedLanguage(body);
      await runAfterResponse(() =>
        sendMemberConfirmationRequests(updated, baseUrl, language),
      );
    }

    return NextResponse.json({
      ok: true,
      reference: updated.reference,
      updatedAt: updated.updatedAt.toISOString(),
      teamName: updated.teamName,
      memberCount: updated.members.length,
      leaderName: leader?.fullName ?? "",
      universities: Array.from(new Set(updated.members.map((member) => member.universityName))),
      memberConfirmationsQueued: mailReady ? pendingLinks : 0,
    });
  } catch (error) {
    if (error instanceof DuplicateValueError) {
      return NextResponse.json(
        { error: error.violation.message, field: error.violation.field },
        { status: 409 },
      );
    }

    console.error("[registrations:update]", error);
    return NextResponse.json(
      { error: "We could not save your changes. Please try again." },
      { status: 502 },
    );
  }
}
