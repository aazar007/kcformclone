import { NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { readProof } from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { findTeamById, reorderTeamMembers } from "@/lib/store";
import { mayEditPositions, parseProofScope } from "@/lib/team-access";

export const dynamic = "force-dynamic";

/**
 * Reorder the roster, as the team leader.
 *
 * **Order is the only thing this endpoint can change.** The leader is the one person
 * who knows who plays where, so they arrange the rows — but the details behind each
 * row belong to the person on it, and this endpoint has no way to touch them. That
 * is deliberate: a leader who could edit a teammate's phone number would be a
 * privacy problem, and one who could retype their student number could hand their
 * place to somebody else.
 *
 * The proof is what says this caller is the leader, and it is only minted after the
 * leader's own address was verified with a code.
 */
export async function PUT(request: Request) {
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const limited = rateLimit(await clientKey(request, "roster-save"), 30, 10 * 60_000);
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

  const raw = body as { proof?: unknown; order?: unknown };
  const claims = await readProof(typeof raw?.proof === "string" ? raw.proof : "");
  const scope = parseProofScope(claims?.scope ?? null);

  if (!claims || claims.purpose !== "edit-access" || !scope) {
    return NextResponse.json(
      { error: "That editing session has expired. Reopen your registration to continue." },
      { status: 401 },
    );
  }

  if (!mayEditPositions(scope.role)) {
    return NextResponse.json(
      { error: "Only the team leader can change the roster order." },
      { status: 403 },
    );
  }

  /* Every id, once each. A partial list would leave somebody without a position, and
     a repeated one would place two people in the same slot. */
  const order = Array.isArray(raw?.order)
    ? raw.order.filter((value): value is string => typeof value === "string")
    : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "Send the roster in its new order." }, { status: 400 });
  }

  try {
    const team = await findTeamById(scope.teamId);
    if (!team) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    if (team.bannedAt) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers.", banned: true },
        { status: 403 },
      );
    }

    const saved = await reorderTeamMembers(team.id, order);
    if (!saved) {
      return NextResponse.json(
        { error: "That roster does not match this registration any more. Reload and try again." },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, order });
  } catch (error) {
    console.error("[registrations:roster]", error);
    return NextResponse.json(
      { error: "We could not save the roster order. Please try again." },
      { status: 502 },
    );
  }
}
