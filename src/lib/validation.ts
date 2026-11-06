import {
  isGender,
  isMemberRole,
  roleForPosition,
  type Gender,
  type MemberRole,
} from "./games";
import type { SaudiRegion } from "./regions";
import {
  gameById,
  isGameAllowedForDivision,
  regionIsAllowed,
  requirementError,
  rosterRulesFor,
  selectableUniversities,
  universityById,
  type RosterRules,
  type TournamentConfig,
} from "./tournament";
import { normaliseTeamName, TEAM_NAME_MAX, TEAM_NAME_MIN } from "./team-name";
import {
  gameTagPolicyError,
  nameWarnings,
  personNamePolicyError,
  teamNameContentError,
  teamNamePolicyError,
  type NameCheckOptions,
} from "./name-policy";
import { normalisePhone } from "./utils";
import { toWesternDigits } from "./i18n";
import {
  UNIVERSITIES,
  acceptedEmailDomains,
  emailDomainOf,
  emailMatchesUniversity,
  type University,
} from "./universities";

/* ------------------------------------------------------------------ */
/* Field patterns                                                      */
/* ------------------------------------------------------------------ */

/**
 * The *shape* of an email address.
 *
 * This used to demand an `.edu.sa` suffix, which was the whole rule before each
 * university's own domains were enforced. Now that the domain must belong to the
 * selected institution, that suffix test is both redundant and wrong: it refused
 * `@alfaisal.edu`, which is a real address for a university on this list.
 *
 * So this checks the shape only — `local@label(.label)+.tld` — and the authority is
 * `emailMatchesUniversity`, which cannot be satisfied by an address outside the chosen
 * university's domains.
 */
export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** Saudi mobile: 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX or +9665XXXXXXXX. */
export const PHONE_PATTERN = /^(?:\+?966|0)?5\d{8}$/;

