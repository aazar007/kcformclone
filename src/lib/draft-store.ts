/**
 * A registration in progress, and the teammates filling it in.
 *
 * The captain finishes the roster and, **before submitting**, every teammate is
 * emailed a link to add their own details. Those answers must be readable
 * immediately — the review step shows them live — and they must not reserve the
 * team name, because an abandoned attempt is not a registration.
 *
 * So a draft is a small record of its own. Submitting turns it into a `Team` and
 * deletes it; the completion tokens travel with the rows, so a link that was sent
 * before submission still works afterwards.
 */

import type { Prisma } from "../../generated/prisma-client/client";
import { getPrisma } from "./db";
import { hashConfirmToken, tokenHash } from "./confirm-token";
import type { DraftProfile } from "./draft-merge";

/** How long an unsubmitted draft is kept before it is swept. */
export const DRAFT_TTL_HOURS = 72;

export interface DraftMemberFacts {
  role: string;
  universityId: string;
  universityName: string;
  universityRegion: string;
  email: string;
}

export interface DraftFacts {
  teamName: string;
  tournamentName: string;
  gameName: string;
  gender: string;
  leaderIndex: number;
  members: DraftMemberFacts[];
}

/**
 * One teammate as the browser sees them.
 *
 * `completed` is the whole point of polling: the review step shows a name appear
 * beside a row that was empty a moment ago.
 */
export interface LiveDraftMember {
  position: number;
  role: string;
  universityName: string;
  email: string;
  completed: boolean;
  completedAt: string | null;
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
}

export interface LiveDraft {
  id: string;
  teamName: string;
  gameName: string;
  leaderIndex: number;
  members: LiveDraftMember[];
  /** True once every non-leader row has been completed. */
  complete: boolean;
}

function answersOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): { id: string; label: string; value: string }[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const answer = entry as { id?: unknown; label?: unknown; value?: unknown };
    return [
      {
        id: String(answer.id ?? ""),
        label: String(answer.label ?? ""),
        value: String(answer.value ?? ""),
      },
    ];
  });
}

function toLive(row: {
  position: number;
  role: string;
  universityName: string;
  email: string;
  profileCompletedAt: Date | null;
  fullName: string;
  gameTag: string;
  studentId: string | null;
  discord: string;
  phone: string;
  requirements: unknown;
}): LiveDraftMember {
  return {
    position: row.position,
    role: row.role,
    universityName: row.universityName,
    email: row.email,
    completed: row.profileCompletedAt !== null,
    completedAt: row.profileCompletedAt ? row.profileCompletedAt.toISOString() : null,
    fullName: row.fullName,
    gameTag: row.gameTag,
    studentId: row.studentId ?? "",
    discord: row.discord,
    phone: row.phone,
    requirements: answersOf(row.requirements),
  };
}

/**
 * Create a draft, or refresh the one the browser already holds.
 *
 * A refresh keeps each row's completed profile **while that person's university
 * and address are unchanged** — that is what lets the captain go back to the
 * roster, fix a typo in a coach's role, and return without asking three players to
 * fill the same form again. Changing the address or the university is a different
 * person as far as the domain rule is concerned, so that row starts empty and its
 * link is reissued.
 *
 * `existingToken` is the value the browser kept from the previous response, so the
 * same draft can be updated rather than piling up one per Continue press.
 */
