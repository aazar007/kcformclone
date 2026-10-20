/**
 * Division primitives.
 *
 * The games themselves live in the tournament config (see `tournament.ts`)
 * because organisers add titles and change which division may enter them without
 * a deployment. Only the things the app is structurally built around — the two
 * divisions and how a roster slot maps to a role — live here.
 */

export type Gender = "male" | "female";

export const GENDERS: Gender[] = ["male", "female"];

export const GENDER_LABEL: Record<Gender, string> = {
  male: "Male",
  female: "Female",
};

export function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female";
}

/* ------------------------------------------------------------------ */
/* Roster roles                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every roster slot carries a role. Starters play; substitutes wait; coaches
 * support. The last two only exist when the organisers open them up.
 */
export type MemberRole = "STARTER" | "SUBSTITUTE" | "COACH";

export const MEMBER_ROLES: MemberRole[] = ["STARTER", "SUBSTITUTE", "COACH"];

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  STARTER: "Starter",
  SUBSTITUTE: "Substitute",
  COACH: "Coach",
};

/** Roles that occupy a place in the playing squad. */
export const PLAYING_ROLES: MemberRole[] = ["STARTER", "SUBSTITUTE"];

export function isMemberRole(value: unknown): value is MemberRole {
  return value === "STARTER" || value === "SUBSTITUTE" || value === "COACH";
}

/**
 * The default role for a flat roster: anyone beyond the on-field squad size is a
 * substitute. Used when drafting, before roles are assigned explicitly.
 */
export function roleForPosition(position: number, squadSize: number): MemberRole {
  return position < squadSize ? "STARTER" : "SUBSTITUTE";
}
