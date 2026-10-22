/**
 * Admin edits to a stored team.
 *
 * Separate from the player-facing endpoints on purpose:
 *
 * - **No email proofs.** A captain has to verify every address with a one-time
 *   code. An organiser fixing a typo has no such code and should not need one —
 *   they are the authority, not a claimant.
 * - **Roster composition is advised, not enforced.** Registration insists that a
 *   team name exactly a full starting line-up. An organiser may legitimately need
 *   to remove a disqualified player, or empty a roster mid-cleanup, and blocking
 *   that would leave them unable to fix the very data they are looking at. Field
 *   validity and uniqueness stay hard rules; the shape of the roster is reported
 *   back as a warning.
 *
 * Field-level rules come from the same primitives the public form uses
 * (`personNameError`, `EMAIL_PATTERN`, …), so "a valid name" cannot mean two
 * different things depending on which door you came through.
 */

import { isGender, isMemberRole, type Gender, type MemberRole } from "./games";
import {
  gameById,
  isGameAllowedForDivision,
  regionIsAllowed,
  requirementError,
  rosterRulesFor,
  universityById,
  type TournamentConfig,
} from "./tournament";
import { normaliseTeamName, TEAM_NAME_MAX, TEAM_NAME_MIN, teamNameKey } from "./team-name";
import type { TeamInput } from "./store";
import {
  DISCORD_PATTERN,
  EMAIL_PATTERN,
  GAME_TAG_PATTERN,
  personNameError,
  STUDENT_ID_PATTERN,
} from "./validation";
import { normalisePhone } from "./utils";
import { acceptedEmailDomains, emailMatchesUniversity } from "./universities";

/** One member as the admin form submits them. */
interface AdminMember {
  fullName?: unknown;
  gameTag?: unknown;
  universityId?: unknown;
  email?: unknown;
  studentId?: unknown;
  discord?: unknown;
  phone?: unknown;
  role?: unknown;
  requirements?: unknown;
}

export interface AdminTeamEdit {
  teamName?: unknown;
  gender?: unknown;
  gameId?: unknown;
  leaderIndex?: unknown;
  members?: unknown;
}

export type AdminEditResult =
  | { ok: true; input: TeamInput; warnings: string[] }
  | { ok: false; errors: Record<string, string> };

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function answersFor(value: unknown, config: TournamentConfig, index: number) {
  const provided = Array.isArray(value) ? value : [];
  const byId = new Map<string, string>();

  for (const entry of provided) {
    if (typeof entry !== "object" || entry === null) continue;
    const answer = entry as { id?: unknown; value?: unknown };
    if (typeof answer.id !== "string") continue;
    byId.set(answer.id, answer.value === null || answer.value === undefined ? "" : String(answer.value));
  }

  return config.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    value: (byId.get(requirement.id) ?? "").trim(),
  }));
}

/**
 * Validate an admin edit and turn it into the shape `updateTeam` persists.
 *
 * `warnings` are things an organiser should see but may proceed past.
 */
