/**
 * Turning stored teams into spreadsheet rows.
 *
 * The sheet is an export, so its shape is defined entirely by what organisers
 * find useful to filter on: one flat row per person, with team-level values
 * repeated so no pivot ever needs a join.
 *
 * Values keep the vocabulary the database uses. Only `Division` is expanded to
 * a label, because Male/Female is how the competition is spoken about; `Role`
 * stays as STARTER/SUBSTITUTE/COACH so a column that has been exported across
 * both the old and new systems cannot end up with two spellings of one thing.
 */

import type { PlayerRow } from "./sheets";
import type { StoredTeam } from "./store";

const DIVISION_LABEL: Record<string, string> = { male: "Male", female: "Female" };

function divisionLabel(gender: string) {
  return DIVISION_LABEL[gender] ?? gender;
}

/**
 * Text that a spreadsheet may treat as a formula.
 *
 * Two separate hazards, and the first version of this only caught part of the second:
 *
 * - **A leading control character.** Excel and Sheets both ignore some leading whitespace
 *   when deciding what a cell *is*, so `"\n=1+1"` can be evaluated even though the formula
 *   character is not first. The old pattern listed `\t` and `\r` but **not `\n`**, which is
 *   an inconsistency rather than a decision — a line feed at the start of a cell is exactly
 *   as good a way in as a carriage return.
 * - **A formula character, possibly after whitespace**, which is the ordinary case.
 *
 * `\u0000-\u001F` covers the whole C0 range (NUL, tab, LF, CR, …), so nothing invisible can
 * sit in front of the formula character and hide it from this check.
 */
const FORMULA_START = /^[\u0000-\u001F]|^\s*[=+\-@]/;

/**
 * Defuse spreadsheet formulas in text that a stranger typed.
 *
 * Google Sheets and Excel treat a cell that begins with `=`, `+`, `-` or `@` as a formula
 * when a script writes it, and a crafted one can pull data out of the sheet or call out to
 * another server when an organiser opens it. A leading apostrophe makes the cell plain text
 * (and is not displayed). Phone numbers and IDs are validated as digits upstream and are
 * deliberately left alone.
 *
 * This is **defusal, not detection**: it does not try to decide whether a string is a
 * "real" formula, because the answer differs between applications and versions. Anything
 * that could be read as one is made plain text.
 */
export function plainText(value: string | null | undefined): string {
  const text = value ?? "";
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Answers are stored as JSON; tolerate anything that is not the expected shape. */
function formatRequirements(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const answer = entry as { label?: unknown; value?: unknown };
      const label = typeof answer.label === "string" ? answer.label : "";
      const text = answer.value === null || answer.value === undefined ? "" : String(answer.value);
      return text ? [`${label}: ${text}`] : [];
    })
    .join(" · ");
}

/** One row per person. Team-level values repeat on every row. */
export function teamToPlayerRows(team: StoredTeam): PlayerRow[] {
  const leader = team.members[team.leaderIndex] ?? team.members[0];

  return team.members.map((member, index) => ({
    Reference: team.reference,
    "Submitted At": team.createdAt.toISOString(),
    Tournament: team.tournamentName,
    "Team Name": plainText(team.teamName),
    Division: divisionLabel(team.gender),
    Game: team.gameName,
    "Roster Size": String(team.members.length),
    "Player #": String(index + 1),
    "Player Name": plainText(member.fullName),
    "Game Tag": plainText(member.gameTag),
    University: plainText(member.universityName),
    Region: plainText(member.universityRegion),
    "Player Email": plainText(member.email),
    "Student ID": member.studentId ?? "",
    Discord: plainText(member.discord),
    Phone: member.phone,
    Role: member.role,
    "Is Leader": index === team.leaderIndex ? "Yes" : "No",
    "Team Leader": plainText(leader?.fullName ?? ""),
    "Additional Requirements": plainText(formatRequirements(member.requirements)),
  }));
}

export function teamsToPlayerRows(teams: StoredTeam[]): PlayerRow[] {
  return teams.flatMap(teamToPlayerRows);
}
