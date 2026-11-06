/**
 * Who is allowed to open a registration, and what they may see when they do.
 *
 * A reference code is printed in team chats, so it identifies a team but does not
 * prove anything about the person typing it. The email address narrows that to one
 * person; the code mailed to that address proves they own it. Together they decide
 * a **role**, and the role decides what the console — and the API — will show:
 *
 * | Role | May see | May change |
 * | --- | --- | --- |
 * | `LEADER` | every name and position, their own full card | positions, their own details |
 * | `PLAYER` / `SUBSTITUTE` / `COACH` | their own card only | their own details |
 *
 * `ORGANISER` is the exception: somebody signed in to the console already holds a
 * credential that outranks all of this, so they may open a team in full.
 *
 * The proof minted after verification carries that decision — team, role, member —
 * so an endpoint does not have to re-derive it from a reference code somebody could
 * have changed between requests.
 */

import { isMemberRole, type MemberRole } from "./games";

export type AccessRole = "LEADER" | "PLAYER" | "SUBSTITUTE" | "COACH" | "ORGANISER";

/** What a member row's role becomes once leadership has been decided. */
export function accessRoleFor(role: MemberRole, isLeader: boolean): AccessRole {
  if (isLeader) return "LEADER";
  if (role === "COACH") return "COACH";
  if (role === "SUBSTITUTE") return "SUBSTITUTE";
  return "PLAYER";
}

export function isAccessRole(value: unknown): value is AccessRole {
  return (
    value === "LEADER" ||
    value === "PLAYER" ||
    value === "SUBSTITUTE" ||
    value === "COACH" ||
    value === "ORGANISER"
  );
}

/** Only the leader and an organiser may see the whole roster. */
export function maySeeRoster(role: AccessRole): boolean {
  return role === "LEADER" || role === "ORGANISER";
}

/** Everyone on the team may correct their own card; nobody else's. */
export function mayEditOwnProfile(role: AccessRole): boolean {
  return role !== "ORGANISER";
}

/** Only the leader and an organiser may reorder the roster. */
export function mayEditPositions(role: AccessRole): boolean {
  return role === "LEADER" || role === "ORGANISER";
}

/**
 * What a proof is for: the team, the role, and the row it belongs to.
 *
 * Colon-separated and fixed-length in shape, so both minting and checking can be
 * done by the same two helpers rather than by string surgery in each endpoint.
 * `memberId` is `"-"` for an organiser, who belongs to no row.
 */
export function proofScope(teamId: string, role: AccessRole, memberId: string): string {
  return `${teamId}:${role}:${memberId || "-"}`;
}

export interface ParsedScope {
  teamId: string;
  role: AccessRole;
  memberId: string | null;
}

/** Read a proof scope, or null when it is not one of ours. */
export function parseProofScope(scope: string | null): ParsedScope | null {
  if (!scope) return null;
  const parts = scope.split(":");
  if (parts.length !== 3) return null;

  const [teamId, role, memberId] = parts;
  if (!teamId || !isAccessRole(role)) return null;

  return {
    teamId,
    role,
    memberId: memberId === "-" ? null : memberId,
  };
}

/** Narrow a stored `Member.role` string for the type system. */
export function memberRole(value: string): MemberRole {
  return isMemberRole(value) ? value : "STARTER";
}