export function validateAdminTeamEdit(
  body: AdminTeamEdit,
  config: TournamentConfig,
): AdminEditResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  /* ---- team ---- */
  const rawName = asString(body.teamName);
  const teamName = normaliseTeamName(rawName);
  if (!rawName) errors.teamName = "Required";
  else if (teamName.length < TEAM_NAME_MIN || teamName.length > TEAM_NAME_MAX) {
    errors.teamName = `Between ${TEAM_NAME_MIN} and ${TEAM_NAME_MAX} characters`;
  }

  if (!isGender(body.gender)) errors.gender = "Choose a division";
  const gender = (isGender(body.gender) ? body.gender : "") as Gender | "";

  const game = typeof body.gameId === "string" ? gameById(config, body.gameId) : null;
  if (!game) errors.game = "Choose a game";
  else if (gender && !isGameAllowedForDivision(config, game.id, gender)) {
    errors.game = `${game.name} is not offered in the ${gender} division`;
  }

  /* ---- roster ---- */
  const rows = Array.isArray(body.members) ? (body.members as AdminMember[]) : [];
  if (rows.length === 0) errors.members = "A team needs at least one member";

  const seenEmails = new Set<string>();
  const seenStudentIds = new Set<string>();
  const seenGameTags = new Set<string>();
  const usedUniversities = new Set<string>();

  const members: TeamInput["members"] = rows.map((row, index) => {
    const prefix = `member.${index}`;
    const role: MemberRole = isMemberRole(row?.role) ? row.role : "STARTER";
    const isCoach = role === "COACH";

    const fullName = asString(row?.fullName);
    const nameProblem = personNameError(fullName);
    if (nameProblem) errors[`${prefix}.fullName`] = nameProblem;

    const gameTag = asString(row?.gameTag);
    if (!gameTag) {
      if (!isCoach) errors[`${prefix}.gameTag`] = "Required";
    } else if (!GAME_TAG_PATTERN.test(gameTag)) {
      errors[`${prefix}.gameTag`] = "2–32 characters — letters, numbers, dots, dashes or #";
    } else if (seenGameTags.has(gameTag.toLowerCase())) {
      errors[`${prefix}.gameTag`] = "Already used by another member";
    } else {
      seenGameTags.add(gameTag.toLowerCase());
    }

    const universityId = asString(row?.universityId);
    const university = universityId ? universityById(config, universityId) : null;
    if (!university) {
      errors[`${prefix}.university`] = "Choose a university";
    } else if (!regionIsAllowed(config, university.region)) {
      errors[`${prefix}.university`] = `Universities in ${university.region} are not open for this tournament`;
    } else {
      usedUniversities.add(university.id);
    }

    const email = asString(row?.email).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      errors[`${prefix}.email`] = "Enter a valid email address";
    } else if (university && !emailMatchesUniversity(email, university)) {
      /* The same strict rule as the public form. Organisers can edit a team, and an
         edit is not a way to put another institution's address on a roster — the
         university on the row decides which domains are acceptable. */
      errors[`${prefix}.email`] =
        `${email} is not a ${university.name} address (expected ${acceptedEmailDomains(university)[0]})`;
    } else if (seenEmails.has(email)) {
      errors[`${prefix}.email`] = "Already used by another member";
    } else {
      seenEmails.add(email);
    }

    const studentId = asString(row?.studentId);
    if (!studentId) {
      if (!isCoach) errors[`${prefix}.studentId`] = "Required";
    } else if (!STUDENT_ID_PATTERN.test(studentId)) {
      errors[`${prefix}.studentId`] = "4–20 numbers";
    } else if (seenStudentIds.has(studentId.toLowerCase())) {
      errors[`${prefix}.studentId`] = "Already used by another member";
    } else {
      seenStudentIds.add(studentId.toLowerCase());
    }

    const discord = asString(row?.discord);
    if (!discord) errors[`${prefix}.discord`] = "Required";
    else if (!DISCORD_PATTERN.test(discord)) {
      errors[`${prefix}.discord`] = "2–32 characters — letters, numbers, dots or underscores";
    }

    const phone = asString(row?.phone);
    if (!phone) errors[`${prefix}.phone`] = "Required";
    else if (!normalisePhone(phone)) errors[`${prefix}.phone`] = "Enter a Saudi mobile, e.g. 05X XXX XXXX";

    const requirements = answersFor(row?.requirements, config, index);
    for (const requirement of config.requirements) {
      const answer = requirements.find((entry) => entry.id === requirement.id)?.value;
      const message = requirementError(requirement, answer);
      if (message) errors[`${prefix}.req.${requirement.id}`] = message;
    }

    return {
      fullName,
      gameTag,
      universityId: university?.id ?? universityId,
      universityName: university?.name ?? "",
      universityRegion: university?.region ?? "Other",
      email,
      studentId,
      discord,
      phone: normalisePhone(phone) ?? phone,
      role,
      requirements,
    };
  });

  /* ---- leader ---- */
  const leaderIndex =
    typeof body.leaderIndex === "number" && Number.isInteger(body.leaderIndex)
      ? body.leaderIndex
      : null;

  if (leaderIndex === null || leaderIndex < 0 || leaderIndex >= members.length) {
    errors.leader = "Choose the team leader";
  } else if (members[leaderIndex]?.role === "COACH") {
    errors.leader = "The team leader must be a player, not a coach";
  }

  /* ---- composition: advisory for an admin ---- */
  if (game && members.length > 0) {
    const rules = rosterRulesFor(config, game);
    const starters = members.filter((member) => member.role === "STARTER").length;
    const substitutes = members.filter((member) => member.role === "SUBSTITUTE").length;
    const coaches = members.filter((member) => member.role === "COACH").length;

    if (starters !== rules.starters) {
      warnings.push(
        `${game.name} fields exactly ${rules.starters} starter${rules.starters === 1 ? "" : "s"}, and this roster has ${starters}. It cannot be registered again until that matches.`,
      );
    }
    if (substitutes > rules.maxSubstitutes) {
      warnings.push(`${game.name} allows at most ${rules.maxSubstitutes} substitute${rules.maxSubstitutes === 1 ? "" : "s"}.`);
    }
    if (coaches > rules.maxCoaches) {
      warnings.push(`${game.name} allows at most ${rules.maxCoaches} coach${rules.maxCoaches === 1 ? "" : "es"}.`);
    }
    if (members.length > rules.maxTotal) {
      warnings.push(`The maximum roster size is ${rules.maxTotal} people.`);
    }
  }

  if (!config.allowMixedUniversities && usedUniversities.size > 1) {
    warnings.push("This tournament requires every member to come from the same university.");
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    input: {
      tournamentName: config.tournamentName,
      teamName,
      teamNameKey: teamNameKey(teamName),
      gender: gender as Gender,
      gameId: game!.id,
      gameName: game!.name,
      leaderIndex: leaderIndex!,
      members,
    },
  };
}
