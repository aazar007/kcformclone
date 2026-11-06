import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config-store";
import { databaseConfigured } from "@/lib/db";
import { isMemberRole } from "@/lib/games";
import { readProof } from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { findTeamById, findMemberClashes, updateMemberOwnProfile } from "@/lib/store";
import { mayEditOwnProfile, parseProofScope } from "@/lib/team-access";
import { validateMemberCompletion } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * A member editing **their own** card, from the role-scoped edit flow.
 *
 * The proof — minted by `/api/registrations/lookup` only after the address was
 * verified with a code — names the team, the role and the row. That is the whole
 * authorisation: the request cannot address a sibling, because the row comes from
 * the proof rather than from the body.
 *
 * Only the fields a member owns are accepted. Their university, address and role
 * belong to the roster the leader entered, and changing any of them from here would
 * be a way to defeat the university-domain rule or skip a student number.
 */
export async function PUT(request: Request) {
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "profile-save"), 30, 10 * 60_000);
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

  const raw = body as { proof?: unknown; profile?: unknown };
  const claims = await readProof(typeof raw?.proof === "string" ? raw.proof : "");
  const scope = parseProofScope(claims?.scope ?? null);

  if (!claims || claims.purpose !== "edit-access" || !scope) {
    return NextResponse.json(
      { error: "That editing session has expired. Reopen your registration to continue." },
      { status: 401 },
    );
  }

  if (!mayEditOwnProfile(scope.role) || !scope.memberId) {
    return NextResponse.json(
      { error: "That editing session is not for a player." },
      { status: 403 },
    );
  }

  try {
    const team = await findTeamById(scope.teamId);
    if (!team) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    const member = team.members.find((entry) => entry.id === scope.memberId);
    if (!member) {
      return NextResponse.json({ error: "That player is no longer on the team." }, { status: 404 });
    }

    if (team.bannedAt || member.bannedAt) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers.", banned: true },
        { status: 403 },
      );
    }

    const { config } = await loadConfig();
    const parsed = validateMemberCompletion(raw?.profile, config, {
      role: isMemberRole(member.role) ? member.role : "STARTER",
    });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Some details are invalid", errors: parsed.errors },
        { status: 400 },
      );
    }

    /* The student number is unique across every team, so a number already in use is
       reported against the field rather than surfacing as a database error. */
    if (parsed.data.studentId) {
      const clashes = await findMemberClashes([
        { email: "", studentId: parsed.data.studentId },
      ]);
      const other = clashes.find((clash) => clash.teamId !== team.id);
      if (other) {
        return NextResponse.json(
          {
            error: "Some details are invalid",
            errors: { studentId: "That student ID is already registered with another player" },
          },
          { status: 409 },
        );
      }
    }

    const saved = await updateMemberOwnProfile(team.id, member.id, parsed.data);
    if (!saved) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers.", banned: true },
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true, saved: true });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        {
          error: "Some details are invalid",
          errors: { studentId: "That student ID is already registered with another player" },
        },
        { status: 409 },
      );
    }

    console.error("[registrations:profile]", error);
    return NextResponse.json(
      { error: "We could not save your details. Please try again." },
      { status: 502 },
    );
  }
}
