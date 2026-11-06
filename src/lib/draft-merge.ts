/**
 * Turning what teammates filled in into a submission.
 *
 * The captain's browser submits the roster it has on screen, but a teammate's
 * details are not the captain's to type — they were supplied from the emailed
 * link, and the browser's copy of them is only a convenience. So the server
 * **overwrites** those fields from the draft rows before validating, and carries
 * the completion token across so a link that was sent before submission still
 * works afterwards.
 *
 * Matching is by address, never by position: the captain may have reordered or
 * removed rows after the links went out, and a profile must never be attached to
 * whoever now sits in that slot.
 */

import type { PayloadMember } from "./validation";

export interface DraftProfile {
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
  /** When the player submitted the form; null means they have not. */
  completedAt: Date | null;
  /** The hash of their still-valid link, so it survives the submission. */
  confirmTokenHash: string | null;
}

/** Fold the draft's completed profiles into the roster the browser sent. */
export function applyDraftProfiles(
  payload: unknown,
  profiles: Map<string, DraftProfile>,
  leaderIndex: number | null,
): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.members)) return payload;

  const members = body.members.map((entry, index) => {
    if (!entry || typeof entry !== "object") return entry;
    /* The leader's row was entered in full by the captain and is never replaced. */
    if (index === leaderIndex) return entry;

    const member = entry as Record<string, unknown>;
    const email = typeof member.email === "string" ? member.email.trim().toLowerCase() : "";
    const profile = profiles.get(email);
    if (!profile) return entry;

    return {
      ...member,
      fullName: profile.fullName,
      gameTag: profile.gameTag,
      studentId: profile.studentId,
      discord: profile.discord,
      phone: profile.phone,
      requirements: profile.requirements.map((answer) => ({
        id: answer.id,
        label: answer.label,
        value: answer.value,
      })),
    };
  });

  return { ...body, members };
}

/**
 * Attach each member's completion receipt to the validated payload.
 *
 * `emailConfirmedAt` and `profileCompletedAt` are set together: for a teammate
 * this form *was* the confirmation, so the two facts have the same cause. Their
 * token hash travels with them, which is what keeps a link sent before submission
 * usable afterwards.
 */
export function withCompletionReceipts(
  members: PayloadMember[],
  profiles: Map<string, DraftProfile>,
  leaderIndex: number,
): PayloadMember[] {
  return members.map((member, index) => {
    if (index === leaderIndex) return member;
    const profile = profiles.get(member.email.trim().toLowerCase());
    if (!profile || !profile.completedAt) return member;

    return {
      ...member,
      confirmTokenHash: profile.confirmTokenHash ?? null,
      profileCompletedAt: profile.completedAt,
    };
  });
}
