import { NextResponse } from "next/server";
import {
  NOT_CONFIGURED_MESSAGE,
  UNAUTHORISED_MESSAGE,
  adminSecret,
  isAdminRequest,
} from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { findTeamById, setMemberBan, setTeamBan } from "@/lib/store";

export const dynamic = "force-dynamic";

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
 * Ban or reinstate a team, or one member of it.
 *
 * A ban is additive information, not a deletion: the row and its history stay,
 * the console keeps showing who they are, and lifting the ban restores the entry
 * exactly as it was. Deleting would lose the evidence an organiser needs when the
 * same person tries to register again under a different team name.
 *
 * Refusing a banned player on a *new* registration is done by the public API's
 * clash check, which reads `bannedAt` on both the member and their team.
 */
export async function POST(
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

  const payload = (body ?? {}) as {
    scope?: unknown;
    memberId?: unknown;
    banned?: unknown;
    reason?: unknown;
  };

  const scope = payload.scope === "member" ? "member" : "team";
  const banned = payload.banned === true;
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const memberId = typeof payload.memberId === "string" ? payload.memberId : "";

  try {
    const team = await findTeamById(id);
    if (!team) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    if (scope === "member") {
      if (!memberId) {
        return NextResponse.json({ error: "Name the member to change." }, { status: 400 });
      }
      if (!team.members.some((member) => member.id === memberId)) {
        return NextResponse.json({ error: "That member is not on this team." }, { status: 404 });
      }

      const updated = await setMemberBan(memberId, banned, reason);
      if (!updated) {
        return NextResponse.json({ error: "That member no longer exists." }, { status: 404 });
      }

      return NextResponse.json({ ok: true, scope, memberId, banned });
    }

    const updated = await setTeamBan(id, banned, reason);
    if (!updated) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, scope, banned });
  } catch (error) {
    console.error("[admin:team:ban]", error);
    return NextResponse.json({ error: "Could not change that ban." }, { status: 502 });
  }
}
