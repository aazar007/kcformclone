import { NextResponse } from "next/server";
import {
  NOT_CONFIGURED_MESSAGE,
  UNAUTHORISED_MESSAGE,
  adminSecret,
  isAdminEmail,
  isOwnerRequest,
} from "@/lib/admin-auth";
import {
  deleteStaffAccess,
  grantStaffAccess,
  listStaffAccess,
  revokeStaffAccess,
} from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Who may sign in to the console besides the grand admin.
 *
 * Owner-only throughout. A granted staff member must not be able to see this list
 * — it is a list of colleagues' addresses — and must not be able to add to it,
 * or the first grant would be able to grant onwards and revoking one person would
 * mean auditing everybody.
 */

/**
 * Deliberately *not* `EMAIL_PATTERN`.
 *
 * That one insists on `.edu.sa` because it guards the student roster. Organisers
 * are not students: they may use a personal address, or a mailbox on the
 * tournament's own domain. Requiring a university address here would lock the
 * organisers out of their own console.
 */
const STAFF_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function normaliseEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function GET(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const staff = await listStaffAccess();
  return NextResponse.json(
    {
      staff: staff.map((entry) => ({
        email: entry.email,
        note: entry.note,
        addedAt: entry.addedAt,
        lastLoginAt: entry.lastLoginAt,
        revokedAt: entry.revokedAt,
        live: entry.revokedAt === null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Grant access to an address, or bring a revoked grant back. */
export async function POST(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  let body: { email?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const email = normaliseEmail(body.email);
  if (!STAFF_EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  /* A grant to the grand admin is meaningless — they hold the secret, not a row —
     and would let one address appear in the staff list as if it were a guest. */
  if (isAdminEmail(email)) {
    return NextResponse.json(
      { error: "That address is the grand admin; it does not need a grant." },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : "";
  const entry = await grantStaffAccess(email, note);

  return NextResponse.json(
    { ok: true, email: entry.email, live: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Withdraw access.
 *
 * `?hard=1` forgets the address entirely, for a typo. The default is a soft
 * revoke: the row survives with `revokedAt` set, so the record of who once had
 * access outlives the decision to take it away — and re-granting the same address
 * later does not silently inherit the old `addedAt`.
 */
export async function DELETE(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const url = new URL(request.url);
  const email = normaliseEmail(url.searchParams.get("email"));
  if (!email) {
    return NextResponse.json({ error: "Which address?" }, { status: 400 });
  }

  const hard = url.searchParams.get("hard") === "1";
  const changed = hard ? await deleteStaffAccess(email) : await revokeStaffAccess(email);
  if (!changed) {
    return NextResponse.json(
      { error: hard ? "No such address in the list." : "That address already has no access." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, email, removed: hard }, { headers: { "Cache-Control": "no-store" } });
}
