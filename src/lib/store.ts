/**
 * The registration database.
 *
 * This is the only module that talks to Prisma. It replaces the Google Sheets
 * store as the source of truth: teams, their roster, the tournament settings,
 * one-time passcodes and game logos all live here.
 *
 * The sheet is still supported, but only as an export built from this data — see
 * `toPlayerRows` in `sheet-export.ts`.
 */

import { Prisma } from "../../generated/prisma-client/client";
import { getPrisma } from "./db";
import type { OtpPurpose } from "./otp";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type StoredMember = Prisma.MemberGetPayload<object>;
export type StoredTeam = Prisma.TeamGetPayload<{ include: { members: true } }>;

export interface MemberInput {
  fullName: string;
  gameTag: string;
  universityId: string;
  universityName: string;
  universityRegion: string;
  email: string;
  studentId: string;
  discord: string;
  phone: string;
  role: string;
  requirements: { id: string; label: string; value: string }[];
  /**
   * When this member completed their own details, before the registration was
   * submitted. Present only for a teammate who answered from their emailed link
   * while the team was still a draft — which is also when their address counts as
   * confirmed.
   */
  profileCompletedAt?: Date | null;
  /**
   * The hash of their completion link, carried over from the draft so a link sent
   * before submission keeps working after it.
   */
  confirmTokenHash?: string | null;
}

export interface TeamInput {
  tournamentName: string;
  teamName: string;
  teamNameKey: string;
  gender: string;
  gameId: string;
  gameName: string;
  leaderIndex: number;
  members: MemberInput[];
  /**
   * When the captain accepted the privacy notice.
   *
   * `undefined` means "this write is not about consent" — the organiser edit path
   * never re-asks, so it must leave whatever the captain recorded alone rather
   * than clearing it. Only a submitted registration speaks to consent, and there
   * validation has already refused any submission without it.
   */
  consentedAt?: Date | null;
}

/**
 * Which unique rule a write broke. The API turns this into a sentence the player
 * can act on, so the distinction matters.
 */
export type UniqueViolation =
  | { field: "teamName"; message: string }
  | { field: "email"; message: string }
  | { field: "studentId"; message: string };

/** Thrown by the write helpers when a unique rule is broken. */
export class DuplicateValueError extends Error {
  constructor(readonly violation: UniqueViolation) {
    super(violation.message);
    this.name = "DuplicateValueError";
  }
}

/** Thrown when a reference code is asked for but does not exist. */
export class TeamNotFoundError extends Error {
  constructor(readonly reference: string) {
    super(`No team is registered under ${reference}.`);
    this.name = "TeamNotFoundError";
  }
}

/* -------------------------------------------------------------------------- */
/* Unique-constraint plumbing                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every string inside Prisma's `meta`, concatenated.
 *
 * Prisma reports a unique violation as `P2002`, but *where* the offending
 * constraint is named varies by driver and version. With the PostgreSQL driver
 * adapter it arrives as:
 *
 *   { modelName: "Team",
 *     driverAdapterError: { cause: {
 *       constraint: { index: "Team_teamNameKey_key" },
 *       originalMessage: 'duplicate key value violates unique constraint "…"' } } }
 *
 * There is no `meta.target`, which is what older Prisma versions used — so rather
 * than look in one expected place, walk the whole tree. That keeps the mapping
 * working whichever shape arrives.
 */
function metaText(value: unknown): string {
  const parts: string[] = [];

  const walk = (node: unknown) => {
    if (typeof node === "string") parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const entry of Object.values(node as Record<string, unknown>)) walk(entry);
    }
  };

  walk(value);
  return parts.join(" ");
}

function uniqueViolation(error: unknown): UniqueViolation | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return null;

  const text = metaText(candidate.meta);

  if (/teamNameKey|Team_teamNameKey_key/i.test(text)) {
    return { field: "teamName", message: "That team name is already taken" };
  }
  if (/studentId|Student_studentId_key/i.test(text)) {
    return { field: "studentId", message: "A member with that student ID is already registered" };
  }
  // `email` also appears inside the composite constraint names, so it is last.
  if (/email|Member_email_key/i.test(text)) {
    return { field: "email", message: "That email address is already registered" };
  }

  return { field: "email", message: "That value is already registered" };
}

function rethrowUnique(error: unknown): never {
  const violation = uniqueViolation(error);
  if (violation) throw new DuplicateValueError(violation);
  throw error;
}

