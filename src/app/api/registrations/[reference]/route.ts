import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config-store";
import { databaseConfigured } from "@/lib/db";
import { normaliseEmail, otpConfigured, playerProofChecker, verifyProof } from "@/lib/otp";import { clientKey, rateLimit } from "@/lib/rate-limit";
import { toTeamInput } from "@/lib/team-input";
import { leaderEmail, teamVerifiedEmails } from "@/lib/team-draft";
import {
  DuplicateValueError,
  findMemberClashes,
  findTeamByReference,
  findTeamNameClash,
  updateTeam,
} from "@/lib/store";
import { teamNameKey } from "@/lib/team-name";
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

    const email = leaderEmail(team);
    if (!email || !(await verifyProof(proof, normaliseEmail(email), "edit-access", team.id))) {
      return NextResponse.json(
        { error: "That editing session has expired. Reopen your registration to continue." },
        { status: 401 },
      );
    }

    const { config } = await loadConfig();

    // Edits close with registration, matching what the page already shows.
    if (!config.registrationOpen) {
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

    return NextResponse.json({
      ok: true,
      reference: updated.reference,
      updatedAt: updated.updatedAt.toISOString(),
      teamName: updated.teamName,
      memberCount: updated.members.length,
      leaderName: leader?.fullName ?? "",
      universities: Array.from(new Set(updated.members.map((member) => member.universityName))),
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
