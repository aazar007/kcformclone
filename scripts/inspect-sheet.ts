/**
 * Read back what the admin console has pushed into the Google Sheet.
 *
 *   npm run sheet:inspect
 *
 * The sheet is a mirror of the database, so this is for checking the export
 * rather than the registrations themselves. A discrepancy between this output
 * and the admin console means someone exported before the last edit.
 */

import { fail, listPlayers, loadEnv, type SheetRow } from "./lib/sheet-client";

loadEnv();

async function main() {
  const rows = await listPlayers();
  const players = rows.filter((row) => row["Player Email"]);

  const teams = new Map<string, SheetRow[]>();
  for (const row of players) {
    const key = row.Reference || row["Team Name"];
    const bucket = teams.get(key);
    if (bucket) bucket.push(row);
    else teams.set(key, [row]);
  }

  console.log(
    `\n${teams.size} registration(s) · ${players.length} person(s)\n${"-".repeat(72)}`,
  );

  for (const [reference, roster] of teams) {
    const first = roster[0];
    console.log(`\n${reference}  ${first["Team Name"]}  [${first.Division} / ${first.Game}]`);
    console.log(`  exported   : ${first["Submitted At"]}`);
    console.log(`  roster     : ${first["Roster Size"]} members`);

    for (const row of roster) {
      const person = row["Player Name"] || "";
      const email = row["Player Email"] || "";
      const studentId = row["Student ID"] || "";

      console.log(
        `    ${String(row["Player #"]).padStart(2)}. ${person.padEnd(22)} ${email.padEnd(30)} ${studentId.padEnd(14)} ${row.Role}${row["Is Leader"] === "Yes" ? "  ← LEADER" : ""}`,
      );
    }

    const flags = Array.from(
      new Set(roster.map((row) => row.Flags).filter((flag) => flag && flag.length > 0)),
    );
    if (flags.length > 0) console.log(`  ⚠ flags    : ${flags.join(", ")}`);
  }

  const flagged = players.filter((row) => row.Flags).length;
  console.log(`\n${"-".repeat(72)}`);
  console.log(`flagged person rows: ${flagged}`);
  if (flagged > 0) {
    console.log(
      "Flags are computed in the sheet itself. A flagged row means the same email,\n" +
        "student ID or team name appears under another reference code.",
    );
  }
}

main().catch((error) => fail((error as Error).message));
