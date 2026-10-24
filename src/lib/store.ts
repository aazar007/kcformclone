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

function memberRows(input: TeamInput) {
  return input.members.map((member, index) => ({
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
  }));
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
        data: memberRows(input).map((row) => ({ ...row, teamId: id })),
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
      team: { select: { teamName: true } },
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