/** Discord username, optionally with a legacy #1234 discriminator. */
export const DISCORD_PATTERN = /^[a-z0-9._]{2,32}(#\d{4})?$/i;

/**
 * A student number: digits only, 4–20 of them.
 *
 * It used to allow letters and dashes, which nothing issues and which let a
 * captain type a Discord handle into the field the organisers actually use to
 * look a student up. Every stored value is 8–9 digits, so the narrower rule
 * matches the real data.
 *
 * The bounds are exported and the pattern built from them so the input's
 * `maxLength` cannot drift away from what the rule accepts.
 */
export const STUDENT_ID_MIN = 4;
export const STUDENT_ID_MAX = 20;
export const STUDENT_ID_PATTERN = new RegExp(`^\\d{${STUDENT_ID_MIN},${STUDENT_ID_MAX}}$`);

/**
 * The student number contained in an address, according to that institution's format.
 *
 * Every university on the list issues `<number>@<domain>`, and two put literal text around
 * the number — `s441234567@seu.edu.sa` and `441234567KSA@aou.edu.sa`. This reads the number
 * back out so the form can fill the student-ID field from the address a student is already
 * typing, rather than asking for the same digits twice.
 *
 * Returns `null` — never a guess — in every case where the answer is not certain:
 *
 * - the address does not belong to the chosen university (a different institution's format
 *   must not be applied to it);
 * - the declared prefix/suffix is missing, so what follows is not the number;
 * - what remains is not digits, or is outside the length the rule accepts.
 *
 * The last one matters: an address like `ali@imamu.edu.sa` has a non-numeric local part, so
 * nothing is extracted and the field is left alone. A wrong number silently written into
 * the field an organiser uses to identify a student is far worse than no convenience at all.
 *
 * Affixes are matched case-insensitively — `S441234567@` and `441234567ksa@` are what a
 * phone keyboard produces — but the digits are returned as typed.
 */
export function studentIdFromEmail(
  email: string,
  university: Pick<University, "studentIdFormat"> & Parameters<typeof emailMatchesUniversity>[1],
): string | null {
  const address = email.trim();
  if (!emailMatchesUniversity(address, university)) return null;

  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  let local = address.slice(0, at);

  const { prefix, suffix } = university.studentIdFormat ?? {};

  if (prefix) {
    if (!local.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    local = local.slice(prefix.length);
  }
  if (suffix) {
    if (!local.toLowerCase().endsWith(suffix.toLowerCase())) return null;
    local = local.slice(0, local.length - suffix.length);
  }

  /* Arabic-Indic digits are folded first: a student on an Arabic keyboard may type the
     number that way, and the rest of the form already accepts it. */
  const digits = toWesternDigits(local);
  return STUDENT_ID_PATTERN.test(digits) ? digits : null;
}

/**
 * The student number *as it is being typed*, before the address is finished.
 *
 * `studentIdFromEmail` above is deliberately strict: it answers only when the whole address
 * is present and correct. That is the right rule for the value the field ends up with, but
 * it made the fill arrive in one jump at the last keystroke — nine digits typed, nothing
 * shown, and then the number appeared in full. To anybody filling in the form that reads as
 * "the fill does not work", which is exactly how it was reported.
 *
 * So this reads the digits seen so far and returns them, letting the field grow number by
 * number with the address. It is used only to *show* a value: submission is still judged by
 * the strict rule, and a provisional number is withdrawn — not left behind — the moment the
 * address stops being a candidate for this institution.
 *
 * Deliberately lax in two places, and only these two:
 *
 * - **A missing affix is forgiven.** `s` (SEU, Shaqra) and `KSA` (AOU) are the last thing
 *   typed or the first; refusing mid-word would blank the field and fill it again.
 * - **A partly typed domain is accepted.** `@stu` is on its way to `student.ksu.edu.sa`.
 *   A domain that has gone elsewhere — `@gma`, heading for gmail — is not, and empties it.
 *
 * Everything that made the strict rule safe still holds here: only digits are ever returned,
 * the length is bounded, and an address belonging to a different university yields nothing.
 */
export function studentIdPreviewFromEmail(
  email: string,
  university: Pick<University, "studentIdFormat"> & Parameters<typeof emailMatchesUniversity>[1],
): string | null {
  const address = email.trim();
  if (!address) return null;

  const at = address.lastIndexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  const domain = at === -1 ? "" : address.slice(at + 1).trim().toLowerCase();

  /* The domain is the only part that can disqualify a half-typed address. Empty means it has
     not been written yet; started means it must still be heading for one of this
     institution's domains, or the digits beside it belong to somebody else's address. */
  if (domain) {
    const onTheWay = acceptedEmailDomains(university).some((allowed) => {
      const target = allowed.toLowerCase();
      return domain === target || domain.endsWith(`.${target}`) || target.startsWith(domain);
    });
    if (!onTheWay) return null;
  }

  let body = local;
  const { prefix, suffix } = university.studentIdFormat ?? {};

  if (prefix && body.toLowerCase().startsWith(prefix.toLowerCase())) {
    body = body.slice(prefix.length);
  }
  if (suffix && body.toLowerCase().endsWith(suffix.toLowerCase())) {
    body = body.slice(0, body.length - suffix.length);
  }

  const digits = toWesternDigits(body).replace(/[^0-9]/g, "");
  return digits ? digits.slice(0, STUDENT_ID_MAX) : null;
}

/**
 * What the student-number field should hold after the address or the institution changes.
 *
 * The rule lives here rather than in the component because it is subtle enough to deserve
 * tests and it is needed in two places — editing the address and changing the institution.
 * Both ask the same question: *is the number currently in the field the one the form put
 * there, or did a person choose it?*
 *
 * The answer is reached without any extra state. A value that is empty, or equal to what the
 * previous address implied, came from the form and belongs to the form; anything else was
 * typed by hand and is never overwritten. Emptying the field therefore hands it back — which
 * is the only way to get the convenience back after a correction.
 *
 * The strict reader is preferred wherever it can answer, so a finished address always yields
 * exactly what submission will accept; the preview only speaks for an address still being
 * typed.
 */
export function studentIdAfterEdit(
  currentStudentId: string,
  previous: { email: string; university?: University },
  next: { email: string; university?: University },
): string {
  const read = (email: string, university?: University) =>
    university
      ? (studentIdFromEmail(email, university) ?? studentIdPreviewFromEmail(email, university))
      : null;

  const impliedBefore = read(previous.email, previous.university);
  if (currentStudentId.length > 0 && currentStudentId !== impliedBefore) return currentStudentId;

  return read(next.email, next.university) ?? "";
}

/**
 * In-game handle — deliberately permissive because every title formats them
 * differently (Epic `Name#1234`, Riot `Name#TAG`, Battle.net `Name#1234`).
 * Only the shape is checked: printable, no leading/trailing space, 2–32 chars.
 */
export const GAME_TAG_PATTERN = /^[\w .#@$&'’\-\[\]()]{2,32}$/u;

/** Longest and shortest accepted person name, in characters. */
export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 60;

/**
 * How many words a full name must contain.
 *
 * A single token is nearly always a placeholder — "test", "asdf", a nickname —
 * and this field asks for the name printed on a student ID, which carries at
 * least a given name and a family name.
 */
export const NAME_MIN_WORDS = 2;

/**
 * A person's name.
 *
 * Letters from any script — Arabic included — along with the combining marks
 * they carry, plus the punctuation real names contain: spaces, hyphen (Jean-Luc),
 * apostrophe in both its straight and curly forms (O'Brien), and a full stop for
 * initials (Mohd. A. Ali).
 *
 * Digits and every other symbol are excluded. A number in a name field is not a
 * name, it is a mistyped field — and this is the only thing standing between the
 * roster and "12345".
 */
const PERSON_NAME_PATTERN = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;

/**
 * Why a name is not acceptable, or `null` when it is.
 *
 * One function so the browser and the API cannot disagree about what a name is —
 * the API re-runs exactly this against the submitted payload.
 */
export function personNameError(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");

  if (!value) return "Required";
  if (value.length < NAME_MIN_LENGTH) return "Too short";
  if (value.length > NAME_MAX_LENGTH) return "Too long";
  if (!/\p{L}/u.test(value)) return "Enter a name, not numbers or symbols";
  if (!PERSON_NAME_PATTERN.test(value)) {
    return "Use letters only — no numbers or special characters";
  }

  const words = value.split(" ").filter((word) => /\p{L}/u.test(word));
  if (words.length < NAME_MIN_WORDS) {
    return "Enter the full name — given name and family name";
  }

  return null;
}

/**
 * The part of a person-name problem that more typing cannot fix.
 *
 * The companion to `personNameError`, and split the same way as the team-name
 * rules: a name being typed is one word before it is two, and saying so while the
 * captain is mid-word is noise. Digits or a refused word are different — those
 * cannot be typed away, so they are worth saying at once.
 *
 * Returns `null` for a name that is merely unfinished.
 */
export function personNameContentError(
  raw: string,
  options: NameCheckOptions = {},
): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.length > NAME_MAX_LENGTH) return "Too long";

  if (/\p{L}/u.test(value)) {
    if (!PERSON_NAME_PATTERN.test(value)) {
      return "Use letters only — no numbers or special characters";
    }
  } else if (/\p{N}|\p{S}/u.test(value)) {
    return "Enter a name, not numbers or symbols";
  }

  return personNamePolicyError(value, options);
}

/* ------------------------------------------------------------------ */
/* Live feedback                                                       */
/* ------------------------------------------------------------------ */

/** The fields whose wording rules can be judged while the captain is typing. */
export type LiveField = "teamName" | "fullName" | "gameTag" | "email";

/**
 * Whether a field is wrong in a way that more typing cannot fix.
 *
 * The form uses this to decide when to show an error *before* the captain leaves
 * the field. That matters more than it sounds: the validation was always running,
 * but the error stayed hidden until a blur, so a student who typed a refused name
 * saw nothing at all and reasonably concluded that nothing was being checked.
 *
 * Only the "cannot be typed away" problems qualify. Everything else — required,
 * too short, one word instead of two — waits for the blur, because showing those
 * mid-word would put an error under every field the moment it was touched.
 *
 * Purely advisory: it decides *when* to reveal, never *what* to say. The message
 * shown is always the one `validateDraft` produced, so the two cannot drift.
 */
export function revealsImmediately(
  field: LiveField,
  raw: string,
  blockedTerms: readonly string[] = [],
): boolean {
  const value = raw.trim();
  if (!value) return false;

  switch (field) {
    case "teamName":
      return teamNameContentError(normaliseTeamName(value), { blockedTerms }) !== null;

    case "fullName":
      return personNameContentError(value, { blockedTerms }) !== null;

    case "gameTag":
      return gameTagPolicyError(value, { blockedTerms }) !== null;

    case "email": {
      /*
       * **No red while the address is still being built.**
       *
       * This used to answer for any finished-looking local part — an `@` with a dot
       * after it — which meant `4412@student.` flagged red on the way to
       * `4412@student.ksu.edu.sa`. The complaint was exactly that: an error appeared
       * before anything had been checked, on a value that was simply not finished, and a
       * field that turns red while you type teaches people to ignore it.
       *
       * So only a *definite* answer is given at once, and only for a well-formed
       * address: one whose domain belongs to no university on the list. `@gmail.com` is
       * wrong whatever is selected, and saying so while the captain is looking at the
       * field saves a wasted code. Everything else — malformed, incomplete, or merely
       * the wrong institution for the current selection — waits for the blur or the
       * attempt to continue, which is when a check has actually run.
       */
      if (!EMAIL_PATTERN.test(value)) return false;

      /*
       * **A domain that is still being typed is not a wrong domain.**
       *
       * `4412@student.ksu` satisfies `EMAIL_PATTERN` — `.ksu` is a plausible top-level
       * label — so the domain test below used to reject it and turn the field red while
       * the student was three keystrokes from `student.ksu.edu.sa`. The same "on the way
       * somewhere" test the student-number reader uses fixes it: a domain that is a
       * *prefix* of an accepted domain is unfinished, not foreign.
       *
       * Only a domain that has plainly gone elsewhere — `gmail.com`, `ksu.edu.sa.example`
       * — gets an answer at once. Anything else waits for the blur or the attempt to
       * continue, which is when a check has actually run.
       */
      const domain = emailDomainOf(value);
      const headingSomewhereValid = UNIVERSITIES.some((university) =>
        acceptedEmailDomains(university).some((allowed) => {
          const target = allowed.toLowerCase();
          return domain === target || domain.endsWith(`.${target}`) || target.startsWith(domain);
        }),
      );
      return !headingSomewhereValid;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Draft shape                                                         */
/* ------------------------------------------------------------------ */

/**
 * One roster slot. Every member carries their own university, game tag and
 * contact details — a roster may legitimately mix institutions, so nothing here
 * is team-level except the leader flag.
 *
 * `verifiedEmail`/`emailProof` are the outcome of the OTP exchange: the address
 * the member proved they own, and the signed receipt the API checks. Only the team
 * leader needs one before submission; every other member confirms from the link we
 * email them afterwards. Editing the address afterwards invalidates both, so
 * verification cannot be borrowed from one member by another.
 */
export interface MemberDraft {
  fullName: string;
  gameTag: string;
  universityId: string;
  email: string;
  studentId: string;
  discord: string;
  phone: string;
  role: MemberRole;
  /** The address this member has proved they own, or "" when unverified. */
  verifiedEmail: string;
  /** Signed receipt for `verifiedEmail`, issued by /api/otp/verify. */
  emailProof: string;
  /** Answers to the organiser-defined requirements, keyed by requirement id. */
  requirements: Record<string, string>;
}

export interface RegistrationDraft {
  teamName: string;
  gender: Gender | "";
  gameId: string;
  members: MemberDraft[];
  /** Index into `members` of the nominated team leader, or null. */
  leaderIndex: number | null;
  /**
   * Whether the captain has accepted the privacy notice and the rules.
   *
   * Held on the draft rather than derived, because it is a statement about a
   * person, not about the data — the API records when it was made.
   */
  consentGiven: boolean;
  /**
   * Whether the captain accepted the tournament rules.
   *
   * The second of the two promises made before submitting. It covers having read the
   * rulebook *and* accepting that breaching a rule can cost the team its place —
   * which is why it is separate from consent, that being about personal data rather
   * than conduct. Kept on the draft so it survives a reload, and checked on the
   * server so a hand-made request cannot skip a step the form insists on.
   */
  rulesAccepted: boolean;
}

export const EMPTY_MEMBER: Omit<MemberDraft, "requirements"> = {
  fullName: "",
  gameTag: "",
  universityId: "",
  email: "",
  studentId: "",
  discord: "",
  phone: "",
  role: "STARTER",
  verifiedEmail: "",
  emailProof: "",
};

export const EMPTY_DRAFT: RegistrationDraft = {
  teamName: "",
  gender: "",
  gameId: "",
  members: [{ ...EMPTY_MEMBER, requirements: {} }],
  leaderIndex: null,
  consentGiven: false,
  rulesAccepted: false,
};

/** A fresh roster slot — always a new object, never a shared reference. */
export function emptyMember(role: MemberRole = "STARTER"): MemberDraft {
  return { ...EMPTY_MEMBER, role, requirements: {} };
}

/**
 * Grow or shrink the roster, always keeping at least one row.
 *
 * Rows that survive keep their data, including whether their email was verified:
 * shrinking and growing again must not silently discard a completed check.
 */
export function resizeMembers(members: MemberDraft[], count: number): MemberDraft[] {
  const next = members.slice(0, count).map((member) => ({
    ...emptyMember(),
    ...(member ?? {}),
    requirements: { ...(member?.requirements ?? {}) },
  }));
  while (next.length < count) next.push(emptyMember());
  return next.length > 0 ? next : [emptyMember()];
}

/**
 * Rebuild the roster to exactly the shape the rules require and the captain chose.
 *
 * **The starting line-up is not the captain's to choose** — the game decides how
 * many play, so those rows are always present. What the captain does choose is the
 * bench: how many substitutes, and whether the team carries a coach at all.
 *
 * Rows are kept by position, and their data with them, so changing the bench size
 * never clears somebody's university or address. Roles are rewritten from the
 * position, which is what makes the shape true rather than merely displayed.
 */
export function resizeRoster(
  members: MemberDraft[],
  rules: RosterRules,
  substitutes: number,
  hasCoach: boolean,
): MemberDraft[] {
  const bench = Math.max(0, Math.min(substitutes, rules.maxSubstitutes));
  const coach = hasCoach && rules.maxCoaches > 0 ? 1 : 0;
  const total = rules.starters + bench + coach;

  const rows: MemberDraft[] = [];
  for (let index = 0; index < total; index += 1) {
    const role: MemberRole =
      index < rules.starters
        ? "STARTER"
        : index < rules.starters + bench
          ? "SUBSTITUTE"
          : "COACH";
    const prior = members[index];
    rows.push({
      ...emptyMember(role),
      ...(prior ?? {}),
      role,
      requirements: { ...(prior?.requirements ?? {}) },
    });
  }
  return rows;
}

/**
 * How the roster is currently shaped, for the controls that describe it.
 */
export function rosterShape(members: MemberDraft[], rules: RosterRules) {
  const counts = countRoles(members, rules);
  return {
    starters: counts.starters,
    substitutes: counts.substitutes,
    coaches: counts.coaches,
    hasCoach: counts.coaches > 0,
  };
}

/**
 * Set every slot's role from its position: the first `squadSize` rows are
 * starters, the rest substitutes. Used when the game changes and the meaning of
 * a position shifts.
 */
export function applyPositionRoles(members: MemberDraft[], squadSize: number): MemberDraft[] {
  return members.map((member, index) => ({
    ...member,
    role: member.role === "COACH" ? "COACH" : roleForPosition(index, squadSize),
  }));
}

/** Fill in any field an older stored draft is missing. */
export function normaliseMember(
  member: Partial<MemberDraft> | undefined,
  config: TournamentConfig,
): MemberDraft {
  const known = new Set(config.requirements.map((requirement) => requirement.id));
  const requirements: Record<string, string> = {};

  for (const [key, value] of Object.entries(member?.requirements ?? {})) {
    if (known.has(key) && typeof value === "string") requirements[key] = value;
  }

  const email = typeof member?.email === "string" ? member.email : "";
  const verifiedEmail = typeof member?.verifiedEmail === "string" ? member.verifiedEmail : "";
  const emailProof = typeof member?.emailProof === "string" ? member.emailProof : "";
  // A stored proof only means anything while it still matches the typed address.
  const stillVerified = verifiedEmail.trim().toLowerCase() === email.trim().toLowerCase();

  return {
    fullName: typeof member?.fullName === "string" ? member.fullName : "",
    gameTag: typeof member?.gameTag === "string" ? member.gameTag : "",
    universityId: typeof member?.universityId === "string" ? member.universityId : "",
    email,
    studentId: typeof member?.studentId === "string" ? member.studentId : "",
    discord: typeof member?.discord === "string" ? member.discord : "",
    phone: typeof member?.phone === "string" ? member.phone : "",
    role: isMemberRole(member?.role) ? member.role : "STARTER",
    verifiedEmail: stillVerified ? verifiedEmail : "",
    emailProof: stillVerified ? emailProof : "",
    requirements,
  };
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

export const STEPS = [
  { id: "team", title: "Team", blurb: "Name your squad and pick your section" },
  { id: "game", title: "Game", blurb: "Choose the title you are entering" },
  { id: "roster", title: "Roster", blurb: "Members, roles and email verification" },
  { id: "review", title: "Review", blurb: "Check everything before submitting" },
] as const;

export const STEP_COUNT = STEPS.length;

/** Which wizard step owns a given field key. Review (3) owns nothing. */
export function fieldStep(key: string): number {
  if (key === "teamName" || key === "gender") return 0;
  if (key === "game") return 1;
  if (key === "members" || key.startsWith("members.")) return 2;
  if (key === "leader" || key.startsWith("member.")) return 2;
  /* Consent deliberately falls through to the review step, where its checkbox
     is. Putting it on step 0 — as it was — made the form impossible to finish:
     the captain could not leave step 0 without ticking a box they could not
     reach until they had passed step 3, and the final button stayed disabled. */
  return 3;
}

export interface ValidationResult {
  errors: Record<string, string>;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

/**
 * The role a roster slot actually holds.
 *
 * A slot's own choice wins, except that it is downgraded to a playing role when
 * the organisers have that role closed — which is how a draft saved before a
 * rule change is quietly brought back into line.
 */
export function resolveRole(member: Pick<MemberDraft, "role">, rules: RosterRules): MemberRole {
  if (member.role === "COACH" && rules.maxCoaches === 0) return "SUBSTITUTE";
  if (member.role === "SUBSTITUTE" && rules.maxSubstitutes === 0) return "STARTER";
  return member.role;
}

/** How many of each role a roster holds, after coercion. */
export function countRoles(members: MemberDraft[], rules: RosterRules) {
  let starters = 0;
  let substitutes = 0;
  let coaches = 0;
  for (const member of members) {
    const role = resolveRole(member, rules);
    if (role === "COACH") coaches += 1;
    else if (role === "SUBSTITUTE") substitutes += 1;
    else starters += 1;
  }
  return { starters, substitutes, coaches };
}

/**
 * Who the team leader is: **the registrant, who is always the first row**.
 *
 * The form used to ask, with a tick on each row. That was wrong twice over — a
 * player entering a team is not in a position to *choose* the leader after the
 * fact, and a stored index that survived a roster resize could point at a coach
 * or past the end of the list. The rule is now the same one the organisers state
 * before the form opens: whoever registers the team leads it.
 *
 * Coaches cannot lead, so the helper walks forward to the first playable row. In
 * the shape this form builds that is position 0, because starters come first; the
 * walk exists for a stored team an organiser has since reordered.
 *
 * Returns null when there is nobody eligible, so the caller still reports the
 * problem rather than silently nominating an empty row.
 */
export function effectiveLeaderIndex(
  draft: Pick<RegistrationDraft, "members" | "leaderIndex">,
  rules: RosterRules,
): number | null {
  /* **The registrant is the leader.** The form no longer asks, and the browser is
     not trusted to say: whoever submits the registration *is* the team leader, and
     the roster step puts them first. `leaderIndex` is therefore always 0 — kept in
     the shape only because stored teams and the organiser's editor still read it. */
  const firstPlayable = draft.members.findIndex(
    (member) => resolveRole(member, rules) !== "COACH",
  );
  return firstPlayable === -1 ? null : firstPlayable;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateDraft(
  draft: RegistrationDraft,
  config: TournamentConfig,
): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  const game = gameById(config, draft.gameId);
  const rules = rosterRulesFor(config, game);
  const universities = selectableUniversities(config, draft.gender);

  /* -------- Step 0: team identity -------- */
  const rawTeamName = draft.teamName.trim();
  const teamName = normaliseTeamName(rawTeamName);
  const policy = { blockedTerms: config.blockedTerms };

  if (!rawTeamName) {
    errors.teamName = "Enter your team name";
  } else if (teamName.length < TEAM_NAME_MIN) {
    errors.teamName = `Team name must be at least ${TEAM_NAME_MIN} characters`;
  } else if (teamName.length > TEAM_NAME_MAX) {
    errors.teamName = `Team name must be ${TEAM_NAME_MAX} characters or fewer`;
  } else {
    // Shape and language rules run on the name as it will appear on the bracket.
    const problem = teamNamePolicyError(teamName, policy);
    if (problem) {
      errors.teamName = problem;
    } else {
      /* Rude but not refused — accepted, and flagged so the organisers see it
         before it reaches a published bracket. */
      warnings.push(...nameWarnings(teamName, { ...policy, label: "The team name" }));
    }
  }

  if (!draft.gender) errors.gender = "Choose your section";

  /* -------- Step 0b: consent -------- */
  if (config.requireConsent && !draft.consentGiven) {
    errors.consent = "Please confirm you have read and accept the notice";
  }

  /* -------- Step 0c: the tournament rules --------
   * Unconditional, unlike the rulebook *document*: the organisers want two promises
   * before an entry is accepted, and the second one — read the rulebook, accept the
   * rules, accept that breaking one costs the team its place — stands on its own even
   * when no PDF has been published yet. */
  if (!draft.rulesAccepted) {
    errors.rules = "Please confirm you have read the rulebook and agree to the rules";
  }

  /* -------- Step 1: game -------- */
  if (!draft.gameId) {
    errors.game = "Choose a game";
  } else if (!game) {
    errors.game = "Choose a game from the list";
  } else if (!isGameAllowedForDivision(config, draft.gameId, draft.gender)) {
    errors.game = `${game.name} is not offered in the ${
      draft.gender === "female" ? "female" : "male"
    } section`;
  }

  /* -------- Step 2: roster composition -------- */
  const counts = countRoles(draft.members, rules);

  if (draft.members.length > rules.maxTotal) {
    errors.members = `A roster can hold at most ${rules.maxTotal} people`;
  } else if (counts.starters !== rules.starters) {
    errors.members =
      counts.starters < rules.starters
        ? `${game?.name ?? "This game"} fields ${rules.starters} starters — add ${
            rules.starters - counts.starters
          } more`
        : `${game?.name ?? "This game"} fields exactly ${rules.starters} starters — ${
            counts.starters
          } are marked as starters`;
  } else if (counts.substitutes > rules.maxSubstitutes) {
    errors.members =
      rules.maxSubstitutes === 0
        ? "This tournament does not accept substitutes"
        : `At most ${rules.maxSubstitutes} substitute${rules.maxSubstitutes === 1 ? "" : "s"} allowed`;
  } else if (counts.coaches > rules.maxCoaches) {
    errors.members =
      rules.maxCoaches === 0
        ? "This tournament does not accept coaches"
        : `At most ${rules.maxCoaches} coach${rules.maxCoaches === 1 ? "" : "es"} allowed`;
  }

  const seenEmails = new Map<string, number>();
  const seenStudentIds = new Map<string, number>();
  const seenGameTags = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const universitiesUsed = new Set<string>();

  /* The leader is resolved before the roster is checked, because email verification
     now only applies to them. A coach can never lead, so `effectiveLeaderIndex`
     already excludes them. */
  const leaderIndex = effectiveLeaderIndex(draft, rules);

  draft.members.forEach((member, index) => {
    const prefix = `member.${index}`;
    const isCoach = resolveRole(member, rules) === "COACH";
    const isLeader = leaderIndex === index;
    /* The captain only enters a teammate's university and address. Everything else
       is completed by that person from their emailed link, so an empty field here
       means "not their job", not "missing". Non-empty values are still checked. */
    const completesOwnDetails = !isLeader;

    /* -- name -- */
    const name = member.fullName.trim();
    if (!name && completesOwnDetails) {
      // Left for the player.
    } else {
      const nameProblem = personNameError(name) ?? personNamePolicyError(name, policy);
      if (nameProblem) {
        errors[`${prefix}.fullName`] = nameProblem;
      } else {
        warnings.push(
          ...nameWarnings(name, { ...policy, label: `Member ${index + 1}'s name` }),
        );
        /* The same name twice is nearly always one person entered on two rows — but
           two players can genuinely share a name, so this warns instead of blocking. */
        const nameKey = name.replace(/\s+/g, " ").toLowerCase();
        const earlier = seenNames.get(nameKey);
        if (earlier !== undefined) {
          warnings.push(
            `Member ${earlier + 1} and member ${index + 1} have the same name — check you have not listed the same person twice`,
          );
        } else {
          seenNames.set(nameKey, index);
        }
      }
    }

    /* -- in-game tag (coaches do not play, so they need none) -- */
    const gameTag = member.gameTag.trim();
    if (!gameTag) {
      if (!isCoach && !completesOwnDetails) errors[`${prefix}.gameTag`] = "Required";
    } else if (!GAME_TAG_PATTERN.test(gameTag)) {
      errors[`${prefix}.gameTag`] = "2–32 characters — letters, numbers, dots, dashes or #";
    } else if (gameTagPolicyError(gameTag, policy)) {
      // Handles appear on every scoreboard, so they get the same scrutiny.
      errors[`${prefix}.gameTag`] = gameTagPolicyError(gameTag, policy)!;
    } else {
      warnings.push(
        ...nameWarnings(gameTag, { ...policy, label: `Member ${index + 1}'s game tag` }),
      );
      const key = gameTag.toLowerCase();
      const first = seenGameTags.get(key);
      if (first !== undefined) errors[`${prefix}.gameTag`] = `Already used by member ${first + 1}`;
      else seenGameTags.set(key, index);
    }

    /* -- university (per member — a roster may mix institutions) --
     *
     * Optional for coaches. A coach may have graduated, or never studied at one of
     * these institutions, so a university and student number are questions about the
     * players, not about the person on the bench. */
    const chosen = universities.find((university) => university.id === member.universityId);
    if (!member.universityId) {
      if (!isCoach) errors[`${prefix}.university`] = "Select this member's university";
    } else if (!chosen) {
      // Most often: the province this institution belongs to was closed while
      // the form was open, so it is no longer on the list at all.
      errors[`${prefix}.university`] = "Select a university from the list";
    } else {
      universitiesUsed.add(chosen.id);
      if (!regionIsAllowed(config, chosen.region)) {
        errors[`${prefix}.university`] =
          `Universities in ${chosen.region} are not open for this tournament`;
      }
    }

    /* -- email --
     *
     * Only the team leader proves ownership with a code during registration. Every
     * other member is emailed a confirmation link after submission and stays marked
     * pending until they use it, so this check must not block a non-leader.
     *
     * A coach may use any address — a university address is not required once they
     * have graduated — so the domain rule applies to players only. */
    const email = member.email.trim();
    if (!email) {
      errors[`${prefix}.email`] = "Required";
    } else if (!EMAIL_PATTERN.test(email)) {
      errors[`${prefix}.email`] = "Enter a valid email address";
    } else if (!isCoach && !chosen) {
      /* **No address without a university.** The address is checked against the domain of
         the institution on this row, so without one there is no rule to check it against —
         and any address would pass. Requiring the choice first is what makes "strict on its
         own domain" true rather than decorative. The form also disables the field until a
         university is picked; this is the server-side half of the same rule. */
      errors[`${prefix}.email`] =
        "Choose this member's university first — the address must be its domain";
    } else if (!isCoach && chosen && !emailMatchesUniversity(email, chosen)) {
      /* Before the verification check, deliberately. The other order told a captain to
         verify an address that could never be accepted — which sends a real code to the
         wrong mailbox and only then refuses the entry, at the end of the form. Saying it
         now costs one message instead of an email and a wasted trip. */
      errors[`${prefix}.email`] = `${email} is not a ${chosen.name} address (expected ${acceptedEmailDomains(chosen)[0]})`;
    } else if (isLeader && member.verifiedEmail.trim().toLowerCase() !== email.toLowerCase()) {
      // The client only tracks *which* address was acknowledged; the signed proof
      // is checked by the API. Editing the address un-acknowledges it. Only the
      // leader is asked to do this before submission.
      errors[`${prefix}.email`] = "Verify this address with the code we email you";
    } else {
      const key = email.toLowerCase();
      const first = seenEmails.get(key);
      if (first !== undefined) {
        errors[`${prefix}.email`] = `Already used by member ${first + 1}`;
      } else {
        seenEmails.set(key, index);
      }
    }

    /* -- student id (coaches need not be students) -- */
    const studentId = member.studentId.trim();
    if (!studentId) {
      if (!isCoach && !completesOwnDetails) errors[`${prefix}.studentId`] = "Required";
    } else if (!STUDENT_ID_PATTERN.test(studentId)) {
      errors[`${prefix}.studentId`] = "4–20 numbers";
    } else {
      const key = studentId.toLowerCase();
      const first = seenStudentIds.get(key);
      if (first !== undefined) errors[`${prefix}.studentId`] = `Already used by member ${first + 1}`;
      else seenStudentIds.set(key, index);
    }

    /* -- contact: every member, not just the leader -- */
    const discord = member.discord.trim();
    if (!discord) {
      if (!completesOwnDetails) errors[`${prefix}.discord`] = "Required";
    } else if (!DISCORD_PATTERN.test(discord)) {
      errors[`${prefix}.discord`] = "2–32 characters — letters, numbers, dots or underscores";
    }

    const phone = member.phone.trim();
    if (!phone) {
      if (!completesOwnDetails) errors[`${prefix}.phone`] = "Required";
    } else if (!normalisePhone(phone)) {
      errors[`${prefix}.phone`] = "Enter a Saudi mobile, e.g. 05X XXX XXXX";
    }

    /* -- organiser-defined requirements --
     * Answered by the player in the completion form, so the captain is not asked
     * to answer for somebody else. */
    if (!completesOwnDetails) {
      for (const requirement of config.requirements) {
        const message = requirementError(requirement, member.requirements[requirement.id]);
        if (message) errors[`${prefix}.req.${requirement.id}`] = message;
      }
    }
  });

  /* -------- One university per roster, when the organisers require it -------- */
  if (!config.allowMixedUniversities && universitiesUsed.size > 1) {
    errors["members.university"] =
      "All members must come from the same university for this tournament";
  }

  /* -------- Team leader -------- */
  /* The effective leader, not the raw index: a roster with a single eligible member
     has already decided, and blocking that on a checkbox the captain never needed to
     tick is how a 1v1 team got stuck. Resolved above the roster loop, because only the
     leader's address needs to be verified before submission. */
  /* Leadership is decided by the roster's shape now — the registrant is first and
     the bench and coach come after them — so there is nothing for the captain to
     get wrong here. Only the impossibility is reported. */
  if (leaderIndex === null) {
    errors.leader = "Add your members' names first";
  } else if (resolveRole(draft.members[leaderIndex], rules) === "COACH") {
    // The organisers contact someone on the field, not the bench.
    errors.leader = "The team leader must be a starter, not a coach";
  }

  return { errors, warnings: Array.from(new Set(warnings)) };
}

/** A wizard step is satisfied when none of its fields carry an error. */
export function isStepValid(step: number, errors: Record<string, string>) {
  return !Object.keys(errors).some((key) => fieldStep(key) === step);
}

/**
 * Roster is the one step whose failures live on sub-keys, so it needs a bespoke
 * summary line for the footer.
 */
export function stepSummary(step: number, errors: Record<string, string>) {
  const own = Object.keys(errors).filter((key) => fieldStep(key) === step);
  if (own.length === 0) return null;
  if (step === 2 && errors.members) return errors.members;
  return errors[own[0]];
}

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

export interface PayloadMember {
  fullName: string;
  gameTag: string;
  universityId: string;
  universityName: string;
  universityRegion: SaudiRegion;
  email: string;
  studentId: string;
  discord: string;
  phone: string;
  role: MemberRole;
  /** Signed receipt from /api/otp/verify proving this member owns the address. */
  emailProof: string;
  /** Answers to the organiser-defined requirements, label included for export. */
  requirements: { id: string; label: string; value: string }[];
  /**
   * Set by the API — never by the browser — when this teammate completed their
   * details from their emailed link before the team was submitted. It is the
   * receipt, not an input: `validatePayload` ignores it and the route attaches it
   * from the draft row it loaded itself.
   */
  profileCompletedAt?: Date | null;
  /** The hash of that completed member's link, carried into the stored team. */
  confirmTokenHash?: string | null;
}

export interface RegistrationPayload {
  tournamentName: string;
  teamName: string;
  gender: Gender;
  gameId: string;
  gameName: string;
  members: PayloadMember[];
  leaderIndex: number;
  /**
   * The captain's acceptance of the privacy notice and the rules.
   *
   * Travelled as part of the payload so the API can record *when* it was given,
   * rather than inferring it from the fact that a registration exists.
   */
  consentGiven: boolean;
  /** That the captain accepted the tournament rules. Re-checked server-side, so
   *  posting a registration by hand cannot skip a step the form enforces. */
  rulesAccepted: boolean;
}

/**
 * Turn a validated draft into the exact shape the API persists. Assumes
 * `validateDraft` reported no errors.
 */
export function toPayload(draft: RegistrationDraft, config: TournamentConfig): RegistrationPayload {
  const game = gameById(config, draft.gameId)!;
  const rules = rosterRulesFor(config, game);

  return {
    tournamentName: config.tournamentName,
    // The name the organisers will actually see and announce.
    teamName: normaliseTeamName(draft.teamName),
    gender: draft.gender as Gender,
    gameId: draft.gameId,
    gameName: game.name,
    members: draft.members.map((member) => {
      const university = universityById(config, member.universityId);
      return {
        fullName: member.fullName.trim(),
        gameTag: member.gameTag.trim(),
        universityId: member.universityId,
        universityName: university?.name ?? "",
        universityRegion: university?.region ?? "Other",
        email: member.email.trim().toLowerCase(),
        studentId: member.studentId.trim(),
        discord: member.discord.trim(),
        phone: normalisePhone(member.phone) ?? member.phone.trim(),
        /* The resolved role, not the raw one. The roster step already displays a
           role coerced to what the organisers allow (see `resolveRole`), so
           sending the raw value would submit something the captain never saw —
           and the API, which is strict about untrusted input, would reject it. */
        role: resolveRole(member, rules),
        emailProof: member.emailProof,
        requirements: config.requirements.map((requirement) => ({
          id: requirement.id,
          label: requirement.label,
          value: (member.requirements[requirement.id] ?? "").trim(),
        })),
      };
    }),
    /* The effective leader, so a one-player roster submits index 0 without the captain
       having had to nominate them — the check above already agreed the roster is valid. */
    leaderIndex: effectiveLeaderIndex(draft, rules) ?? 0,
    consentGiven: draft.consentGiven,
    rulesAccepted: draft.rulesAccepted,
  };
}

/* ------------------------------------------------------------------ */
/* Server side re-validation                                           */
/* ------------------------------------------------------------------ */

export interface ValidatePayloadOptions {
  /**
   * Addresses whose ownership is already established by another means — used by
   * the edit flow, where the captain proved control of the team's inbox and the
   * members' existing addresses were verified when the entry was first created.
   */
  alreadyVerified?: Set<string>;

  /**
   * Checks a signed email proof.
   *
   * Injected rather than imported: the proof is an HMAC, so verifying it needs
   * `node:crypto`, and this module is shared with the browser's form validation.
   * The API passes `verifyProof` from `./otp`; anywhere else it defaults to
   * refusing, which is the safe direction to fail.
   */
  verifyEmail?: (email: string, proof: string) => boolean;
}

/**
 * The API never trusts the browser: it re-runs the same rules against the
 * submitted payload and additionally checks the signed email proofs, which only
 * the server can do. This keeps one definition of "valid registration".
 */
export function validatePayload(
  payload: unknown,
  config: TournamentConfig,
  options: ValidatePayloadOptions = {},
): { ok: true; data: RegistrationPayload } | { ok: false; errors: Record<string, string> } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, errors: { form: "Malformed request body" } };
  }

  const body = payload as Partial<RegistrationPayload>;
  const errors: Record<string, string> = {};

  const rawTeamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const teamName = normaliseTeamName(rawTeamName);
  const policy = { blockedTerms: config.blockedTerms };

  if (teamName.length < TEAM_NAME_MIN || teamName.length > TEAM_NAME_MAX) {
    errors.teamName = "Invalid team name";
  } else {
    const problem = teamNamePolicyError(teamName, policy);
    if (problem) errors.teamName = problem;
  }

  if (config.requireConsent && body.consentGiven !== true) {
    errors.consent = "Consent is required";
  }

  /* The same gate as the form's, enforced here so a hand-made request cannot skip a
     step the UI insists on. Accepting the rules is an assertion the server cannot
     verify independently — it can only record that it was made — but refusing the
     submission without it is what makes the step real rather than decorative. */
  if (body.rulesAccepted !== true) {
    errors.rules = "Please confirm you have read the rulebook and agree to the rules";
  }

  if (!isGender(body.gender)) errors.gender = "Invalid section";

  const game = typeof body.gameId === "string" ? gameById(config, body.gameId) : null;
  if (!game) {
    errors.game = "Invalid game";
  } else if (!isGameAllowedForDivision(config, game.id, body.gender as Gender)) {
    errors.game = "Game is not offered in this section";
  }

  const rules = rosterRulesFor(config, game);
  const alreadyVerified = options.alreadyVerified ?? new Set<string>();
  const verifyEmail = options.verifyEmail ?? (() => false);
  const members = Array.isArray(body.members) ? body.members : [];

  /* Resolved before the roster is checked: only the leader's address needs a proof
     before submission. Everyone else is emailed a confirmation link afterwards and
     starts out pending. */
  /* **The registrant is the leader**, so the submitted index is not consulted:
     accepting one would let a hand-made request hand leadership to a row the form
     no longer offers a way to choose. Position 0 is the leader by construction. */
  const leaderIndex = members.length > 0 ? 0 : null;

  /* Refuse an oversized roster before doing any per-member work, so a hostile body
     with thousands of members costs one comparison rather than thousands of
     validations. */
  if (members.length > Math.max(rules.maxTotal, 1)) {
    return {
      ok: false,
      errors: { ...errors, members: `A roster may have at most ${Math.max(rules.maxTotal, 1)} members` },
    };
  }

  /* The institutions this division may actually pick — the same list the form
     offers. Looking a submitted id up in the full catalogue instead would let a
     hand-made request choose a hidden or women-only institution. */
  const eligibleUniversityIds = new Set(
    selectableUniversities(config, isGender(body.gender) ? body.gender : "male").map(
      (candidate) => candidate.id,
    ),
  );

  if (members.length === 0) {
    errors.members = "A roster needs at least one member";
  } else {
    if (members.length > rules.maxTotal) {
      errors.members = `Roster may hold at most ${rules.maxTotal} people`;
    }

    const seenEmails = new Set<string>();
    const seenIds = new Set<string>();
    const seenTags = new Set<string>();
    const usedUniversities = new Set<string>();
    let starters = 0;
    let substitutes = 0;
    let coaches = 0;

    members.forEach((member, index) => {
      if (!member || typeof member !== "object") {
        errors[`member.${index}`] = "Invalid member";
        return;
      }

      const role: MemberRole = isMemberRole(member.role) ? member.role : "STARTER";
      const isCoach = role === "COACH";
      const isLeader = leaderIndex === index;
      /* The captain enters only a teammate's university and address; the rest is
         completed by that player from their emailed link. Empty is therefore
         legitimate for a non-leader, while any value that is present is still
         checked. */
      const completesOwnDetails = !isLeader;
      if (role === "COACH") coaches += 1;
      else if (role === "SUBSTITUTE") substitutes += 1;
      else starters += 1;

      const name = typeof member.fullName === "string" ? member.fullName.trim() : "";
      if (!name && completesOwnDetails) {
        // Left for the player.
      } else {
        const nameProblem = personNameError(name) ?? personNamePolicyError(name, policy);
        if (nameProblem) errors[`member.${index}.fullName`] = nameProblem;
      }

      const gameTag = typeof member.gameTag === "string" ? member.gameTag.trim() : "";
      if (!gameTag) {
        if (!isCoach && !completesOwnDetails) errors[`member.${index}.gameTag`] = "Invalid game tag";
      } else if (!GAME_TAG_PATTERN.test(gameTag)) {
        errors[`member.${index}.gameTag`] = "Invalid game tag";
      } else if (gameTagPolicyError(gameTag, policy)) {
        errors[`member.${index}.gameTag`] = gameTagPolicyError(gameTag, policy)!;
      } else if (seenTags.has(gameTag.toLowerCase())) {
        errors[`member.${index}.gameTag`] = "Duplicate game tag";
      } else {
        seenTags.add(gameTag.toLowerCase());
      }

      const university =
        typeof member.universityId === "string" ? universityById(config, member.universityId) : null;
      if (!university) {
        /* Optional for coaches: they may have graduated or never studied at one of
           these institutions. A submitted id that does not resolve is still refused,
           so a mistyped or stale id is not silently dropped. */
        if (!isCoach || (typeof member.universityId === "string" && member.universityId.trim())) {
          errors[`member.${index}.university`] = "Invalid university";
        }
      } else {
        usedUniversities.add(university.id);
        if (!regionIsAllowed(config, university.region)) {
          errors[`member.${index}.university`] = "University is outside the allowed provinces";
        } else if (!eligibleUniversityIds.has(university.id)) {
          errors[`member.${index}.university`] = "This university is not available for this section";
        }
      }

      const email = typeof member.email === "string" ? member.email.trim().toLowerCase() : "";
      if (!EMAIL_PATTERN.test(email)) {
        errors[`member.${index}.email`] = "Enter a valid email address";
      } else if (!isCoach && !university) {
        /* No university, no domain to check against — so the address is refused rather than
           accepted unchecked. The browser disables the field until a university is chosen;
           this is the same rule for a request that never went near the browser. Coaches are
           exempt: they may use a personal address instead of a university one. */
        errors[`member.${index}.email`] =
          "Choose the member's university first — the address must be its domain";
      } else if (!isCoach && university && !emailMatchesUniversity(email, university)) {
        /* The server's copy of the same strict rule. The browser already refuses this,
           but the API is reachable without the browser, and a roster that names one
           university must not carry another institution's address. */
        errors[`member.${index}.email`] = `${email} is not a ${university.name} address (expected ${acceptedEmailDomains(university)[0]})`;
      } else if (seenEmails.has(email)) {
        errors[`member.${index}.email`] = "Duplicate email";
      } else {
        seenEmails.add(email);

        /* Only the leader's address is proven before submission. Every other member
           confirms later from the link we email them, and is shown as pending until
           they do — a submission must not wait for that. */
        const verified =
          alreadyVerified.has(email) ||
          (typeof member.emailProof === "string" && verifyEmail(email, member.emailProof));

        if (isLeader && !verified) {
          errors[`member.${index}.email`] = "This email address has not been verified";
        }
      }

      const studentId = typeof member.studentId === "string" ? member.studentId.trim() : "";
      if (!studentId) {
        if (!isCoach && !completesOwnDetails) errors[`member.${index}.studentId`] = "Invalid student ID";
      } else if (!STUDENT_ID_PATTERN.test(studentId)) {
        errors[`member.${index}.studentId`] = "Invalid student ID";
      } else if (seenIds.has(studentId.toLowerCase())) {
        errors[`member.${index}.studentId`] = "Duplicate student ID";
      } else {
        seenIds.add(studentId.toLowerCase());
      }

      const discord = typeof member.discord === "string" ? member.discord.trim() : "";
      if (!discord) {
        if (!completesOwnDetails) errors[`member.${index}.discord`] = "Invalid Discord ID";
      } else if (!DISCORD_PATTERN.test(discord)) {
        errors[`member.${index}.discord`] = "Invalid Discord ID";
      }

      const phone = typeof member.phone === "string" ? member.phone.trim() : "";
      if (!phone) {
        if (!completesOwnDetails) errors[`member.${index}.phone`] = "Invalid phone number";
      } else if (!normalisePhone(phone)) {
        errors[`member.${index}.phone`] = "Invalid phone number";
      }

      // Every configured requirement must be answered, whether or not the
      // browser sent the field at all. A teammate's answers are collected in the
      // completion form, not here.
      const answers = new Map<string, string>(
        (Array.isArray(member.requirements) ? member.requirements : [])
          .filter(
            (answer): answer is { id: string; label: string; value: string } =>
              typeof answer === "object" && answer !== null,
          )
          .map((answer) => [String(answer.id), String(answer.value ?? "")]),
      );

      if (!completesOwnDetails) {
        for (const requirement of config.requirements) {
          const message = requirementError(requirement, answers.get(requirement.id));
          if (message) errors[`member.${index}.req.${requirement.id}`] = message;
        }
      }
    });

    if (!errors.members) {
      if (starters !== rules.starters) {
        errors.members = `The roster must name exactly ${rules.starters} starters`;
      } else if (substitutes > rules.maxSubstitutes) {
        errors.members = `At most ${rules.maxSubstitutes} substitutes are allowed`;
      } else if (coaches > rules.maxCoaches) {
        errors.members = `At most ${rules.maxCoaches} coaches are allowed`;
      }
    }

    if (!config.allowMixedUniversities && usedUniversities.size > 1) {
      errors["members.university"] =
        "All members must come from the same university for this tournament";
    }
  }

  if (
    leaderIndex === null ||
    members.length === 0 ||
    leaderIndex < 0 ||
    leaderIndex >= members.length
  ) {
    errors.leader = "Invalid team leader";
  } else if (members[leaderIndex]?.role === "COACH") {
    errors.leader = "The team leader must be a starter, not a coach";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const typed = members as PayloadMember[];

  return {
    ok: true,
    data: {
      tournamentName: config.tournamentName,
      teamName,
      gender: body.gender as Gender,
      gameId: game!.id,
      gameName: game!.name,
      members: typed.map((member) => {
        const university = universityById(config, String(member.universityId))!;
        return {
          fullName: member.fullName.trim(),
          gameTag: member.gameTag.trim(),
          universityId: university.id,
          universityName: university.name,
          universityRegion: university.region,
          email: member.email.trim().toLowerCase(),
          studentId: member.studentId.trim(),
          discord: member.discord.trim(),
          phone: normalisePhone(member.phone)!,
          role: isMemberRole(member.role) ? member.role : "STARTER",
          emailProof: typeof member.emailProof === "string" ? member.emailProof : "",
          requirements: config.requirements.map((requirement) => {
            const answer = (Array.isArray(member.requirements) ? member.requirements : []).find(
              (entry) => String(entry?.id) === requirement.id,
            );
            return {
              id: requirement.id,
              label: requirement.label,
              value: String(answer?.value ?? "").trim(),
            };
          }),
        };
      }),
      leaderIndex: leaderIndex!,
      consentGiven: body.consentGiven === true,
      rulesAccepted: body.rulesAccepted === true,
    },
  };
}

/* ------------------------------------------------------------------ */
/* A member completing their own details                               */
/* ------------------------------------------------------------------ */

export interface MemberCompletionPayload {
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; label: string; value: string }[];
}

/**
 * The details a player submits from their emailed link.
 *
 * The captain only chose this person's university and address, so everything the
 * roster needs from them personally is gathered here. The rules are the same
 * primitives the public form uses — a name is a name, whichever screen asked for
 * it — but only the fields that belong to the member are checked; the university
 * and address are already fixed and cannot be changed through this link.
 *
 * `role` and `universityId` come from the stored row, never from the request, so
 * a player cannot promote themselves to coach to skip the student number, or move
 * themselves to another institution.
 */
export function validateMemberCompletion(
  input: unknown,
  config: TournamentConfig,
  options: { role: MemberRole },
): { ok: true; data: MemberCompletionPayload } | { ok: false; errors: Record<string, string> } {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const policy = { blockedTerms: config.blockedTerms };
  const isCoach = options.role === "COACH";

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const nameProblem = personNameError(fullName) ?? personNamePolicyError(fullName, policy);
  if (nameProblem) errors.fullName = nameProblem;

  const gameTag = typeof body.gameTag === "string" ? body.gameTag.trim() : "";
  if (!gameTag) {
    if (!isCoach) errors.gameTag = "Required";
  } else if (!GAME_TAG_PATTERN.test(gameTag)) {
    errors.gameTag = "2–32 characters — letters, numbers, dots, dashes or #";
  } else if (gameTagPolicyError(gameTag, policy)) {
    errors.gameTag = gameTagPolicyError(gameTag, policy)!;
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) {
    if (!isCoach) errors.studentId = "Required";
  } else if (!STUDENT_ID_PATTERN.test(studentId)) {
    errors.studentId = "4–20 numbers";
  }

  const discord = typeof body.discord === "string" ? body.discord.trim() : "";
  if (!discord) errors.discord = "Required";
  else if (!DISCORD_PATTERN.test(discord)) {
    errors.discord = "2–32 characters — letters, numbers, dots or underscores";
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!phone) errors.phone = "Required";
  else if (!normalisePhone(phone)) {
    errors.phone = "Enter a Saudi mobile, e.g. 05X XXX XXXX";
  }

  const provided = Array.isArray(body.requirements) ? body.requirements : [];
  const answers = new Map<string, string>();
  for (const entry of provided) {
    if (typeof entry !== "object" || entry === null) continue;
    const answer = entry as { id?: unknown; value?: unknown };
    if (typeof answer.id !== "string") continue;
    answers.set(answer.id, answer.value === null || answer.value === undefined ? "" : String(answer.value));
  }

  const requirements = config.requirements.map((requirement) => {
    const value = (answers.get(requirement.id) ?? "").trim();
    const message = requirementError(requirement, value);
    if (message) errors[`req.${requirement.id}`] = message;
    return { id: requirement.id, label: requirement.label, value };
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      fullName,
      gameTag,
      studentId,
      discord,
      phone: normalisePhone(phone)!,
      requirements,
    },
  };
}