function memberRows(
  input: TeamInput,
  existing?: Map<
    string,
    {
      emailConfirmedAt: Date | null;
      profileCompletedAt: Date | null;
      confirmTokenHash: string | null;
      bannedAt: Date | null;
      banReason: string;
    }
  >,
) {
  return input.members.map((member, index) => {
    /* A member's confirmation survives an edit while their address stays the same.
       The leader is always confirmed: their address is the one the captain proved
       during registration (or the one the edit flow authenticated against). Every
       other member starts pending and keeps that status until they use their link. */
    const prior = existing?.get(member.email.toLowerCase());
    const isLeader = index === input.leaderIndex;

    /* A teammate who filled in their details while the team was a draft has already
       proved the address, so the submission brings that receipt with it. Without
       this the first save would wipe a confirmation the player had just given. */
    const carried = isLeader ? null : (member.profileCompletedAt ?? null);

    const emailConfirmedAt = isLeader
      ? (prior?.emailConfirmedAt ?? new Date())
      : (prior?.emailConfirmedAt ?? carried ?? null);

    /* A teammate's profile is theirs to complete, so it carries across an edit by
       the captain. The leader's row is complete by definition. */
    const profileCompletedAt = isLeader
      ? (prior?.profileCompletedAt ?? new Date())
      : (prior?.profileCompletedAt ?? carried ?? null);

    return {
      position: index,
      fullName: member.fullName,
      gameTag: member.gameTag,
      universityId: member.universityId,
      universityName: member.universityName,
      universityRegion: member.universityRegion,
      email: member.email.toLowerCase(),
      // Coaches need not be students, and NULL keeps the unique index happy.
      studentId: member.studentId.trim() || null,
      discord: member.discord,
      phone: member.phone,
      role: member.role,
      requirements: member.requirements as unknown as Prisma.InputJsonValue,
      emailConfirmedAt,
      profileCompletedAt,
      /* A ban is a decision about a person, not about the row, so it must not be
         lifted by an edit — including one made by the captain. */
      bannedAt: prior?.bannedAt ?? null,
      banReason: prior?.banReason ?? "",
      confirmTokenHash: isLeader
        ? null
        : (prior?.confirmTokenHash ?? member.confirmTokenHash ?? null),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Teams                                                                      */
/* -------------------------------------------------------------------------- */

/** All teams with their rosters, newest first. */
export async function listTeams(): Promise<StoredTeam[]> {
  const prisma = await getPrisma();
  return prisma.team.findMany({
    include: { members: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function findTeamByReference(reference: string): Promise<StoredTeam | null> {
  const prisma = await getPrisma();
  return prisma.team.findUnique({
    where: { reference: reference.trim().toUpperCase() },
    include: { members: { orderBy: { position: "asc" } } },
  });
}

export async function findTeamById(id: string): Promise<StoredTeam | null> {
  const prisma = await getPrisma();
  return prisma.team.findUnique({
    where: { id },
    include: { members: { orderBy: { position: "asc" } } },
  });
}

/** The stored spelling of a taken team name, or `null` when it is free. */
export async function findTeamNameClash(key: string, exceptTeamId?: string): Promise<string | null> {
  const prisma = await getPrisma();
  const clash = await prisma.team.findUnique({
    where: { teamNameKey: key },
    select: { id: true, teamName: true },
  });
  if (!clash || clash.id === exceptTeamId) return null;
  return clash.teamName;
}

/** Insert a team and its roster in one transaction. */
export async function createTeam(reference: string, input: TeamInput): Promise<StoredTeam> {
  try {
    const prisma = await getPrisma();
    return await prisma.team.create({
      data: {
        reference,
        teamName: input.teamName,
        teamNameKey: input.teamNameKey,
        tournamentName: input.tournamentName,
        gender: input.gender,
        gameId: input.gameId,
        gameName: input.gameName,
        leaderIndex: input.leaderIndex,
        consentedAt: input.consentedAt ?? null,
        members: { create: memberRows(input) },
      },
      include: { members: { orderBy: { position: "asc" } } },
    });
  } catch (error) {
    rethrowUnique(error);
  }
}

/**
 * Replace a team's details and roster.
 *
 * The roster is rewritten wholesale rather than diffed: a submitted edit is the
 * complete, validated truth, and deleting then recreating keeps positions
 * contiguous. Both halves run in one transaction so a rejected write leaves the
 * previous roster untouched.
 */
export async function updateTeam(id: string, input: TeamInput): Promise<StoredTeam> {
  try {
    const prisma = await getPrisma();
    return await prisma.$transaction(async (tx) => {
      /* Consent is recorded the first time only. An edit that re-ticks the box
         must not move the date, or the audit trail would show the last edit
         rather than when the captain actually agreed. */
      const existing = await tx.team.findUnique({
        where: { id },
        select: { consentedAt: true },
      });
      const consentedAt = existing?.consentedAt ?? input.consentedAt ?? undefined;

      /* Preserve each member's confirmation while their address is unchanged.
         Rebuilding the roster must not reset a confirmation the player has already
         given, nor throw away a pending member's still-valid link. */
      const currentMembers = await tx.member.findMany({
        where: { teamId: id },
        select: {
          email: true,
          emailConfirmedAt: true,
          profileCompletedAt: true,
          confirmTokenHash: true,
          bannedAt: true,
          banReason: true,
        },
      });
      const confirmations = new Map(
        currentMembers.map((member) => [
          member.email.toLowerCase(),
          {
            emailConfirmedAt: member.emailConfirmedAt,
            profileCompletedAt: member.profileCompletedAt,
            confirmTokenHash: member.confirmTokenHash,
            bannedAt: member.bannedAt,
            banReason: member.banReason,
          },
        ]),
      );

      await tx.team.update({
        where: { id },
        data: {
          teamName: input.teamName,
          teamNameKey: input.teamNameKey,
          tournamentName: input.tournamentName,
          gender: input.gender,
          gameId: input.gameId,
          gameName: input.gameName,
          leaderIndex: input.leaderIndex,
          consentedAt,
        },
      });

      await tx.member.deleteMany({ where: { teamId: id } });
      await tx.member.createMany({
        data: memberRows(input, confirmations).map((row) => ({ ...row, teamId: id })),
      });

      return tx.team.findUniqueOrThrow({
        where: { id },
        include: { members: { orderBy: { position: "asc" } } },
      });
    });
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function referenceExists(reference: string): Promise<boolean> {
  const prisma = await getPrisma();
  const found = await prisma.team.findUnique({
    where: { reference },
    select: { id: true },
  });
  return found !== null;
}

/* -------------------------------------------------------------------------- */
/* Email confirmation                                                         */
/* -------------------------------------------------------------------------- */

/** Store the hash of a freshly minted confirmation link, invalidating any older one. */
export async function setMemberConfirmToken(memberId: string, hash: string | null): Promise<void> {
  const prisma = await getPrisma();
  await prisma.member.update({
    where: { id: memberId },
    data: { confirmTokenHash: hash },
  });
}

export interface ConfirmedMember {
  memberName: string;
  /** The address this link belongs to — exactly one member's. */
  email: string;
  teamName: string;
  reference: string;
  /** True when this link had already been used before. */
  alreadyConfirmed: boolean;
}

/**
 * Mark one member's address confirmed from their emailed link.
 *
 * **Exactly one member.** The token identifies a single row, and the update is
 * scoped to that row's id *and* that same token, so a confirmation can never
 * spread to the rest of the roster. That had happened on screen: reopening an
 * entry marked every member as verified, which made one player's confirmation look
 * as though it had confirmed everybody.
 *
 * Idempotent on purpose: mail clients and link scanners sometimes open a URL
 * twice, and the second visit must still show success rather than "invalid link".
 * The conditional update (`emailConfirmedAt: null`) makes the first use win, so a
 * forwarded link cannot move a confirmation date that already exists.
 *
 * Returns null when the token is unknown.
 */
export async function confirmMemberByTokenHash(hash: string): Promise<ConfirmedMember | null> {
  const prisma = await getPrisma();
  const member = await prisma.member.findUnique({
    where: { confirmTokenHash: hash },
    select: {
      id: true,
      fullName: true,
      email: true,
      emailConfirmedAt: true,
      team: { select: { teamName: true, reference: true } },
    },
  });
  if (!member) return null;

  const alreadyConfirmed = member.emailConfirmedAt !== null;
  if (!alreadyConfirmed) {
    /* `updateMany`, not `update`: the row is named by its id *and* its token, and
       only while still pending. There is no filter here that could ever match a
       sibling member, and a second concurrent click writes nothing. */
    const confirmed = await prisma.member.updateMany({
      where: {
        id: member.id,
        confirmTokenHash: hash,
        emailConfirmedAt: null,
      },
      data: { emailConfirmedAt: new Date() },
    });

    /* A simultaneous click on the same link got there first: the address is
       confirmed either way, so this is still a success rather than an error. */
    if (confirmed.count === 0) {
      return {
        memberName: member.fullName,
        email: member.email,
        teamName: member.team.teamName,
        reference: member.team.reference,
        alreadyConfirmed: true,
      };
    }
  }

  return {
    memberName: member.fullName,
    email: member.email,
    teamName: member.team.teamName,
    reference: member.team.reference,
    alreadyConfirmed,
  };
}

/**
 * Which member a confirmation link belongs to — without changing anything.
 *
 * Used by the landing page to say *whose* address the link is about before the
 * button is pressed. Read-only on purpose: opening a link must never confirm an
 * address by itself, or a university mail filter that follows every URL would
 * confirm players who never clicked.
 */
export async function findMemberByConfirmTokenHash(hash: string): Promise<ConfirmedMember | null> {
  const prisma = await getPrisma();
  const member = await prisma.member.findUnique({
    where: { confirmTokenHash: hash },
    select: {
      fullName: true,
      email: true,
      emailConfirmedAt: true,
      team: { select: { teamName: true, reference: true } },
    },
  });
  if (!member) return null;

  return {
    memberName: member.fullName,
    email: member.email,
    teamName: member.team.teamName,
    reference: member.team.reference,
    alreadyConfirmed: member.emailConfirmedAt !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* Member profile completion                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everything a member needs to complete their own details, resolved from their
 * emailed link.
 *
 * The leader only enters a teammate's university and address, so the rest is
 * gathered here. The row is named by the token hash and nothing else — a link can
 * never address a sibling, and it carries no team id the browser could swap.
 */
export interface CompletionTarget {
  memberId: string;
  teamId: string;
  role: string;
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
  email: string;
  universityId: string;
  universityName: string;
  profileCompletedAt: Date | null;
  emailConfirmedAt: Date | null;
  memberBannedAt: Date | null;
  teamBannedAt: Date | null;
  teamName: string;
  reference: string;
  tournamentName: string;
  gameName: string;
  gender: string;
  leaderIndex: number;
}

export interface MemberProfileInput {
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
}

export type CompletionOutcome =
  | { ok: true; email: string; teamName: string; reference: string }
  | { ok: false; reason: "unknown" | "banned" };

function completionSelect() {
  return {
    id: true,
    teamId: true,
    position: true,
    role: true,
    fullName: true,
    gameTag: true,
    studentId: true,
    discord: true,
    phone: true,
    requirements: true,
    email: true,
    universityId: true,
    universityName: true,
    profileCompletedAt: true,
    emailConfirmedAt: true,
    bannedAt: true,
    team: {
      select: {
        teamName: true,
        reference: true,
        tournamentName: true,
        gameName: true,
        gender: true,
        leaderIndex: true,
        bannedAt: true,
      },
    },
  } as const;
}

/** Read the member a details link belongs to. Changes nothing. */
export async function findMemberCompletionByTokenHash(
  hash: string,
): Promise<CompletionTarget | null> {
  const prisma = await getPrisma();
  const row = await prisma.member.findUnique({
    where: { confirmTokenHash: hash },
    select: completionSelect(),
  });
  if (!row) return null;

  const answers = Array.isArray(row.requirements)
    ? (row.requirements as unknown as { id?: unknown; label?: unknown; value?: unknown }[])
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          id: String(entry.id ?? ""),
          label: String(entry.label ?? ""),
          value: String(entry.value ?? ""),
        }))
    : [];

  return {
    memberId: row.id,
    teamId: row.teamId,
    role: row.role,
    fullName: row.fullName,
    gameTag: row.gameTag,
    studentId: row.studentId ?? "",
    discord: row.discord,
    phone: row.phone,
    requirements: answers,
    email: row.email,
    universityId: row.universityId,
    universityName: row.universityName,
    profileCompletedAt: row.profileCompletedAt,
    emailConfirmedAt: row.emailConfirmedAt,
    memberBannedAt: row.bannedAt,
    teamBannedAt: row.team.bannedAt,
    teamName: row.team.teamName,
    reference: row.team.reference,
    tournamentName: row.team.tournamentName,
    gameName: row.team.gameName,
    gender: row.team.gender,
    leaderIndex: row.team.leaderIndex,
  };
}

/**
 * Save a member's own details and mark their address confirmed.
 *
 * The link proves control of the mailbox, so pressing Save is the confirmation —
 * there is no second button. The update is scoped to the row id *and* the token,
 * and refuses while the member or their team is banned.
 *
 * Idempotent: pressing Save again updates the same row and keeps working, which is
 * what lets a player correct a typo they only noticed after submitting.
 */
export async function completeMemberProfileByTokenHash(
  hash: string,
  input: MemberProfileInput,
): Promise<CompletionOutcome> {
  const prisma = await getPrisma();
  const row = await prisma.member.findUnique({
    where: { confirmTokenHash: hash },
    select: {
      id: true,
      email: true,
      bannedAt: true,
      team: { select: { teamName: true, reference: true, bannedAt: true } },
    },
  });
  if (!row) return { ok: false, reason: "unknown" };
  if (row.bannedAt || row.team.bannedAt) return { ok: false, reason: "banned" };

  await prisma.member.updateMany({
    where: { id: row.id, confirmTokenHash: hash, bannedAt: null },
    data: {
      fullName: input.fullName,
      gameTag: input.gameTag,
      studentId: input.studentId.trim() || null,
      discord: input.discord,
      phone: input.phone,
      requirements: input.requirements as unknown as Prisma.InputJsonValue,
      emailConfirmedAt: new Date(),
      profileCompletedAt: new Date(),
    },
  });

  return {
    ok: true,
    email: row.email,
    teamName: row.team.teamName,
    reference: row.team.reference,
  };
}

/* -------------------------------------------------------------------------- */
/* Bans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ban or reinstate a whole team.
 *
 * Kept as a timestamp plus a reason rather than a boolean so the console can say
 * when and why — the question an organiser asks six weeks later. `null` lifts it.
 */
export async function setTeamBan(
  teamId: string,
  banned: boolean,
  reason = "",
): Promise<boolean> {
  const prisma = await getPrisma();
  const stamp = banned ? new Date() : null;
  const note = banned ? reason.trim() : "";

  /* The team's current stamp, so an unban can lift exactly the bans this cascade
     wrote. Everybody the cascade touched carries the same instant; a player banned
     on their own carries a different one, and must keep it. */
  const current = await prisma.team.findUnique({
    where: { id: teamId },
    select: { bannedAt: true },
  });
  if (!current) return false;

  /* **A ban on the team is a ban on everybody on it.** Writing it to the members too
     is what makes the rule travel: a player removed from the roster later, or one who
     tries to enter under a different team, is refused without anybody having to
     remember that the *team* was the thing that was banned. The team's own flag stays
     because it is what the console reads and what closes the shared links. */
  const [team] = await prisma.$transaction([
    prisma.team.updateMany({
      where: { id: teamId },
      data: { bannedAt: stamp, banReason: note },
    }),
    banned
      ? prisma.member.updateMany({ where: { teamId }, data: { bannedAt: stamp, banReason: note } })
      : prisma.member.updateMany({
          /* Only the rows the team ban itself stamped. An individual suspension
             survives the team being reinstated, which is what makes the two
             separate decisions rather than one. */
          where: { teamId, bannedAt: current.bannedAt ?? stamp },
          data: { bannedAt: null, banReason: "" },
        }),
  ]);

  return team.count > 0;
}

/**
 * Save a member's own details, from the role-scoped edit flow.
 *
 * Only the fields the member owns are written: name, game tag, student number,
 * contacts and the organisers' answers. University, address and role come from the
 * caption's own choices and are **never** taken from the request — a member cannot
 * move themselves to another institution, or become a coach to avoid a student
 * number, by editing their card.
 *
 * `profileCompletedAt` is only set on the first completion, so a later correction
 * does not look like a new profile.
 */
export async function updateMemberOwnProfile(
  teamId: string,
  memberId: string,
  input: MemberProfileInput,
): Promise<boolean> {
  const prisma = await getPrisma();
  const existing = await prisma.member.findFirst({
    where: { id: memberId, teamId },
    select: { profileCompletedAt: true, bannedAt: true, team: { select: { bannedAt: true } } },
  });
  if (!existing) return false;
  if (existing.bannedAt || existing.team.bannedAt) return false;

  const result = await prisma.member.updateMany({
    where: { id: memberId, teamId, bannedAt: null },
    data: {
      fullName: input.fullName,
      gameTag: input.gameTag,
      studentId: input.studentId.trim() || null,
      discord: input.discord,
      phone: input.phone,
      requirements: input.requirements as unknown as Prisma.InputJsonValue,
      emailConfirmedAt: new Date(),
      profileCompletedAt: existing.profileCompletedAt ?? new Date(),
    },
  });
  return result.count > 0;
}

/**
 * Rewrite the roster's order, as positions 0..n-1 in the order given.
 *
 * Only the leader may do this, and only the *order* is theirs: the personal details
 * behind each row stay with the row. Two passes through the table because
 * `@@unique([teamId, position])` would otherwise trip over an intermediate state —
 * swapping rows 1 and 2 briefly has two people in the same slot.
 */
export async function reorderTeamMembers(
  teamId: string,
  memberIds: string[],
): Promise<boolean> {
  const prisma = await getPrisma();
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { leaderIndex: true, members: { select: { id: true, position: true } } },
  });
  if (!team) return false;
  if (team.members.length !== memberIds.length) return false;

  const known = new Set(team.members.map((member) => member.id));
  const submitted = new Set(memberIds);
  if (submitted.size !== memberIds.length) return false;
  for (const id of memberIds) if (!known.has(id)) return false;

  /*
   * The leader's **row** leads, not position 0.
   *
   * Positions are what the roster is ordered by, and `leaderIndex` is an index into
   * that order — so moving the leader to the bench must move `leaderIndex` with
   * them, or the team would silently acquire a different leader. The row that led
   * before this call is the row that leads after it.
   */
  const leaderRow = team.members.find((member) => member.position === team.leaderIndex);
  const nextLeaderIndex = leaderRow ? memberIds.indexOf(leaderRow.id) : team.leaderIndex;

  await prisma.$transaction(async (tx) => {
    /* Park every row on a negative position first, which no real position can be. */
    await tx.member.updateMany({
      where: { teamId },
      data: { position: { decrement: 1000 } },
    });
    for (let index = 0; index < memberIds.length; index += 1) {
      await tx.member.update({
        where: { id: memberIds[index] },
        data: { position: index },
      });
    }
    await tx.team.update({
      where: { id: teamId },
      data: { leaderIndex: nextLeaderIndex === -1 ? team.leaderIndex : nextLeaderIndex },
    });
  });

  return true;
}

/** Ban or reinstate one member. */
export async function setMemberBan(
  memberId: string,
  banned: boolean,
  reason = "",
): Promise<boolean> {
  const prisma = await getPrisma();
  const result = await prisma.member.updateMany({
    where: { id: memberId },
    data: { bannedAt: banned ? new Date() : null, banReason: banned ? reason.trim() : "" },
  });
  return result.count > 0;
}

/**
 * Remove a team and its roster.
 *
 * The members go with it through `onDelete: Cascade` on the relation, so this is
 * one statement rather than a transaction the caller has to remember to write.
 * Returns the reference that was removed, or `null` when there was nothing to
 * delete — which lets the API answer 404 rather than pretending it worked.
 */
export async function deleteTeam(id: string): Promise<string | null> {
  const prisma = await getPrisma();
  const team = await prisma.team.findUnique({
    where: { id },
    select: { reference: true },
  });
  if (!team) return null;

  await prisma.team.delete({ where: { id } });
  return team.reference;
}

/** Total teams and players, for the admin header. */
export async function registrationCounts() {
  const prisma = await getPrisma();
  const [teams, players] = await Promise.all([
    prisma.team.count(),
    prisma.member.count(),
  ]);
  return { teams, players };
}

/** A submitted person who is already on another team. */
export interface MemberClash {
  /** The address the player submitted. */
  email: string;
  /** The team they are already registered with. */
  teamName: string;
  /** Which of the two unique rules caught them. */
  field: "email" | "studentId";
  /** The student ID they are already registered under, when that is the clash. */
  studentId: string;
  /** The team that already holds this person, so an edit can ignore its own rows. */
  teamId: string;
  /**
   * True when an organiser has banned this person or the team they are on.
   *
   * A ban must outlive the registration being deleted and rebuilt, so the clash
   * list is also what refuses a banned player's address on a fresh entry — a
   * second registration is exactly what a ban is meant to prevent.
   */
  banned: boolean;
}

/**
 * Which submitted members already belong to a team.
 *
 * Checked before the write so the player gets a sentence naming the problem,
 * rather than a bare unique-constraint failure. The constraint is still the
 * authority — this is the friendly path, not the guarantee.
 *
 * `exceptTeamId` lets a registration being edited ignore its own existing rows.
 */
export async function findMemberClashes(
  members: { email: string; studentId: string }[],
  exceptTeamId?: string,
): Promise<MemberClash[]> {
  const prisma = await getPrisma();
  const emails = members.map((member) => member.email.toLowerCase()).filter(Boolean);
  const studentIds = members.map((member) => member.studentId.trim()).filter(Boolean);
  if (emails.length === 0 && studentIds.length === 0) return [];

  const found = await prisma.member.findMany({
    where: {
      OR: [
        emails.length > 0 ? { email: { in: emails } } : undefined,
        studentIds.length > 0 ? { studentId: { in: studentIds } } : undefined,
      ].filter((clause) => clause !== undefined) as Prisma.MemberWhereInput[],
    },
    select: {
      email: true,
      studentId: true,
      teamId: true,
      bannedAt: true,
      team: { select: { teamName: true, bannedAt: true } },
    },
  });

  const byEmail = new Map(found.map((row) => [row.email.toLowerCase(), row]));
  const byStudentId = new Map(
    found.flatMap((row) => (row.studentId ? [[row.studentId.toLowerCase(), row] as const] : [])),
  );

  const clashes: MemberClash[] = [];

  for (const member of members) {
    const emailMatch = byEmail.get(member.email.toLowerCase());
    if (emailMatch && emailMatch.teamId !== exceptTeamId) {
      clashes.push({
        email: member.email,
        teamName: emailMatch.team.teamName,
        field: "email",
        studentId: emailMatch.studentId ?? "",
        teamId: emailMatch.teamId,
        banned: Boolean(emailMatch.bannedAt ?? emailMatch.team.bannedAt),
      });
      continue;
    }

    const idMatch = byStudentId.get(member.studentId.trim().toLowerCase());
    if (idMatch && idMatch.teamId !== exceptTeamId) {
      clashes.push({
        email: member.email,
        teamName: idMatch.team.teamName,
        field: "studentId",
        studentId: idMatch.studentId ?? "",
        teamId: idMatch.teamId,
        banned: Boolean(idMatch.bannedAt ?? idMatch.team.bannedAt),
      });
    }
  }

  return clashes;
}

/* -------------------------------------------------------------------------- */
/* Tournament config                                                          */
/* -------------------------------------------------------------------------- */

/** The stored config, or `null` when the organisers have never saved one. */
export async function readStoredConfig(): Promise<unknown | null> {
  const prisma = await getPrisma();
  const row = await prisma.config.findUnique({ where: { id: 1 } });
  return row?.data ?? null;
}

export async function writeStoredConfig(data: unknown): Promise<void> {
  const prisma = await getPrisma();
  const value = data as Prisma.InputJsonValue;
  await prisma.config.upsert({
    where: { id: 1 },
    create: { id: 1, data: value },
    update: { data: value },
  });
}

/* -------------------------------------------------------------------------- */
/* One-time passcodes                                                         */
/* -------------------------------------------------------------------------- */

/** How many codes an address has asked for recently — the rate limit. */
export async function countRecentOtps(email: string, purpose: OtpPurpose, since: Date) {
  const prisma = await getPrisma();
  return prisma.otpCode.count({
    where: { email: email.toLowerCase(), purpose, createdAt: { gte: since } },
  });
}

/**
 * How many codes of one purpose were minted site-wide since `since`.
 *
 * The per-address cap cannot bound this: an attacker who changes the address every time
 * gets a fresh allowance every time, which is how an unlimited number of rows — and an
 * unlimited number of emails — is achievable with one script. Edit-lookup made it worse,
 * because an unknown reference mints a row against a *newly derived* address each time, so
 * rotating references alone grew the table.
 *
 * This is the backstop that puts a ceiling on the whole endpoint rather than on one identity.
 * Deliberately generous, because it is a brake on abuse rather than a quota for real use: a
 * tournament with a few hundred teams asking for codes legitimately stays far below it.
 */
export async function countAllRecentOtps(purpose: OtpPurpose, since: Date) {
  const prisma = await getPrisma();
  return prisma.otpCode.count({
    where: { purpose, createdAt: { gte: since } },
  });
}

export async function createOtp(input: {
  email: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
}) {
  const prisma = await getPrisma();

  // Asking for a new code invalidates the previous one, so two codes can never
  // both be live for the same address and purpose.
  await prisma.otpCode.updateMany({
    where: {
      email: input.email.toLowerCase(),
      purpose: input.purpose,
      consumedAt: null,
    },
    data: { consumedAt: new Date() },
  });

  return prisma.otpCode.create({
    data: {
      email: input.email.toLowerCase(),
      purpose: input.purpose,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
    },
  });
}

/** The live code for an address, if one exists. */
export async function findActiveOtp(email: string, purpose: OtpPurpose) {
  const prisma = await getPrisma();
  return prisma.otpCode.findFirst({
    where: {
      email: email.toLowerCase(),
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function consumeOtp(id: string) {
  const prisma = await getPrisma();
  await prisma.otpCode.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
}

/**
 * Erase a code that was never delivered.
 *
 * `countRecentOtps` counts *rows*, so a code that the relay refused would still
 * spend one of the address's five requests per window. Five failed sends then
 * locked the address out with "we have already sent several codes" — which is
 * false, and blames the person for something the sending account caused.
 *
 * Deleting rather than marking as consumed is deliberate: the row means "we
 * issued this person a code", and if the message never left the server then no
 * code was issued. A consumed row would still be counted.
 */
export async function discardOtp(id: string) {
  const prisma = await getPrisma();
  await prisma.otpCode.deleteMany({ where: { id } });
}

/**
 * Spend one guess against a code, atomically.
 *
 * The count is raised in the same statement that checks it, so simultaneous guesses
 * cannot all read "0 attempts so far" and slip past the limit together. Returns
 * false when the code is spent, consumed, or out of guesses.
 */
export async function claimOtpAttempt(id: string, maxAttempts: number): Promise<boolean> {
  const prisma = await getPrisma();
  const result = await prisma.otpCode.updateMany({
    where: { id, consumedAt: null, attempts: { lt: maxAttempts }, expiresAt: { gt: new Date() } },
    data: { attempts: { increment: 1 } },
  });
  return result.count === 1;
}

/** Mark a code used, once. False if another request already used it. */
export async function consumeOtpOnce(id: string): Promise<boolean> {
  const prisma = await getPrisma();
  const result = await prisma.otpCode.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return result.count === 1;
}

export async function registerOtpAttempt(id: string) {
  const prisma = await getPrisma();
  const updated = await prisma.otpCode.update({
    where: { id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });
  return updated.attempts;
}

/** Drop spent and ancient codes. Called opportunistically, never on the hot path. */
export async function pruneOtps() {
  const prisma = await getPrisma();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.otpCode.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
  });
}

/* -------------------------------------------------------------------------- */
/* Game logos                                                                 */
/* -------------------------------------------------------------------------- */

export async function upsertGameLogo(input: {
  gameId: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: Buffer;
}) {
  const prisma = await getPrisma();
  const data = {
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    size: input.bytes.byteLength,
    bytes: new Uint8Array(input.bytes),
  };

  return prisma.gameLogo.upsert({
    where: { gameId: input.gameId },
    create: { gameId: input.gameId, ...data },
    update: data,
  });
}

export async function getGameLogo(gameId: string) {
  const prisma = await getPrisma();
  return prisma.gameLogo.findUnique({ where: { gameId } });
}

export async function deleteGameLogo(gameId: string) {
  const prisma = await getPrisma();
  await prisma.gameLogo.deleteMany({ where: { gameId } });
}

/**
 * Which games have a logo, and when each last changed.
 *
 * The value is a cache-busting version, not decoration. `/api/games/[id]/logo`
 * is served with a one-year immutable cache — right, because the bytes never
 * change under a given URL — so a replaced logo would otherwise never appear for
 * anyone who had already loaded it. Every consumer puts this number in the URL,
 * which makes a new logo a new URL.
 */
export async function listGameLogoVersions(): Promise<Record<string, number>> {
  const prisma = await getPrisma();
  const rows = await prisma.gameLogo.findMany({
    select: { gameId: true, updatedAt: true },
  });

  return Object.fromEntries(rows.map((row) => [row.gameId, row.updatedAt.getTime()]));
}

/* -------------------------------------------------------------------------- */
/* Sponsor logos                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Identical in shape to the game-logo pair above — same table layout, same version
 * scheme, same reason for storing bytes in the database rather than on disk.
 *
 * The one difference is that a sponsor has no table of its own: sponsors are rows
 * inside `Config.sponsors`, so `sponsorId` is a slug with no foreign key behind it.
 * That is what `pruneSponsorLogos` is for.
 */

export async function upsertSponsorLogo(input: {
  sponsorId: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: Buffer;
}) {
  const prisma = await getPrisma();
  const data = {
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    size: input.bytes.byteLength,
    bytes: new Uint8Array(input.bytes),
  };

  return prisma.sponsorLogo.upsert({
    where: { sponsorId: input.sponsorId },
    create: { sponsorId: input.sponsorId, ...data },
    update: data,
  });
}

export async function getSponsorLogo(sponsorId: string) {
  const prisma = await getPrisma();
  return prisma.sponsorLogo.findUnique({ where: { sponsorId } });
}

export async function deleteSponsorLogo(sponsorId: string) {
  const prisma = await getPrisma();
  await prisma.sponsorLogo.deleteMany({ where: { sponsorId } });
}

/** Which sponsors have a logo, and the cache-busting version of each. */
export async function listSponsorLogoVersions(): Promise<Record<string, number>> {
  const prisma = await getPrisma();
  const rows = await prisma.sponsorLogo.findMany({
    select: { sponsorId: true, updatedAt: true },
  });

  return Object.fromEntries(rows.map((row) => [row.sponsorId, row.updatedAt.getTime()]));
}

/**
 * The key a "where to watch" channel's or footer social account's logo is stored under.
 *
 * Both live in the sponsor logo table rather than a table of their own: the shape is
 * identical, and a second table would mean a migration and a regenerated client for no
 * behavioural gain. The `channel:` and `social:` prefixes keep the namespaces apart — a
 * sponsor id is a slug and can never contain a colon — and are what let
 * `pruneSponsorLogos` be told about every list at once.
 *
 * Returns null for an id that is not a plausible slug, so a hand-built URL cannot reach
 * the table with anything else.
 */
export { channelLogoKey, socialLogoKey } from "./logo-keys";

/**
 * Drop logo bytes with no sponsor (or channel) behind them.
 *
 * A sponsor deleted from the config — or renamed, which re-slugs its id — leaves its
 * rows here, because a JSON column cannot carry a foreign key. Nothing will ever request
 * those URLs again, so left alone they are pure storage. Called with the ids that *do*
 * still exist, whenever the console saves. Channel logos are in the same table, so the
 * ids passed must include their `channelLogoKey`s too — or this deletes them.
 */
export async function pruneSponsorLogos(liveIds: string[]): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.sponsorLogo.deleteMany({
    where: { sponsorId: { notIn: liveIds } },
  });
  return result.count;
}

/* -------------------------------------------------------------------------- */
/* Admin login failures                                                        */
/* -------------------------------------------------------------------------- */

/*
 * A durable, cross-instance record of wrong admin codes, so the lockout holds on
 * serverless where every instance has its own memory. Rows live in the existing
 * `OtpCode` table under their own purpose ("admin-fail", email = the caller key),
 * so no migration is needed; `pruneOtps` sweeps them once they expire.
 */
const ADMIN_FAIL_PURPOSE = "admin-fail";

/** When this caller's recent wrong guesses happened, oldest first. */
export async function recentAdminFailures(key: string, since: Date): Promise<Date[]> {
  const prisma = await getPrisma();
  const rows = await prisma.otpCode.findMany({
    where: { email: key, purpose: ADMIN_FAIL_PURPOSE, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.createdAt);
}

/** Wrong admin codes from every address combined, since `since`. */
export async function countAllAdminFailures(since: Date): Promise<number> {
  const prisma = await getPrisma();
  return prisma.otpCode.count({
    where: { purpose: ADMIN_FAIL_PURPOSE, createdAt: { gte: since } },
  });
}

export async function addAdminFailure(key: string, ttlMs: number) {
  const prisma = await getPrisma();
  await prisma.otpCode.create({
    data: {
      email: key,
      purpose: ADMIN_FAIL_PURPOSE,
      codeHash: "-",
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
}

export async function clearAdminFailures(key: string) {
  const prisma = await getPrisma();
  await prisma.otpCode.deleteMany({ where: { email: key, purpose: ADMIN_FAIL_PURPOSE } });
}

/* -------------------------------------------------------------------------- */
/* Staff access                                                                */
/* -------------------------------------------------------------------------- */

export interface StaffAccessRecord {
  id: string;
  email: string;
  note: string;
  addedAt: Date;
  lastLoginAt: Date | null;
  revokedAt: Date | null;
}

/** Every grant ever made, live ones first, so the console shows the current list
 *  and the revoked history below it. */
export async function listStaffAccess(): Promise<StaffAccessRecord[]> {
  const prisma = await getPrisma();
  return prisma.staffAccess.findMany({
    orderBy: [{ revokedAt: "asc" }, { addedAt: "desc" }],
  });
}

/**
 * The live grant for an address, if there is one.
 *
 * This is the check that decides whether an emailed code is sent at all, so a
 * revoked grant returns null rather than a row the caller has to remember to
 * inspect. Addresses are compared lower-cased, because that is how they are
 * stored — an address that differs only in case is the same person.
 */
export async function findLiveStaffAccess(email: string): Promise<StaffAccessRecord | null> {
  const prisma = await getPrisma();
  const row = await prisma.staffAccess.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  return row && !row.revokedAt ? row : null;
}

/**
 * Grant access, or bring a previously revoked grant back.
 *
 * `upsert` on the email rather than an insert, because the row is the person's
 * history: revoking sets `revokedAt`, and re-granting clears it so the record
 * keeps one `addedAt` per person instead of accumulating rows. Clearing
 * `lastLoginAt` as well, so a re-granted address does not display the previous
 * holder's last visit as if it were recent.
 */
export async function grantStaffAccess(email: string, note: string): Promise<StaffAccessRecord> {
  const prisma = await getPrisma();
  const normalised = email.trim().toLowerCase();
  return prisma.staffAccess.upsert({
    where: { email: normalised },
    create: { email: normalised, note },
    update: { note, revokedAt: null, lastLoginAt: null },
  });
}

/** Withdraw access without forgetting it was once given. Returns false when there
 *  was nothing live to withdraw, so the caller can report that honestly. */
export async function revokeStaffAccess(email: string): Promise<boolean> {
  const prisma = await getPrisma();
  const result = await prisma.staffAccess.updateMany({
    where: { email: email.trim().toLowerCase(), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** Forget the address entirely — for a typo, not for a person who left. */
export async function deleteStaffAccess(email: string): Promise<boolean> {
  const prisma = await getPrisma();
  const result = await prisma.staffAccess.deleteMany({
    where: { email: email.trim().toLowerCase() },
  });
  return result.count > 0;
}

/** Record a completed sign-in. Best-effort: never fails a login. */
export async function markStaffLogin(email: string): Promise<void> {
  const prisma = await getPrisma();
  await prisma.staffAccess.updateMany({
    where: { email: email.trim().toLowerCase() },
    data: { lastLoginAt: new Date() },
  });
}

/* -------------------------------------------------------------------------- */
/* The grand admin's password                                                 */
/* -------------------------------------------------------------------------- */

/** The one row's id. Fixed, so a second row cannot exist and two passwords cannot race. */
const ADMIN_CREDENTIAL_ID = "owner";

export interface AdminCredentialRecord {
  passwordHash: string;
  updatedAt: Date;
  updatedVia: string;
}

/**
 * The stored password hash, or null when the password has never been set.
 *
 * Null is a normal state, not an error: the console is reachable with `ADMIN_SECRET`
 * alone, and that is how the first password gets set.
 */
/**
 * The stored password row, with failures **surfaced** rather than hidden.
 *
 * `getAdminCredential` below answers null for "no row" *and* for "could not read",
 * because the console is how such a problem gets fixed and it must not fall over. The
 * sign-in check cannot use it: with no stored password the deployment secret is accepted
 * as a bootstrap credential, so a database outage that read as "no row" would silently
 * promote `ADMIN_SECRET` back to a full credential — the exact behaviour that was
 * removed. This version lets the caller tell the two apart and fail closed.
 */
export async function readAdminCredential(): Promise<AdminCredentialRecord | null> {
  const prisma = await getPrisma();
  const row = await prisma.adminCredential.findUnique({
    where: { id: ADMIN_CREDENTIAL_ID },
    select: { passwordHash: true, updatedAt: true, updatedVia: true },
  });
  return row ?? null;
}

export async function getAdminCredential(): Promise<AdminCredentialRecord | null> {
  try {
    const prisma = await getPrisma();
    const row = await prisma.adminCredential.findUnique({
      where: { id: ADMIN_CREDENTIAL_ID },
      select: { passwordHash: true, updatedAt: true, updatedVia: true },
    });
    return row ?? null;
  } catch (error) {
    /* A missing table must not take the console down: the environment secret still works,
       and the console is how the problem would be fixed. Logged rather than swallowed. */
    console.error("[store] could not read AdminCredential", error);
    return null;
  }
}

/**
 * Store a new password hash.
 *
 * `upsert` rather than create-or-update: two organisers saving at once should end with one
 * row and the last write winning, not a unique-constraint error in one of their faces.
 */
export async function setAdminCredential(passwordHash: string, via = "console"): Promise<void> {
  const prisma = await getPrisma();
  await prisma.adminCredential.upsert({
    where: { id: ADMIN_CREDENTIAL_ID },
    create: { id: ADMIN_CREDENTIAL_ID, passwordHash, updatedVia: via },
    update: { passwordHash, updatedVia: via },
  });
}

/**
 * Forget the stored password, leaving `ADMIN_SECRET` as the only way in.
 *
 * A real operation rather than an afterthought: it is how someone backs out of a password
 * they no longer want, and it is the only route back if the pepper has been rotated out
 * from under the stored hash.
 */
export async function clearAdminCredential(): Promise<void> {
  const prisma = await getPrisma();
  await prisma.adminCredential.deleteMany({ where: { id: ADMIN_CREDENTIAL_ID } });
}

/** Whether a password has been set. Cheaper than fetching the hash when only the fact matters. */
export async function hasAdminCredential(): Promise<boolean> {
  try {
    const prisma = await getPrisma();
    const count = await prisma.adminCredential.count({ where: { id: ADMIN_CREDENTIAL_ID } });
    return count > 0;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Rulebook                                                                    */
/* -------------------------------------------------------------------------- */

export interface RulebookMeta {
  title: string;
  size: number;
  updatedAt: Date;
}

/** What the client is told about a game's rulebook: enough to build a URL and show
 *  the state, and never the document itself. */
export interface RulebookVersion {
  title: string;
  size: number;
  version: number;
}

export type RulebookVersions = Record<string, RulebookVersion>;

export async function upsertRulebook(input: {
  gameId: string;
  mimeType: string;
  bytes: Buffer;
  title: string;
}) {
  const prisma = await getPrisma();
  const data = {
    mimeType: input.mimeType,
    size: input.bytes.byteLength,
    bytes: new Uint8Array(input.bytes),
    title: input.title,
  };

  return prisma.rulebook.upsert({
    where: { gameId: input.gameId },
    create: { gameId: input.gameId, ...data },
    update: data,
  });
}

/** The document itself, bytes included — only the serving route needs this. */
export async function getRulebook(gameId: string) {
  const prisma = await getPrisma();
  return prisma.rulebook.findUnique({ where: { gameId } });
}

/**
 * Just the facts for one game, without the bytes.
 *
 * The public page and the console both need to know whether a rulebook exists and
 * when it changed, and neither should pull a multi-megabyte document out of the
 * database to find out. `updatedAt` doubles as the cache-busting version in the
 * viewer's URL.
 */
export async function getRulebookMeta(gameId: string): Promise<RulebookMeta | null> {
  const prisma = await getPrisma();
  const row = await prisma.rulebook.findUnique({
    where: { gameId },
    select: { title: true, size: true, updatedAt: true },
  });
  return row;
}

/**
 * Which games have a rulebook, and when each last changed.
 *
 * The public page needs this to know which games it can offer and to build a
 * cache-busting URL per game, and the console needs it to show the state of every
 * game at once. One query, metadata only — never the documents themselves.
 */
export async function listRulebookVersions(): Promise<RulebookVersions> {
  const prisma = await getPrisma();
  const rows = await prisma.rulebook.findMany({
    select: { gameId: true, title: true, size: true, updatedAt: true },
  });

  return Object.fromEntries(
    rows.map((row) => [
      row.gameId,
      { title: row.title, size: row.size, version: row.updatedAt.getTime() },
    ]),
  );
}

export async function deleteRulebook(gameId: string): Promise<void> {
  const prisma = await getPrisma();
  await prisma.rulebook.deleteMany({ where: { gameId } });
}
