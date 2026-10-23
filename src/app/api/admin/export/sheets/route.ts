import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { teamsToPlayerRows } from "@/lib/sheet-export";
import { exportRows, sheetsConfigured } from "@/lib/sheets";
import { listTeams } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Push every stored registration into the Google Sheet.
 *
 * The database is the source of truth, so this is a one-way export: it exists
 * because organisers already work in spreadsheets, not because the sheet is part
 * of storing a registration. Rows already present are skipped, so pressing the
 * button twice does not double the sheet.
 */
export async function POST(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!(await databaseConfigured())) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set, so there is nothing to export." },
      { status: 503 },
    );
  }
  if (!(await sheetsConfigured())) {
    return NextResponse.json(
      {
        error:
          "SHEET_WEBHOOK_URL is not set. Deploy google-apps-script/Code.gs and add the /exec URL to the environment.",
      },
      { status: 503 },
    );
  }

  try {
    const teams = await listTeams();
    if (teams.length === 0) {
      return NextResponse.json({ ok: true, appended: 0, skipped: 0, total: 0 });
    }

    const rows = teamsToPlayerRows(teams);
    const outcome = await exportRows(rows);

    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[admin:export:sheets]", error);
    return NextResponse.json(
      {
        error: "Could not export to the sheet.",
        detail: process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : undefined,
      },
      { status: 502 },
    );
  }
}
