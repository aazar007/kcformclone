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
import {
  UNIVERSITIES,
  acceptedEmailDomains,
  emailDomainOf,
  emailMatchesUniversity,
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
      /* Held back until the address looks finished — an "@" with a dot after it.
         Until then every prefix of a valid address is invalid, and flagging each
         keystroke would train the captain to ignore the field. */
      const at = value.lastIndexOf("@");
      if (at === -1 || !value.slice(at + 1).includes(".")) return false;
      if (!EMAIL_PATTERN.test(value)) return true;

      /* No university is in hand here, so this can only answer "is this a domain any
         university in the list uses?". That is still worth saying at once: a typed
         `@gmail.com` is wrong whatever is selected, and waiting for the step to be
         submitted to mention it wastes the moment the captain is looking at the field.
         The *per-university* answer needs the selection and lives in `validateDraft`. */
      const domain = emailDomainOf(value);
      return !UNIVERSITIES.some((university) =>
        acceptedEmailDomains(university).some(
          (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
        ),
      );
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
 * the member proved they own, and the signed receipt the API checks. Editing the
 * address afterwards invalidates both, so verification cannot be borrowed from
 * one member by another.
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
  { id: "team", title: "Team", blurb: "Name your squad and pick your division" },
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
 * Who the team leader is, once leadership has been decided.
 *
 * **When only one member can lead, that member leads — the question is not asked.**
 * A 1v1 title fields a one-person roster, and making a captain tick a "team leader"
 * box on the only row there is asks them to confirm a fact that has no alternative.
 * It also went wrong in practice: choosing a 1v1 game rebuilds the roster, the old
 * `leaderIndex` is dropped because it points past the end of the new one, and the
 * captain is then blocked by "Select a team leader" on a team of one, with a
 * checkbox on the *same row* being the only way out.
 *
 * Coaches are excluded because a coach cannot lead — `validateDraft` already refuses
 * that, so counting them as candidates would invent a choice that is not allowed.
 *
 * Returns null when the roster holds nobody eligible, so the caller still reports
 * "select a leader" rather than silently nominating an empty row.
 */
export function effectiveLeaderIndex(
  draft: Pick<RegistrationDraft, "members" | "leaderIndex">,
  rules: RosterRules,
): number | null {
  const eligible: number[] = [];
  draft.members.forEach((member, index) => {
    if (resolveRole(member, rules) !== "COACH") eligible.push(index);
  });

  /* Exactly one candidate: leadership is automatic, and it overrides whatever the
     draft happens to hold — including a value that survived a roster resize. */
  if (eligible.length === 1) return eligible[0];
  if (eligible.length === 0) return null;

  /* Several candidates: the captain's choice stands, but only if it still points at
     somebody who can lead. A stale index after a removal must not silently nominate
     a coach. */
  const chosen = draft.leaderIndex;
  if (chosen !== null && eligible.includes(chosen)) return chosen;
  return null;
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

  if (!draft.gender) errors.gender = "Choose your division";

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
    } division`;
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

  draft.members.forEach((member, index) => {
    const prefix = `member.${index}`;
    const isCoach = resolveRole(member, rules) === "COACH";

    /* -- name -- */
    const name = member.fullName.trim();
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

    /* -- in-game tag (coaches do not play, so they need none) -- */
    const gameTag = member.gameTag.trim();
    if (!gameTag) {
      if (!isCoach) errors[`${prefix}.gameTag`] = "Required";
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

    /* -- university (per member — a roster may mix institutions) -- */
    const chosen = universities.find((university) => university.id === member.universityId);
    if (!member.universityId) {
      errors[`${prefix}.university`] = "Select this member's university";
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

    /* -- university email, verified by OTP -- */
    const email = member.email.trim();
    if (!email) {
      errors[`${prefix}.email`] = "Required";
    } else if (!EMAIL_PATTERN.test(email)) {
      errors[`${prefix}.email`] = "Enter a valid email address";
    } else if (chosen && !emailMatchesUniversity(email, chosen)) {
      /* Before the verification check, deliberately. The other order told a captain to
         verify an address that could never be accepted — which sends a real code to the
         wrong mailbox and only then refuses the entry, at the end of the form. Saying it
         now costs one message instead of an email and a wasted trip. */
      errors[`${prefix}.email`] = `${email} is not a ${chosen.name} address (expected ${acceptedEmailDomains(chosen)[0]})`;
    } else if (member.verifiedEmail.trim().toLowerCase() !== email.toLowerCase()) {
      // The client only tracks *which* address was acknowledged; the signed proof
      // is checked by the API. Editing the address un-acknowledges it.
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
      if (!isCoach) errors[`${prefix}.studentId`] = "Required";
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
    if (!discord) errors[`${prefix}.discord`] = "Required";
    else if (!DISCORD_PATTERN.test(discord)) {
      errors[`${prefix}.discord`] = "2–32 characters — letters, numbers, dots or underscores";
    }

    const phone = member.phone.trim();
    if (!phone) errors[`${prefix}.phone`] = "Required";
    else if (!normalisePhone(phone)) {
      errors[`${prefix}.phone`] = "Enter a Saudi mobile, e.g. 05X XXX XXXX";
    }

    /* -- organiser-defined requirements -- */
    for (const requirement of config.requirements) {
      const message = requirementError(requirement, member.requirements[requirement.id]);
      if (message) errors[`${prefix}.req.${requirement.id}`] = message;
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
     tick is how a 1v1 team got stuck. */
  const leaderIndex = effectiveLeaderIndex(draft, rules);
  const leaderValid =
    leaderIndex !== null &&
    leaderIndex >= 0 &&
    leaderIndex < draft.members.length &&
    draft.members[leaderIndex].fullName.trim().length > 0;

  if (!leaderValid) {
    errors.leader = draft.members.some((member) => member.fullName.trim())
      ? "Select a team leader"
      : "Add your members' names first";
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

  if (!isGender(body.gender)) errors.gender = "Invalid division";

  const game = typeof body.gameId === "string" ? gameById(config, body.gameId) : null;
  if (!game) {
    errors.game = "Invalid game";
  } else if (!isGameAllowedForDivision(config, game.id, body.gender as Gender)) {
    errors.game = "Game is not offered in this division";
  }

  const rules = rosterRulesFor(config, game);
  const alreadyVerified = options.alreadyVerified ?? new Set<string>();
  const verifyEmail = options.verifyEmail ?? (() => false);
  const members = Array.isArray(body.members) ? body.members : [];

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
      if (role === "COACH") coaches += 1;
      else if (role === "SUBSTITUTE") substitutes += 1;
      else starters += 1;

      const name = typeof member.fullName === "string" ? member.fullName.trim() : "";
      const nameProblem = personNameError(name) ?? personNamePolicyError(name, policy);
      if (nameProblem) errors[`member.${index}.fullName`] = nameProblem;

      const gameTag = typeof member.gameTag === "string" ? member.gameTag.trim() : "";
      if (!gameTag) {
        if (!isCoach) errors[`member.${index}.gameTag`] = "Invalid game tag";
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
        errors[`member.${index}.university`] = "Invalid university";
      } else {
        usedUniversities.add(university.id);
        if (!regionIsAllowed(config, university.region)) {
          errors[`member.${index}.university`] = "University is outside the allowed provinces";
        } else if (!eligibleUniversityIds.has(university.id)) {
          errors[`member.${index}.university`] = "This university is not available for this division";
        }
      }

      const email = typeof member.email === "string" ? member.email.trim().toLowerCase() : "";
      if (!EMAIL_PATTERN.test(email)) {
        errors[`member.${index}.email`] = "Enter a valid email address";
      } else if (university && !emailMatchesUniversity(email, university)) {
        /* The server's copy of the same strict rule. The browser already refuses this,
           but the API is reachable without the browser, and a roster that names one
           university must not carry another institution's address. */
        errors[`member.${index}.email`] = `${email} is not a ${university.name} address (expected ${acceptedEmailDomains(university)[0]})`;
      } else if (seenEmails.has(email)) {
        errors[`member.${index}.email`] = "Duplicate email";
      } else {
        seenEmails.add(email);

        // The address must be backed by a proof this server issued.
        const verified =
          alreadyVerified.has(email) ||
          (typeof member.emailProof === "string" && verifyEmail(email, member.emailProof));

        if (!verified) {
          errors[`member.${index}.email`] = "This email address has not been verified";
        }
      }

      const studentId = typeof member.studentId === "string" ? member.studentId.trim() : "";
      if (!studentId) {
        if (!isCoach) errors[`member.${index}.studentId`] = "Invalid student ID";
      } else if (!STUDENT_ID_PATTERN.test(studentId)) {
        errors[`member.${index}.studentId`] = "Invalid student ID";
      } else if (seenIds.has(studentId.toLowerCase())) {
        errors[`member.${index}.studentId`] = "Duplicate student ID";
      } else {
        seenIds.add(studentId.toLowerCase());
      }

      const discord = typeof member.discord === "string" ? member.discord.trim() : "";
      if (!DISCORD_PATTERN.test(discord)) errors[`member.${index}.discord`] = "Invalid Discord ID";

      const phone = typeof member.phone === "string" ? member.phone.trim() : "";
      if (!normalisePhone(phone)) errors[`member.${index}.phone`] = "Invalid phone number";

      // Every configured requirement must be answered, whether or not the
      // browser sent the field at all.
      const answers = new Map<string, string>(
        (Array.isArray(member.requirements) ? member.requirements : [])
          .filter(
            (answer): answer is { id: string; label: string; value: string } =>
              typeof answer === "object" && answer !== null,
          )
          .map((answer) => [String(answer.id), String(answer.value ?? "")]),
      );

      for (const requirement of config.requirements) {
        const message = requirementError(requirement, answers.get(requirement.id));
        if (message) errors[`member.${index}.req.${requirement.id}`] = message;
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

  const leaderIndex =
    typeof body.leaderIndex === "number" && Number.isInteger(body.leaderIndex)
      ? body.leaderIndex
      : null;

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
