import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { validateAdminTeamEdit, type AdminTeamEdit } from "@/lib/admin-edit";
import { loadConfig } from "@/lib/config-store";
import { databaseConfigured } from "@/lib/db";
import {
  DuplicateValueError,
  deleteTeam,
  findMemberClashes,
  findTeamById,
  findTeamNameClash,
  updateTeam,
} from "@/lib/store";
import { teamNameKey } from "@/lib/team-name";

export const dynamic = "force-dynamic";

/** Shared gate for both verbs. */
async function guard(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!(await databaseConfigured())) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 503 });
  }
  return null;
}

/**
 * Remove a team.
 *
 * Destructive and not undoable, so the reference is echoed back — that is what an
 * organiser needs if they have to explain, or rebuild, what they deleted.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guard(request);
  if (denied) return denied;

  const { id } = await params;

  try {
    const reference = await deleteTeam(id);
    if (!reference) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, reference });
  } catch (error) {
    console.error("[admin:team:delete]", error);
    return NextResponse.json({ error: "Could not remove that registration." }, { status: 502 });
  }
}

/**
 * Save an organiser's edit to a team and its roster.
 *
 * Validation is the admin variant (`validateAdminTeamEdit`): the same field rules
 * as the public form, but without email proofs and with roster composition
 * reported as a warning rather than a hard failure.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guard(request);
  if (denied) return denied;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  try {
    const team = await findTeamById(id);
    if (!team) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    const { config } = await loadConfig();
    const parsed = validateAdminTeamEdit((body ?? {}) as AdminTeamEdit, config);

    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Some details are invalid", errors: parsed.errors },
        { status: 400 },
      );
    }

    const { input, warnings } = parsed;

    /* Uniqueness against every *other* team. The database enforces it anyway, but
       checking first is what lets the organiser be told which field clashed. */
    const takenName = await findTeamNameClash(input.teamNameKey, id);
    if (takenName) {
      return NextResponse.json(
        {
          error: `The team name “${takenName}” is already taken`,
          errors: { teamName: "Another team already uses this name" },
        },
        { status: 409 },
      );
    }

    const clashes = await findMemberClashes(
      input.members.map((member) => ({ email: member.email, studentId: member.studentId })),
      id,
    );
    if (clashes.length > 0) {
      const errors: Record<string, string> = {};
      input.members.forEach((member, index) => {
        const clash = clashes.find(
          (candidate) =>
            candidate.email.toLowerCase() === member.email.toLowerCase() ||
            (member.studentId && candidate.studentId.toLowerCase() === member.studentId.toLowerCase()),
        );
        if (!clash) return;
        errors[clash.field === "studentId" ? `member.${index}.studentId` : `member.${index}.email`] =
          `Already registered with ${clash.teamName}`;
      });

      return NextResponse.json(
        {
          error:
            clashes.length === 1
              ? "One of these members is already registered with another team"
              : `${clashes.length} of these members are already registered with another team`,
          errors,
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

    const updated = await updateTeam(id, input);

    return NextResponse.json({
      ok: true,
      warnings,
      team: {
        id: updated.id,
        reference: updated.reference,
        teamName: updated.teamName,
        tournamentName: updated.tournamentName,
        gender: updated.gender,
        gameId: updated.gameId,
        gameName: updated.gameName,
        leaderIndex: updated.leaderIndex,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        members: updated.members,
      },
    });
  } catch (error) {
    if (error instanceof DuplicateValueError) {
      return NextResponse.json(
        { error: error.violation.message, fields: { [error.violation.field]: error.violation.message } },
        { status: 409 },
      );
    }

    console.error("[admin:team:update]", error);
    return NextResponse.json(
      {
        error: "Could not save those changes.",
        detail: process.env.NODE_ENV !== "production" ? String(error) : undefined,
      },
      { status: 502 },
    );
  }
}