export async function upsertDraft(input: {
  id?: string | null;
  secret: string;
  facts: DraftFacts;
}): Promise<{
  id: string;
  members: LiveDraftMember[];
  /** Teammates who still need a link: the ones this call should email. */
  needsLink: { memberId: string; email: string; position: number }[];
}> {
  const prisma = await getPrisma();
  const secretHash = hashConfirmToken(input.secret);

  const existing = input.id
    ? await prisma.draft.findUnique({
        where: { id: input.id },
        include: { members: true },
      })
    : null;

  /* The id is only honoured when the caller also holds its secret — otherwise a
     guessed cuid would let anybody write into somebody else's draft. */
  const owned = existing && existing.secretHash === secretHash ? existing : null;

  const prior = new Map(
    (owned?.members ?? []).map((member) => [
      member.email.toLowerCase(),
      {
        profileCompletedAt: member.profileCompletedAt,
        confirmTokenHash: member.confirmTokenHash,
        fullName: member.fullName,
        gameTag: member.gameTag,
        studentId: member.studentId,
        discord: member.discord,
        phone: member.phone,
        requirements: member.requirements,
        universityId: member.universityId,
      },
    ]),
  );

  const rows = input.facts.members.map((member, position) => {
    const before = position === input.facts.leaderIndex ? undefined : prior.get(member.email.toLowerCase());
    const samePerson = before && before.universityId === member.universityId;

    return {
      position,
      role: member.role,
      universityId: member.universityId,
      universityName: member.universityName,
      universityRegion: member.universityRegion,
      email: member.email.toLowerCase(),
      fullName: samePerson ? before.fullName : "",
      gameTag: samePerson ? before.gameTag : "",
      studentId: samePerson ? before.studentId : null,
      discord: samePerson ? before.discord : "",
      phone: samePerson ? before.phone : "",
      requirements: (samePerson ? before.requirements : []) as Prisma.InputJsonValue,
      profileCompletedAt: samePerson ? before.profileCompletedAt : null,
      confirmTokenHash: samePerson ? before.confirmTokenHash : null,
    };
  });

  const draft = owned
    ? await prisma.$transaction(async (tx) => {
        await tx.draftMember.deleteMany({ where: { draftId: owned.id } });
        await tx.draftMember.createMany({
          data: rows.map((row) => ({ ...row, draftId: owned.id })),
        });
        return tx.draft.update({
          where: { id: owned.id },
          data: {
            teamName: input.facts.teamName,
            tournamentName: input.facts.tournamentName,
            gameName: input.facts.gameName,
            gender: input.facts.gender,
            leaderIndex: input.facts.leaderIndex,
          },
          include: { members: { orderBy: { position: "asc" } } },
        });
      })
    : await prisma.draft.create({
        data: {
          secretHash,
          teamName: input.facts.teamName,
          tournamentName: input.facts.tournamentName,
          gameName: input.facts.gameName,
          gender: input.facts.gender,
          leaderIndex: input.facts.leaderIndex,
          members: { create: rows },
        },
        include: { members: { orderBy: { position: "asc" } } },
      });

  return {
    id: draft.id,
    members: draft.members.map(toLive),
    needsLink: draft.members
      .filter(
        (member) =>
          member.position !== draft.leaderIndex &&
          Boolean(member.email) &&
          member.profileCompletedAt === null &&
          member.confirmTokenHash === null,
      )
      .map((member) => ({ memberId: member.id, email: member.email, position: member.position })),
  };
}

/** The draft, when the caller holds its secret. Read-only. */
export async function readDraft(
  id: string,
  secret: string,
): Promise<LiveDraft | null> {
  if (!id || !secret) return null;
  const prisma = await getPrisma();
  const draft = await prisma.draft.findUnique({
    where: { id },
    include: { members: { orderBy: { position: "asc" } } },
  });
  if (!draft) return null;
  if (draft.secretHash !== hashConfirmToken(secret)) return null;

  const members = draft.members.map(toLive);
  return {
    id: draft.id,
    teamName: draft.teamName,
    gameName: draft.gameName,
    leaderIndex: draft.leaderIndex,
    members,
    complete: members.every(
      (member) => member.position === draft.leaderIndex || member.completed,
    ),
  };
}

/** Store the hash of a fresh completion link for a draft row. */
export async function setDraftMemberToken(memberId: string, hash: string | null): Promise<void> {
  const prisma = await getPrisma();
  await prisma.draftMember.update({
    where: { id: memberId },
    data: { confirmTokenHash: hash },
  });
}

/** Delete a draft, used when it has become a real registration or been abandoned. */
export async function deleteDraft(id: string): Promise<void> {
  const prisma = await getPrisma();
  await prisma.draft.deleteMany({ where: { id } });
}

/** Sweep drafts nobody came back to. Cheap, and called from the draft endpoint. */
export async function pruneDrafts(): Promise<void> {
  const prisma = await getPrisma();
  const cutoff = new Date(Date.now() - DRAFT_TTL_HOURS * 60 * 60_000);
  await prisma.draft.deleteMany({ where: { updatedAt: { lt: cutoff } } }).catch(() => {});
}

