/**
 * Turning a stored registration back into something the wizard can edit.
 *
 * The edit tab loads a team into the very same `RegistrationDraft` the public
 * form uses, so there is one editor and one set of rules rather than a parallel
 * "edit form" that can drift.
 */

import { isGender, isMemberRole, type MemberRole } from "./games";
import type { StoredTeam } from "./store";
import { normaliseTeamName, TEAM_PREFIX } from "./team-name";
import type { TournamentConfig } from "./tournament";
import type { MemberDraft, RegistrationDraft } from "./validation";

/**
 * Remove the automatic "Team " prefix so the captain is shown the part they
 * actually typed. The wizard adds it back on the way out.
 */
export function stripTeamPrefix(teamName: string): string {
  const trimmed = teamName.trim();
  const match = new RegExp(`^${TEAM_PREFIX}\\s+`, "i").exec(trimmed);
  return match ? trimmed.slice(match[0].length) : trimmed;
}

function requirementsOf(value: unknown): Record<string, string> {
  const answers: Record<string, string> = {};
  if (!Array.isArray(value)) return answers;

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const answer = entry as { id?: unknown; value?: unknown };
    if (typeof answer.id !== "string") continue;
    answers[answer.id] = answer.value === null || answer.value === undefined ? "" : String(answer.value);
  }

  return answers;
}

export function teamToDraft(team: StoredTeam, config: TournamentConfig): RegistrationDraft {
  const members: MemberDraft[] = team.members.map((member) => ({
    fullName: member.fullName,
    gameTag: member.gameTag,
    universityId: member.universityId,
    email: member.email,
    studentId: member.studentId ?? "",
    discord: member.discord,
    phone: member.phone,
    role: isMemberRole(member.role) ? (member.role as MemberRole) : "STARTER",
    // A stored member was verified when the entry was created, so the address is
    // acknowledged; the empty proof is filled in server-side by the edit token.
    verifiedEmail: member.email,
    emailProof: "",
    requirements: requirementsOf(member.requirements),
  }));

  return {
    teamName: stripTeamPrefix(team.teamName),
    gender: isGender(team.gender) ? team.gender : "",
    gameId: team.gameId,
    members: members.length > 0 ? members : [],
    leaderIndex: team.leaderIndex,
    /*
     * The consent box reflects what is actually on record, and nothing more.
     *
     * A team that consented shows the box ticked, and `updateTeam` keeps the
     * *first* timestamp, so re-opening an entry to fix a typo cannot move the date
     * of a decision already made.
     *
     * A team with no consent on record shows it **unticked** and is asked again.
     * This is the case that matters: 13 registrations were taken before consent
     * was collected, so `consentedAt` is NULL for all of them. Hardcoding `true`
     * here — which this used to do — meant a captain opening one of those to fix a
     * typo silently had `consentedAt` stamped on save, recording a decision nobody
     * was asked for. A pre-ticked box is precisely what the review step's own
     * comment says must never happen, and it was happening one layer down.
     *
     * Nothing is asked of an organiser editing through `/admin`: that path builds
     * its input directly and never sets `consentedAt`, so it leaves the stored
     * value untouched.
     */
    consentGiven: team.consentedAt !== null,
    /* Nothing recorded here means "not accepted". The server records *that* consent
       was given, because it has legal weight; the rules acknowledgement is only ever
       a gate, so reopening a registration asks for it again rather than inventing an
       answer nobody gave. */
    rulesAccepted: false,
  };
}

/**
 * Addresses already attached to a team. The edit endpoint treats these as
 * proven, because the captain has just authenticated as the team — otherwise
 * every edit would demand a fresh code from every member.
 */
export function teamVerifiedEmails(team: StoredTeam): Set<string> {
  return new Set(team.members.map((member) => member.email.trim().toLowerCase()));
}

/** The display name, for messages. */
export function displayTeamName(raw: string) {
  return normaliseTeamName(raw);
}

/** The address an edit confirmation should be sent to. */
export function leaderEmail(team: StoredTeam): string | null {
  const leader = team.members[team.leaderIndex] ?? team.members[0];
  return leader?.email ?? null;
}

/** Hide most of an address when echoing it back for confirmation. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}${domain}`;
}
