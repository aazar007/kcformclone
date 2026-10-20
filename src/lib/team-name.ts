/**
 * Team-name rules.
 *
 * Every team is announced as "Team <something>", so the name is normalised
 * rather than merely validated: whatever the captain types, the stored name
 * begins with the word "Team" and never contains it twice.
 *
 * The same normalisation produces the key used for uniqueness, so "Falcons" and
 * "team falcons" cannot both be registered.
 */

/** The word every team name must begin with, and must not repeat. */
export const TEAM_PREFIX = "Team";

/** Longest accepted team name, prefix included. */
export const TEAM_NAME_MAX = 40;
export const TEAM_NAME_MIN = 3;

/** Word-boundary match for "team" in any casing. */
const TEAM_WORD = /\bteam\b/i;

/**
 * Normalise a raw team name.
 *
 * - whitespace is collapsed and trimmed
 * - a name already starting with "Team" keeps its place, with the word
 *   canonicalised to the exact casing used everywhere else
 * - a name containing "Team" elsewhere is left alone, so "Blue Team" never
 *   becomes "Team Blue Team"
 * - anything else is prefixed with "Team "
 */
export function normaliseTeamName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";

  if (/^team\b/i.test(collapsed)) {
    // "team falcons" → "Team falcons" (the captain's casing for the rest stays).
    return `${TEAM_PREFIX}${collapsed.slice(TEAM_PREFIX.length)}`;
  }

  if (TEAM_WORD.test(collapsed)) return collapsed;

  return `${TEAM_PREFIX} ${collapsed}`;
}

/**
 * Whether the organisers' rule would add "Team" to what the captain typed.
 * Drives the live hint on the team step.
 */
export function needsTeamPrefix(raw: string): boolean {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 && !TEAM_WORD.test(collapsed);
}

/**
 * The uniqueness key for a team name: case-insensitive, whitespace-collapsed.
 * Computed from the normalised name so "FALCONS" and "Team Falcons" collide.
 */
export function teamNameKey(raw: string): string {
  return normaliseTeamName(raw).toLowerCase();
}

/**
 * What to tell the captain about their name, or `null` when nothing needs
 * saying.
 */
export function teamNameHint(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;

  const normalised = normaliseTeamName(collapsed);
  if (normalised === collapsed) {
    return /^team\b/i.test(collapsed)
      ? null
      : `${TEAM_PREFIX} is already part of your name, so we will not add it twice.`;
  }

  return `We will register you as “${normalised}”.`;
}