/**
 * The draft row a completion link belongs to.
 *
 * Returned with the facts a player is not allowed to change — their role,
 * university and address come from the captain.
 */
export interface DraftCompletionTarget {
  kind: "draft";
  memberId: string;
  draftId: string;
  position: number;
  role: string;
  email: string;
  universityId: string;
  universityName: string;
  profileCompletedAt: Date | null;
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
  teamName: string;
  gameName: string;
}

export async function findDraftMemberByTokenHash(
  hash: string,
): Promise<DraftCompletionTarget | null> {
  const prisma = await getPrisma();
  const row = await prisma.draftMember.findUnique({
    where: { confirmTokenHash: hash },
    include: { draft: true },
  });
  if (!row) return null;

  return {
    kind: "draft",
    memberId: row.id,
    draftId: row.draftId,
    position: row.position,
    role: row.role,
    email: row.email,
    universityId: row.universityId,
    universityName: row.universityName,
    profileCompletedAt: row.profileCompletedAt,
    fullName: row.fullName,
    gameTag: row.gameTag,
    studentId: row.studentId ?? "",
    discord: row.discord,
    phone: row.phone,
    requirements: answersOf(row.requirements),
    teamName: row.draft.teamName,
    gameName: row.draft.gameName,
  };
}

/** Save a teammate's own details into their draft row. */
export async function completeDraftMemberByTokenHash(
  hash: string,
  input: {
    fullName: string;
    gameTag: string;
    studentId: string;
    discord: string;
    phone: string;
    requirements: { id: string; label: string; value: string }[];
  },
): Promise<{ ok: true; teamName: string; email: string } | { ok: false; reason: "unknown" }> {
  const prisma = await getPrisma();
  const row = await prisma.draftMember.findUnique({
    where: { confirmTokenHash: hash },
    include: { draft: { select: { teamName: true } } },
  });
  if (!row) return { ok: false, reason: "unknown" };

  await prisma.draftMember.updateMany({
    where: { id: row.id, confirmTokenHash: hash },
    data: {
      fullName: input.fullName,
      gameTag: input.gameTag,
      studentId: input.studentId.trim() || null,
      discord: input.discord,
      phone: input.phone,
      requirements: input.requirements as unknown as Prisma.InputJsonValue,
      profileCompletedAt: new Date(),
    },
    /* The draft's `updatedAt` must move too, or the sweeper would delete a draft
       that is being filled in. */
  });

  await prisma.draft.update({
    where: { id: row.draftId },
    data: { updatedAt: new Date() },
  });

  return { ok: true, teamName: row.draft.teamName, email: row.email };
}

/**
 * The completed profiles a submission should carry.
 *
 * Matched by address, not by position: the captain may have reordered or removed
 * rows after the links went out, and a profile must never be attached to whoever
 * now sits in that slot.
 */
export async function draftProfilesById(
  draftId: string,
  secret: string,
): Promise<Map<string, DraftProfile> | null> {
  if (!tokenHash(secret)) return null;
  const prisma = await getPrisma();
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: { members: { orderBy: { position: "asc" } } },
  });
  if (!draft || draft.secretHash !== hashConfirmToken(secret)) return null;

  const byEmail = new Map<string, DraftProfile>();
  for (const member of draft.members) {
    if (member.profileCompletedAt === null) continue;
    byEmail.set(member.email.toLowerCase(), {
      fullName: member.fullName,
      gameTag: member.gameTag,
      studentId: member.studentId ?? "",
      discord: member.discord,
      phone: member.phone,
      requirements: answersOf(member.requirements),
      completedAt: member.profileCompletedAt,
      confirmTokenHash: member.confirmTokenHash,
    });
  }
  return byEmail;
}

async function readDraftWithSecret(id: string, secret: string) {
  if (!tokenHash(secret)) return null;
  const prisma = await getPrisma();
  const draft = await prisma.draft.findUnique({
    where: { id },
    include: { members: { orderBy: { position: "asc" } } },
  });
  if (!draft || draft.secretHash !== hashConfirmToken(secret)) return null;
  return { ...draft, members: draft.members.map(toLive) };
}

/** Remove a draft once its registration has been stored. */
export async function consumeDraft(id: string, secret: string): Promise<void> {
  const draft = await readDraftWithSecret(id, secret);
  if (!draft) return;
  await deleteDraft(id);
}
