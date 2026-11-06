/**
 * The link a roster member clicks to complete their own details.
 *
 * Registration verifies only the team leader directly, with a six-digit code.
 * Everyone else receives this link **before the team is submitted**, because the
 * captain enters only their role, university and address — the name, game tag,
 * student number and contacts are the player's own to supply.
 *
 * A link therefore has two possible homes, and one shape in front of them:
 *
 * - a `DraftMember` row, while the registration is still being completed by the
 *   captain — the normal case, since the emails go out when the roster is finished;
 * - a `Member` row, after submission, for anyone who had not answered yet.
 *
 * Keeping one view over both is what lets a link sent before submission keep
 * working after it: the token is carried into the `Member` row, and this module
 * never has to care which side answered.
 *
 * **The raw token is never stored.** The database holds a SHA-256 hash, so a
 * leaked dump cannot be used to fill in — or confirm — somebody else's profile.
 * The token itself exists only in the email.
 */

import {
  completeMemberProfileByTokenHash,
  findMemberCompletionByTokenHash,
  type MemberProfileInput,
} from "./store";
import {
  completeDraftMemberByTokenHash,
  findDraftMemberByTokenHash,
} from "./draft-store";
import { tokenHash } from "./confirm-token";

export { generateConfirmToken, hashConfirmToken, memberConfirmUrl } from "./confirm-token";

/** What the completion form needs, whichever side of submission it came from. */
export interface CompletionView {
  kind: "draft" | "team";
  teamName: string;
  /** Empty until the registration is submitted; drafts have no reference yet. */
  reference: string;
  gameName: string;
  email: string;
  universityId: string;
  universityName: string;
  role: string;
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
  completedAt: string | null;
  /** True when an organiser has suspended this player or their team. */
  banned: boolean;
}

/**
 * Read the row a link belongs to, without changing anything.
 *
 * The draft is checked first: while a registration is in progress the same
 * address may also exist on an older submitted team (a player who moved squads),
 * and the row the captain is actively waiting on is the draft.
 */
export async function lookupMemberCompletion(token: string): Promise<CompletionView | null> {
  const hash = tokenHash(token);
  if (!hash) return null;

  const draft = await findDraftMemberByTokenHash(hash);
  if (draft) {
    return {
      kind: "draft",
      teamName: draft.teamName,
      reference: "",
      gameName: draft.gameName,
      email: draft.email,
      universityId: draft.universityId,
      universityName: draft.universityName,
      role: draft.role,
      fullName: draft.fullName,
      gameTag: draft.gameTag,
      studentId: draft.studentId,
      discord: draft.discord,
      phone: draft.phone,
      requirements: draft.requirements,
      completedAt: draft.profileCompletedAt ? draft.profileCompletedAt.toISOString() : null,
      banned: false,
    };
  }

  const member = await findMemberCompletionByTokenHash(hash);
  if (!member) return null;

  return {
    kind: "team",
    teamName: member.teamName,
    reference: member.reference,
    gameName: member.gameName,
    email: member.email,
    universityId: member.universityId,
    universityName: member.universityName,
    role: member.role,
    fullName: member.fullName,
    gameTag: member.gameTag,
    studentId: member.studentId,
    discord: member.discord,
    phone: member.phone,
    requirements: member.requirements,
    completedAt: member.profileCompletedAt ? member.profileCompletedAt.toISOString() : null,
    banned: Boolean(member.memberBannedAt || member.teamBannedAt),
  };
}

export type CompletionOutcome =
  | { ok: true; saved: true; teamName: string; email: string }
  | { ok: false; reason: "unknown" | "banned" };

/**
 * Save the details a player submitted from their link.
 *
 * Saving **is** confirming: the link already proves control of the mailbox, so the
 * address and the profile are marked together. Which table is written depends on
 * whether the registration has been submitted yet.
 */
export async function completeMemberProfile(
  token: string,
  profile: MemberProfileInput,
): Promise<CompletionOutcome> {
  const hash = tokenHash(token);
  if (!hash) return { ok: false, reason: "unknown" };

  const draft = await findDraftMemberByTokenHash(hash);
  if (draft) {
    const saved = await completeDraftMemberByTokenHash(hash, profile);
    if (!saved.ok) return { ok: false, reason: "unknown" };
    return { ok: true, saved: true, teamName: saved.teamName, email: saved.email };
  }

  const outcome = await completeMemberProfileByTokenHash(hash, profile);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return { ok: true, saved: true, teamName: outcome.teamName, email: outcome.email };
}
