/**
 * Push every stored registration into the Google Sheet.
 *
 *   npm run sheet:export
 *
 * The same operation the admin console's "Push to Sheet" button performs, for
 * when you want it from a terminal or a cron job. Rows already in the sheet are
 * skipped, so running it twice is harmless.
 */

import { appendRows, fail, listPlayers, loadEnv, type SheetRow } from "./lib/sheet-client";
import { teamsToPlayerRows } from "../src/lib/sheet-export";
import { listTeams } from "../src/lib/store";

loadEnv();

async function main() {
  if (!process.env.SHEET_WEBHOOK_URL?.trim()) {
    fail("SHEET_WEBHOOK_URL is not set — add it to .env (see the README).");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    fail("DATABASE_URL is not set — add it to .env.");
  }

  const teams = await listTeams();
  if (teams.length === 0) {
    console.log("\nNothing to export — the database holds no registrations.\n");
    return;
  }

  const wanted = teamsToPlayerRows(teams);
  console.log(`\n${teams.length} team(s) · ${wanted.length} row(s) in the database`);
  console.log("Reading the sheet to work out what is already there…");

  const existing = await listPlayers();
  const seen = new Set(
    existing
      .map((row) => `${row.Reference}|${row["Player #"]}`)
      .filter((key) => key !== "|"),
  );

  const fresh = wanted.filter((row) => !seen.has(`${row.Reference}|${row["Player #"]}`));
  const skipped = wanted.length - fresh.length;

  if (fresh.length === 0) {
    console.log(`\n✓ Up to date — all ${wanted.length} row(s) are already in the sheet.\n`);
    return;
  }

  // The script caps a single request, so send in batches.
  const BATCH = 500;
  let appended = 0;

  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH) as SheetRow[];
    const result = await appendRows(batch);
    appended += result.appended;
    console.log(`  appended ${appended}/${fresh.length}…`);
  }

  console.log(`\n✓ Exported ${appended} row(s)${skipped > 0 ? `, skipped ${skipped} already present` : ""}.\n`);
}

main().catch((error) => fail((error as Error).message));
