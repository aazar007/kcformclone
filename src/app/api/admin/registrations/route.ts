import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { listTeams, registrationCounts } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Every stored team, with its roster.
 *
 * Admin-only: the roster holds personal data (names, emails, phone numbers), so
 * unlike the config this must never be readable without the secret.
 *
 * Returned grouped by team rather than flattened, because that is how the console
 * presents it — a summary line per team that expands into the people.
 */
export async function GET(request: Request) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!databaseConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set, so there is nothing to read." },
      { status: 503 },
    );
  }

  try {
    const [teams, counts] = await Promise.all([listTeams(), registrationCounts()]);

    return NextResponse.json(
      { ok: true, teams, counts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin:registrations]", error);
    return NextResponse.json(
      {
        error: "Could not read the registrations.",
        detail: process.env.NODE_ENV !== "production" ? String(error) : undefined,
      },
      { status: 502 },
    );
  }
}
