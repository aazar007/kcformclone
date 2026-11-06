/**
 * Rules that are easy to get subtly wrong, checked without a database.
 *
 *   npm test
 *
 * Nothing here touches PostgreSQL or the network: these are the pure functions
 * that decide what a valid team is — team-name normalisation, role and roster
 * limits, province filtering, one-time passcodes, image sizes and the shape of
 * an exported row. The project has no test framework, and pulling one in for
 * this would cost more than it saves.
 */

import { normaliseTeamName, needsTeamPrefix, teamNameKey } from "../src/lib/team-name";
import { DEFAULT_TOURNAMENT, MAX_WATCH_LINKS, normaliseConfig, rosterRulesFor, selectableUniversities, type GameDefinition } from "../src/lib/tournament";
import { SAUDI_REGIONS, regionLabel } from "../src/lib/regions";
import { validateDraft, validatePayload, validateMemberCompletion, toPayload, personNameError, fieldStep, isStepValid, revealsImmediately, STEP_COUNT, STUDENT_ID_PATTERN, STUDENT_ID_MIN, STUDENT_ID_MAX, effectiveLeaderIndex, EMPTY_DRAFT, studentIdFromEmail, studentIdPreviewFromEmail, studentIdAfterEdit, type RegistrationDraft, emptyMember } from "../src/lib/validation";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasArabicMessage, requestedLanguage, DEFAULT_LANGUAGE, roleLabelKey, sponsorRoleLabel, arabicDigits, digitsOnly, toWesternDigits, t, EN, AR, translateMessage, type MessageKey } from "../src/lib/i18n";
import { totalPrizePool } from "../src/lib/prize-total";

import { applyDraftProfiles, withCompletionReceipts } from "../src/lib/draft-merge";
import { makeReference, REFERENCE_PREFIX, REFERENCE_RANDOM_LENGTH } from "../src/lib/utils";
import { accessRoleFor, mayEditPositions, maySeeRoster, parseProofScope, proofScope } from "../src/lib/team-access";
import { findBlockedTerm, gameTagPolicyError, moderate as moderateText, nameWarnings, personNamePolicyError, teamNamePolicyError } from "../src/lib/name-policy";
import { UNIVERSITIES, acceptedEmailDomains, emailMatchesUniversity } from "../src/lib/universities";
import { isDatabaseUnavailable } from "../src/lib/db";
import { readImageSize } from "../src/lib/image";
import { makeProof, makeSkipProof, verifyProof, hashCode, generateCode, otpConfigured, safeEqual, OTP_MAX_ATTEMPTS } from "../src/lib/otp";
import { plainText, teamToPlayerRows } from "../src/lib/sheet-export";
import { buildConfirmationEmail } from "../src/lib/confirmation-email";
import { renderOtpEmail } from "../src/lib/mailer";
import { maskEmail, stripTeamPrefix, teamToDraft, teamVerifiedEmails } from "../src/lib/team-draft";
import { appBaseUrl, appUrl } from "../src/lib/app-url";
import { decodePng, downscale, encodePng, shrinkPng } from "../src/lib/png";
import { validateAdminTeamEdit } from "../src/lib/admin-edit";
import { channelSettings, escapeHtml, fromAddress, mailerConfigured } from "../src/lib/mailer";
import type { StoredTeam } from "../src/lib/store";
import { DEFAULT_PRIVACY_NOTICE, DEFAULT_PRIVACY_NOTICE_AR } from "../src/lib/privacy-notice";
import { adminPath, staffPath } from "../src/lib/admin-path";
import { callerAddress } from "../src/lib/rate-limit";
import { LOCKED_OUT_MESSAGE, SESSION_COOKIE, adminEmail, adminEmails, adminLogin, adminSecretIsHashed, checkAdminSecret, createAdminSession, createStaffSession, hasAdminSession, hashAdminSecret, isAdminEmail } from "../src/lib/admin-auth";
import {
  hashCredential,
  hashCredentialAsync,
  isCredentialHash,
  isPasswordStrong,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  verifyCredential,
} from "../src/lib/admin-credential";
import { looksLikeSheetUrl, sheetUrl } from "../src/lib/sheets";

let failures = 0;

/** Strip comments so prose in a comment cannot look like UI copy.
 *
 * The braced JSX form goes first. Removing `/* … *\/` before `{/* … *\/}` leaves an
 * empty `{}` where the comment was, and that brace pair then hides the text node
 * after it from every pattern that scans component sources: the pattern reaches
 * back for a `>` and finds `{`. Found by planting a comment above the literal a
 * regression test was checking for — the test passed when it should have failed. */
const stripComments = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** Remove `${…}` from a template literal, counting braces, so a nested
 *  `{ count: n }` inside an interpolation is removed with it. */
function stripInterpolations(raw: string) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth += 1;
        else if (raw[j] === "}") depth -= 1;
        j += 1;
      }
      out += " ";
      i = j - 1;
    } else {
      out += raw[i];
    }
  }
  return out;
}

/**
 * Whether a template literal is English written by hand rather than a dictionary key,
 * a class name, a path or an error-key builder.
 *
 * Two English words separated by whitespace in the *literal* text — interpolations
 * removed first, so `` ` · ${counts.coaches} ` `` (a translated breakdown) is not
 * prose while `` `Saved as ${phone}` `` is.
 */
function isHandWrittenSentence(literal: string) {
  const bare = stripInterpolations(literal).replace(/\s+/g, " ").trim();
  return /[A-Za-z]{2,}[^A-Za-z0-9_/@.$-]*\s+[A-Za-z]{2,}/.test(bare);
}

/**
 * A count glued to an English role word: `` `${counts.starters} starter${…}` ``.
 *
 * The review step built its breakdown this way, so the Arabic review screen read
 * "1 أساسي · 2 substitutes · 1 coach". It is the one shape the rule above cannot
 * catch, because the plural `s` is a second interpolation and no two words are ever
 * adjacent. Listing the words is deliberate: a general "any English word next to an
 * interpolation" rule flags `member.${index}.fullName` and
 * `linear-gradient(90deg, ${from}, ${to})`, and a scan that cries wolf gets muted.
 */
const COUNT_WORD = /\$\{[^{}]*\}\s*(?:starters?|substitutes?|coaches?|players?|members?)\b/i;

function hasCountedEnglishWord(literal: string) {
  return COUNT_WORD.test(literal);
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✖"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`);
}

/**
 * The checks themselves.
 *
 * Wrapped in one async function because the library is async: every setting is read through
 * `getEnv()`, which is a promise so the same code works on Cloudflare Workers (where the
 * Worker's variables only exist per request) and on Node. Compiled as CommonJS, this file
 * cannot use top-level `await`, so the body lives here and the awaits are ordinary ones.
 */
async function runChecks() {

console.log("\n── Team name normalisation ──");
check("adds Team to a bare name", normaliseTeamName("Falcons"), "Team Falcons");
check("keeps an existing Team prefix", normaliseTeamName("Team Falcons"), "Team Falcons");
check("canonicalises casing of prefix", normaliseTeamName("team falcons"), "Team falcons");
check("does not double up mid-name", normaliseTeamName("Blue Team"), "Blue Team");
check("collapses whitespace", normaliseTeamName("  Red    Foxes  "), "Team Red Foxes");
check("empty stays empty", normaliseTeamName("   "), "");
check("needsTeamPrefix true for bare", needsTeamPrefix("Falcons"), true);
check("needsTeamPrefix false when present", needsTeamPrefix("Blue Team"), false);
check("key is case-insensitive", teamNameKey("FALCONS"), "team falcons");
check("key collides across phrasings", teamNameKey("team falcons") === teamNameKey("Team Falcons"), true);

console.log("\n── Roster rules (per game) ──");
const config = normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 8 });
const game = (over: Partial<GameDefinition>) => ({
  squadSize: 5,
  maxSubstitutes: 2,
  maxCoaches: 2,
  ...over,
});

const rules = rosterRulesFor(config, game({}));
check("5v5 needs 5 starters", rules.starters, 5);
check("substitutes come from the game", rules.maxSubstitutes, 2);
check("coaches come from the game", rules.maxCoaches, 2);
/* 5 starters + 2 substitutes + 2 coaches. *Not* `maxRoster + coaches`: the game
   declares a two-man bench, so the tournament's eight-player ceiling is unreachable and
   counting it would advertise two roster slots that can never be filled. */
check("maxTotal = starters + bench + coaches", rules.maxTotal, 9);
check("maxPlayers = starters + bench", rules.maxPlayers, 7);

const noSubs = rosterRulesFor(config, game({ maxSubstitutes: 0 }));
check("a game with no bench allows none", noSubs.maxSubstitutes, 0);
check("starters are unaffected", noSubs.starters, 5);
check("no bench means players = starters", noSubs.maxPlayers, 5);

/*
 * The reported bug, as a rule: a 1v1 title has a one-person roster.
 *
 * The player cap used to be `max(starters, config.maxRoster)`, so EA FC showed
 * "1 / 6" on the review step and the roster step offered five substitutes for a game
 * with no bench. The tournament's roster cap is a ceiling on what a game may allow, never
 * an allowance of its own.
 */
const oneVsOne = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 6 }),
  game({ squadSize: 1, maxSubstitutes: 0, maxCoaches: 0 }),
);
check("a 1v1 title is a one-player roster", oneVsOne.maxPlayers, 1);
check("…and one row in total", oneVsOne.maxTotal, 1);
check("a 1v1 title cannot advertise a bench", oneVsOne.maxSubstitutes, 0);

/* The bench follows the game, not the tournament cap: two titles under the same config
   answered the same before and must not now. */
const fiveAside = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 6 }),
  game({ squadSize: 3, maxSubstitutes: 2, maxCoaches: 1 }),
);
const fullFive = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 6 }),
  game({ squadSize: 5, maxSubstitutes: 2, maxCoaches: 2 }),
);
check("one config, two games, two different rosters",
  [fiveAside.maxPlayers, fullFive.maxPlayers], [5, 6]);

const noCoaches = rosterRulesFor(config, game({ maxCoaches: 0 }));
check("a game with no coaches allows none", noCoaches.maxCoaches, 0);

// Default maxRoster is 6, so the playing-squad cap still applies. Coaches are
// excluded here so the assertion is purely about the player cap.
const capped = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT }),
  game({ squadSize: 5, maxSubstitutes: 2, maxCoaches: 0 }),
);
check("roster cap limits substitutes", capped.maxSubstitutes, 1);
check("maxPlayers is the playing-squad cap", capped.maxPlayers, 6);
check("maxTotal equals maxPlayers with no coaches", capped.maxTotal, 6);

const onlyStarters = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 5 }),
  game({ squadSize: 5, maxSubstitutes: 2, maxCoaches: 0 }),
);
check("no room for a bench when the cap equals the squad", onlyStarters.maxSubstitutes, 0);
check("maxTotal is starters only", onlyStarters.maxTotal, 5);

// Coaches sit on top of the playing squad, which is what makes them staff.
const withCoaches = rosterRulesFor(
  normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 5 }),
  game({ squadSize: 5, maxSubstitutes: 2, maxCoaches: 2 }),
);
check("coaches add to the roster beyond the players", withCoaches.maxTotal, 7);

console.log("\n── Per-game settings survive normalisation ──");
const perGame = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  games: [
    { id: "a", name: "A", format: "1v1", squadSize: 1, maxSubstitutes: 0, maxCoaches: 3, divisions: ["male"] },
    { id: "b", name: "B", format: "5v5", squadSize: 5, maxSubstitutes: 4, maxCoaches: 0, divisions: ["male"] },
  ],
});
check("game A keeps no substitutes", perGame.games[0].maxSubstitutes, 0);
check("game A keeps 3 coaches", perGame.games[0].maxCoaches, 3);
check("game B keeps 4 substitutes", perGame.games[1].maxSubstitutes, 4);
check("game B keeps no coaches", perGame.games[1].maxCoaches, 0);

// A config saved before roles moved per game still carries the old global fields.
const legacy = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  allowSubstitutes: true,
  maxSubstitutes: 3,
  allowCoaches: true,
  maxCoaches: 1,
  games: [{ id: "old", name: "Old", format: "5v5", squadSize: 5, divisions: ["male"] }],
});
check("legacy substitute limit is carried into each game", legacy.games[0].maxSubstitutes, 3);
check("legacy coach limit is carried into each game", legacy.games[0].maxCoaches, 1);

const legacyOff = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  allowSubstitutes: false,
  maxSubstitutes: 4,
  allowCoaches: false,
  maxCoaches: 2,
  games: [{ id: "old", name: "Old", format: "5v5", squadSize: 5, divisions: ["male"] }],
});
check("legacy 'substitutes off' becomes 0", legacyOff.games[0].maxSubstitutes, 0);
check("legacy 'coaches off' becomes 0", legacyOff.games[0].maxCoaches, 0);

console.log("\n── Conduct and privacy settings survive normalisation ──");
/* These are edited in the organiser console and read back by the public form, so
   a config save that silently dropped them would quietly switch the rules off. */
const conduct = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  blockedTerms: ["rivals", "  bannedword  ", "rIVals", ""],
  requireConsent: false,
  policyUrl: "/our-privacy",
});
check("the consent requirement is kept", conduct.requireConsent, false);
check("a custom privacy link is kept", conduct.policyUrl, "/our-privacy");
check("terms keep their order and are de-duplicated case-insensitively", conduct.blockedTerms, [
  "rivals",
  "bannedword",
]);
check("blank terms are dropped", conduct.blockedTerms.includes(""), false);

// Absent fields must land on the documented defaults rather than the empty value.
const conductDefaults = normaliseConfig({ ...DEFAULT_TOURNAMENT });
check("consent defaults to required", conductDefaults.requireConsent, true);
check("the privacy link defaults to the built-in notice", conductDefaults.policyUrl, "/privacy");
check("there are no extra blocked terms by default", conductDefaults.blockedTerms, []);

// Oversized input is clamped rather than rejected, so a bad paste cannot break the form.
const flood = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  blockedTerms: Array.from({ length: 400 }, (_, i) => `term${i}`.padEnd(80, "x")),
});
check("blocked terms are capped at 200", flood.blockedTerms.length, 200);
check("each blocked term is capped at 40 characters", flood.blockedTerms[0].length, 40);

// An organiser-added term is actually enforced end to end.
check(
  "an organiser-added term blocks a team name",
  typeof teamNamePolicyError("Team Rivals", { blockedTerms: conduct.blockedTerms }),
  "string",
);

console.log("\n── Provinces hide universities ──");
const riyadhOnly = normaliseConfig({ ...DEFAULT_TOURNAMENT, allowedRegions: ["Riyadh"] });
const visible = selectableUniversities(riyadhOnly, "male");
check("only Riyadh institutions remain", visible.every((u) => u.region === "Riyadh"), true);
check("fewer than the full list", visible.length < selectableUniversities(DEFAULT_TOURNAMENT, "male").length, true);
check("closed province yields none", selectableUniversities(normaliseConfig({ ...DEFAULT_TOURNAMENT, allowedRegions: ["Jazan"] }), "male").length > 0, true);
const empty = selectableUniversities(normaliseConfig({ ...DEFAULT_TOURNAMENT, allowedRegions: ["Riyadh"] }), "female").length;
console.log(`  (Riyadh + female: ${empty} institutions)`);

console.log("\n── Draft validation with roles ──");
function draft(members: Partial<ReturnType<typeof emptyMember>>[], overrides: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    teamName: "Falcons",
    gender: "male",
    gameId: "overwatch-2",
    members: members.map((m) => ({ ...emptyMember(), ...m })),
    leaderIndex: 0,
    // Consent is required by default, so tests opt in unless they say otherwise.
    consentGiven: true,
    /* Opted in by default, because the rules acknowledgement is required
       unconditionally — a test about something else should not trip over it. */
    rulesAccepted: true,
    ...overrides,
  };
}

/* KSU students hold `@student.ksu.edu.sa`; since the domain rule became strict to each
   university, an `@ksu.edu.sa` address in a fixture is a validation error, not noise. */
const verified = { email: "a@student.ksu.edu.sa", verifiedEmail: "a@student.ksu.edu.sa", studentId: "1234", gameTag: "A#1", universityId: "ksu", fullName: "Ali Hassan", discord: "ali", phone: "0512345678" };

const fiveStarters = draft(Array.from({ length: 5 }, () => ({ ...verified })));
// All five share one email → duplicate errors, but the starter count should be satisfied.
const onlyCount = validateDraft(fiveStarters, config);
check("5 starters satisfies the count", onlyCount.errors.members, undefined);

const fourStarters = draft(Array.from({ length: 4 }, () => ({ ...verified })));
check("4 starters is rejected", typeof validateDraft(fourStarters, config).errors.members, "string");

const withThreeSubs = draft([
  ...Array.from({ length: 5 }, () => ({ ...verified })),
  ...Array.from({ length: 3 }, () => ({ ...verified, role: "SUBSTITUTE" as const })),
]);
check("5 + 3 subs rejected when the game allows 2", typeof validateDraft(withThreeSubs, config).errors.members, "string");

// Raise the game's own allowance and the same draft becomes legal.
const roomy = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  maxRoster: 10,
  games: DEFAULT_TOURNAMENT.games.map((g) =>
    g.id === "overwatch-2" ? { ...g, maxSubstitutes: 4, maxCoaches: 2 } : g,
  ),
});
check("5 + 3 subs accepted when the game allows 4", validateDraft(withThreeSubs, roomy).errors.members, undefined);

const withFourSubs = draft([
  ...Array.from({ length: 5 }, () => ({ ...verified })),
  ...Array.from({ length: 4 }, () => ({ ...verified, role: "SUBSTITUTE" as const })),
]);
check("5 + 4 subs accepted when the game allows 4", validateDraft(withFourSubs, roomy).errors.members, undefined);

// One more than the game allows is what gets refused.
const withFiveSubs = draft([
  ...Array.from({ length: 5 }, () => ({ ...verified })),
  ...Array.from({ length: 5 }, () => ({ ...verified, role: "SUBSTITUTE" as const })),
]);
check("5 + 5 subs rejected when the game allows 4", typeof validateDraft(withFiveSubs, roomy).errors.members, "string");

const coachDraft = draft([
  ...Array.from({ length: 5 }, () => ({ ...verified })),
  { ...verified, role: "COACH" as const, gameTag: "", studentId: "" },
]);
const coachResult = validateDraft(coachDraft, config);
check("coach needs no game tag", coachResult.errors["member.5.gameTag"], undefined);
check("coach needs no student ID", coachResult.errors["member.5.studentId"], undefined);

/* A game the organisers have since closed to coaches. A draft saved before that
   change still marks someone as a coach. */
const coachesClosed = normaliseConfig({
  ...DEFAULT_TOURNAMENT,
  games: DEFAULT_TOURNAMENT.games.map((g) =>
    g.id === "overwatch-2" ? { ...g, maxCoaches: 0 } : g,
  ),
});
const coachWhenClosed = validateDraft(
  draft([...Array.from({ length: 5 }, () => ({ ...verified })), { ...verified, role: "COACH" as const }]),
  coachesClosed,
);
// A stale coach is downgraded to a substitute rather than blocking the form…
check("stale coach does not block the draft", coachWhenClosed.errors.members, undefined);
// …and the payload must carry that resolved role, not the raw one, or the API
// (which is strict about untrusted input) would reject what the form accepted.
const coachPayload = toPayload(
  draft([...Array.from({ length: 5 }, () => ({ ...verified })), { ...verified, role: "COACH" as const }]),
  coachesClosed,
);
check("payload downgrades a stale coach", coachPayload.members[5].role, "SUBSTITUTE");

const withCoachesOff = draft([
  ...Array.from({ length: 5 }, () => ({ ...verified })),
  { ...verified, role: "COACH" as const },
]);
check(
  "coach kept when the organisers allow it",
  toPayload(withCoachesOff, config).members[5].role,
  "COACH",
);

const withoutVerification = draft(
  Array.from({ length: 5 }, () => ({ ...verified, verifiedEmail: "" })),
);
check("unverified email blocks the draft", typeof validateDraft(withoutVerification, config).errors["member.0.email"], "string");

// The automatic "Team" prefix means a one-letter name still clears the minimum.
check("one-letter name clears the minimum", validateDraft(draft([{ ...verified }], { teamName: "A" }), config).errors.teamName, undefined);
check("empty name rejected", typeof validateDraft(draft([{ ...verified }], { teamName: "" }), config).errors.teamName, "string");

console.log("\n── Person names ──");
check("given + family name accepted", personNameError("Ali Hassan"), null);
check("three parts accepted", personNameError("Ali Mohammed Hassan"), null);
check("Arabic accepted", personNameError("عبدالله محمد"), null);
check("hyphen accepted", personNameError("Jean-Luc Picard"), null);
check("apostrophe accepted", personNameError("O'Brien Smith"), null);
check("curly apostrophe accepted", personNameError("O’Brien Smith"), null);
check("initials accepted", personNameError("Mohd. A. Ali"), null);
check("extra spaces collapse", personNameError("  Ali   Hassan  "), null);

check("digits rejected", typeof personNameError("Ali 123"), "string");
check("all digits rejected", typeof personNameError("12345"), "string");
check("symbols rejected", typeof personNameError("Ali!"), "string");
check("emoji rejected", typeof personNameError("Ali 😀"), "string");
check("single word rejected", typeof personNameError("Ali"), "string");
check("nickname-like token rejected", typeof personNameError("asdf"), "string");
check("too short rejected", typeof personNameError("Ab"), "string");
check("empty rejected", typeof personNameError("   "), "string");
check("trailing punctuation rejected", typeof personNameError("Ali-"), "string");
check("too long rejected", typeof personNameError("Ali ".repeat(30) + "Hassan"), "string");

// The same person twice is suspicious, not impossible — so it warns.
const sharedName = validateDraft(
  draft([
    { ...verified },
    { ...verified, email: "b@ksu.edu.sa", verifiedEmail: "b@ksu.edu.sa", studentId: "9999", gameTag: "B#1" },
  ]),
  config,
);
check(
  "two members sharing a name warn",
  sharedName.warnings.some((warning) => /same name/i.test(warning)),
  true,
);

const distinctNames = validateDraft(
  draft([
    { ...verified },
    { ...verified, fullName: "Omar Salem", email: "b@ksu.edu.sa", verifiedEmail: "b@ksu.edu.sa", studentId: "9999", gameTag: "B#1" },
  ]),
  config,
);
check(
  "distinct names do not warn",
  distinctNames.warnings.some((warning) => /same name/i.test(warning)),
  false,
);

const numericName = validateDraft(draft([{ ...verified, fullName: "1234" }]), config);
check("a numeric name is rejected by the draft", typeof numericName.errors["member.0.fullName"], "string");

console.log("\n── Teammates complete their own details ──");
/* A non-leader row is deliberately incomplete: the captain chose only the role,
   university and address. Everything personal is supplied from the emailed link. */
const teammateRow = {
  role: "STARTER" as const,
  universityId: "ksu",
  email: "b@student.ksu.edu.sa",
  verifiedEmail: "",
};
const withTeammate = validateDraft(draft([{ ...verified }, teammateRow]), config);
check("a teammate needs no name", withTeammate.errors["member.1.fullName"], undefined);
check("a teammate needs no game tag", withTeammate.errors["member.1.gameTag"], undefined);
check("a teammate needs no student ID", withTeammate.errors["member.1.studentId"], undefined);
check("a teammate needs no Discord", withTeammate.errors["member.1.discord"], undefined);
check("a teammate needs no phone", withTeammate.errors["member.1.phone"], undefined);

const leaderWithoutName = validateDraft(draft([{ ...verified, fullName: "" }]), config);
check("the leader still needs a name", typeof leaderWithoutName.errors["member.0.fullName"], "string");

const teammateNoUniversity = validateDraft(
  draft([{ ...verified }, { ...teammateRow, universityId: "" }]),
  config,
);
check("a teammate still needs a university", typeof teammateNoUniversity.errors["member.1.university"], "string");

const teammateWrongDomain = validateDraft(
  draft([{ ...verified }, { ...teammateRow, email: "b@gmail.com" }]),
  config,
);
check(
  "a teammate's address still has to match the university",
  typeof teammateWrongDomain.errors["member.1.email"],
  "string",
);

const completeProfile = validateMemberCompletion(
  {
    fullName: "Omar Salem",
    gameTag: "Omar#2",
    studentId: "445100002",
    discord: "omar",
    phone: "0512345679",
    requirements: [],
  },
  config,
  { role: "STARTER" },
);
check("a complete player profile validates", completeProfile.ok, true);
check(
  "an empty profile is refused",
  validateMemberCompletion({}, config, { role: "STARTER" }).ok,
  false,
);
console.log("\n── Reference codes and role scopes ──");
const referenceSample = makeReference();
check("the reference carries the ESC-26 prefix", referenceSample.startsWith(`${REFERENCE_PREFIX}-`), true);
check(
  "the reference has seven random characters",
  referenceSample.slice(REFERENCE_PREFIX.length + 1).length,
  REFERENCE_RANDOM_LENGTH,
);
check("the reference avoids the ambiguous characters", /^[A-HJ-NP-Z2-9]{7}$/.test(referenceSample.slice(REFERENCE_PREFIX.length + 1)), true);
check("two codes differ", makeReference() !== makeReference(), true);

/* A proof names the team, the role and the row, so each endpoint can check its own
   part without re-deriving the identity. */
const leaderScope = proofScope("team-1", "LEADER", "member-1");
check("a leader scope round-trips", parseProofScope(leaderScope)?.role, "LEADER");
check("…and keeps the member row", parseProofScope(leaderScope)?.memberId, "member-1");
check("an organiser has no member row", parseProofScope(proofScope("t", "ORGANISER", ""))?.memberId, null);
check("a malformed scope is refused", parseProofScope("team-1"), null);
check("an unknown role is refused", parseProofScope("team-1:WIZARD:member-1"), null);
check("a coach is not treated as a player", accessRoleFor("COACH", false), "COACH");
check("the leader outranks their own playing role", accessRoleFor("STARTER", true), "LEADER");
check("only the leader and an organiser see the roster", maySeeRoster("LEADER") && maySeeRoster("ORGANISER") && !maySeeRoster("PLAYER"), true);
check("only the leader and an organiser reorder it", mayEditPositions("LEADER") && !mayEditPositions("COACH"), true);

console.log("\n── Teammates' answers reach the submission ──");
/* The browser only ever typed the teammate's university and address, so the
   personal fields must come from the draft rows — matched by address, never by
   position, because the captain may have reordered the roster since. */
const completedProfile = {
  fullName: "Omar Salem",
  gameTag: "Omar#2",
  studentId: "445100002",
  discord: "omar",
  phone: "0512345679",
  requirements: [{ id: "r1", label: "Rank", value: "Diamond" }],
  completedAt: new Date("2026-11-04T10:00:00Z"),
  confirmTokenHash: "a".repeat(64),
};
const profiles = new Map([["omar@student.ksu.edu.sa", completedProfile]]);

const submittedBody = {
  leaderIndex: 0,
  members: [
    { email: "a@student.ksu.edu.sa", fullName: "Ali Hassan", gameTag: "A#1" },
    { email: "omar@student.ksu.edu.sa", fullName: "", gameTag: "", studentId: "" },
    { email: "nobody@student.ksu.edu.sa", fullName: "", gameTag: "" },
  ],
};
const merged = applyDraftProfiles(submittedBody, profiles, 0) as typeof submittedBody;
check("the teammate's name is filled in", merged.members[1].fullName, "Omar Salem");
check("the teammate's game tag is filled in", merged.members[1].gameTag, "Omar#2");
check("a teammate with no answer is left alone", merged.members[2].fullName, "");
check("the leader's row is never replaced", merged.members[0].fullName, "Ali Hassan");

/* Receipts are attached after validation, from the server's own copy of the draft. */
const payloadMembers = [
  { email: "a@student.ksu.edu.sa" },
  { email: "omar@student.ksu.edu.sa" },
] as unknown as Parameters<typeof withCompletionReceipts>[0];
const receipted = withCompletionReceipts(payloadMembers, profiles, 0);
check("a completed teammate carries their confirmation", receipted[1].profileCompletedAt instanceof Date, true);
check("their link is carried into the team", receipted[1].confirmTokenHash, "a".repeat(64));
check("the leader carries no teammate receipt", receipted[0].profileCompletedAt, undefined);

check(
  "a coach needs no student number",
  validateMemberCompletion(
    {
      fullName: "Omar Salem",
      gameTag: "",
      studentId: "",
      discord: "omar",
      phone: "0512345679",
      requirements: [],
    },
    config,
    { role: "COACH" },
  ).ok,
  true,
);

console.log("\n── Payload carries the normalised name ──");
const payload = toPayload(draft([{ ...verified }]), config);
check("payload team name prefixed", payload.teamName, "Team Falcons");

console.log("\n── Image dimensions ──");
// Minimal but structurally valid headers.
const png = Buffer.alloc(30);
[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => (png[i] = b));
png.writeUInt32BE(512, 16);
png.writeUInt32BE(512, 20);
check("PNG 512×512 detected", readImageSize(png), { width: 512, height: 512, kind: "png", mimeType: "image/png" });

const pngWrong = Buffer.from(png);
pngWrong.writeUInt32BE(256, 16);
check("PNG 256×512 read as 256 wide", readImageSize(pngWrong)?.width, 256);

const gif = Buffer.alloc(12);
gif.write("GIF89a", 0, "ascii");
gif.writeUInt16LE(512, 6);
gif.writeUInt16LE(512, 8);
check("GIF detected", readImageSize(gif)?.width, 512);

check("garbage rejected", readImageSize(Buffer.from("not an image at all")), null);
check("SVG rejected", readImageSize(Buffer.from('<svg width="512" height="512"></svg>')), null);

console.log("\n── OTP ──");
process.env.OTP_SECRET = process.env.OTP_SECRET || "test-secret-for-verification-only";
check("OTP configured", await otpConfigured(), true);
const code = generateCode();
check("code is 6 digits", /^\d{6}$/.test(code), true);
const hashA = await hashCode(code, "A@ksu.edu.sa", "player-email");
const hashB = await hashCode(code, "a@ksu.edu.sa", "player-email");
const hashOther = await hashCode(code, "a@ksu.edu.sa", "edit-access");
check("hash is stable", hashA === hashB, true);
check("hash ignores purpose mismatch", hashA === hashOther, false);

const proof = await makeProof("Ali@ksu.edu.sa", "player-email");
check("proof verifies for its address", await verifyProof(proof, "ali@ksu.edu.sa", "player-email"), true);
check("proof rejected for another address", await verifyProof(proof, "other@ksu.edu.sa", "player-email"), false);
check("proof rejected for another purpose", await verifyProof(proof, "ali@ksu.edu.sa", "edit-access"), false);
check("tampered proof rejected", await verifyProof(`${proof}x`, "ali@ksu.edu.sa", "player-email"), false);
check("empty proof rejected", await verifyProof("", "ali@ksu.edu.sa", "player-email"), false);

/* OTP_SKIP_VERIFY mints a proof signed with a fixed dev key, so a skipped proof can
   never pass a real check — the whole point of the guard. */
const skipProof = makeSkipProof("Ali@ksu.edu.sa", "player-email");
check("a skipped proof is shaped like a proof", skipProof.includes("."), true);
check("a skipped proof does not pass real verification", await verifyProof(skipProof, "ali@ksu.edu.sa", "player-email"), false);

console.log("\n── OTP_SKIP_VERIFY is a testing-only escape hatch ──");
/* The flag must be inert in production. This cannot be exercised without booting the
   process, so the test pins the guard itself: the check has to name production and the
   two consumers have to route through `otpSkipVerify` rather than reading the env var
   directly. If either drifts, this fails. */
const otpSource = readFileSync("src/lib/otp.ts", "utf8");
const requestSource = readFileSync("src/app/api/otp/request/route.ts", "utf8");
const verifySource = readFileSync("src/app/api/otp/verify/route.ts", "utf8");
const registrationSource = readFileSync("src/app/api/registrations/route.ts", "utf8");
check("the flag is ignored in production", /OTP_SKIP_VERIFY/.test(otpSource) && /NODE_ENV === "production"/.test(otpSource), true);
check("the request route defers to otpSkipVerify", /otpSkipVerify\(\)/.test(requestSource), true);
check("the verify route defers to otpSkipVerify", /otpSkipVerify\(\)/.test(verifySource), true);
check("the registration route defers to otpSkipVerify", /otpSkipVerify\(\)/.test(registrationSource), true);
/* The client must recognise the skip flag the request returns, or a tester is still
   asked to type a code nobody received. */
const verificationSource = readFileSync("src/components/form/email-verification.tsx", "utf8");
check("the form honours the skip flag", /skipVerify === true/.test(verificationSource), true);

console.log("\n── Sheet export shaping ──");
const team: StoredTeam = {
  id: "t1",
  reference: "KSU-26-ABC123",
  teamName: "Team Falcons",
  teamNameKey: "team falcons",
  tournamentName: "KSU Crown",
  gender: "male",
  gameId: "overwatch-2",
  gameName: "OverWatch 2",
  leaderIndex: 1,
  consentedAt: new Date("2026-09-20T10:00:01Z"),
  bannedAt: null,
  banReason: "",
  createdAt: new Date("2026-09-20T10:00:00Z"),
  updatedAt: new Date("2026-09-20T10:00:00Z"),
  members: [
    {
      id: "m1", teamId: "t1", position: 0, fullName: "Ali Hassan", gameTag: "Ali#1",
      universityId: "ksu", universityName: "King Saud University", universityRegion: "Riyadh",
      email: "ali@ksu.edu.sa", studentId: "1234", discord: "ali", phone: "+966512345678",
      role: "STARTER", requirements: [{ id: "r1", label: "Rank", value: "Diamond" }],
      emailConfirmedAt: new Date("2026-09-20T10:00:00Z"), confirmTokenHash: null,
      profileCompletedAt: new Date("2026-09-20T10:00:00Z"), bannedAt: null, banReason: "",
      createdAt: new Date("2026-09-20T10:00:00Z"),
    },
    {
      id: "m2", teamId: "t1", position: 1, fullName: "Omar Salem", gameTag: "Omar#2",
      universityId: "ksu", universityName: "King Saud University", universityRegion: "Riyadh",
      email: "omar@ksu.edu.sa", studentId: null, discord: "omar", phone: "+966512345679",
      role: "COACH", requirements: [],
      emailConfirmedAt: null, confirmTokenHash: null,
      profileCompletedAt: null, bannedAt: null, banReason: "",
      createdAt: new Date("2026-09-20T10:00:00Z"),
    },
  ],
};

const rows = teamToPlayerRows(team);
check("one row per member", rows.length, 2);
check("reference repeated", rows[1].Reference, "KSU-26-ABC123");
check("coach keeps the database's Role value", rows[1].Role, "COACH");
check("leader flag on the right row", [rows[0]["Is Leader"], rows[1]["Is Leader"]], ["No", "Yes"]);
check("requirements flattened", rows[0]["Additional Requirements"], "Rank: Diamond");
check("null student id becomes empty", rows[1]["Student ID"], "");

console.log("\n── Confirmation email ──");
/* The language is stated rather than left to the default, so this block is
   unambiguously about the English rendering. The Arabic one is asserted separately. */
const email = buildConfirmationEmail(team, { baseUrl: "https://example.test", language: "en" });

check("subject names the team", email.subject.includes("Team Falcons"), true);
/* The reference was deliberately taken out of the subject: a random-looking token
   is a mild spam signal, and the organiser asked for it gone. It is still stated
   in full in both bodies, which is what actually matters — the assertion below
   guards that. Do not "restore" it into the subject. */
check("subject does not carry the reference", email.subject.includes("KSU-26-ABC123"), false);
check("html spells out the reference", email.html.includes("KSU-26-ABC123"), true);
check("html names every member", ["Ali Hassan", "Omar Salem"].every((name) => email.html.includes(name)), true);
check("html labels the leader", email.html.includes("Team leader"), true);
check("html shows the coach role", email.html.includes("Coach"), true);
check("html lists both universities", email.html.indexOf("King Saud University") !== -1, true);
check("html answers a requirement", email.html.includes("Rank") && email.html.includes("Diamond"), true);
check("html links to the edit flow", email.html.includes("https://example.test/?tab=edit"), true);
check("html uses the base url for the logo by default", email.html.includes("https://example.test/ksu-crown-logo.png"), true);
check("text version has the reference", email.text.includes("KSU-26-ABC123"), true);
check("text version names every member", ["Ali Hassan", "Omar Salem"].every((name) => email.text.includes(name)), true);
check("text version is not html", email.text.includes("<table"), false);

console.log("\n── The confirmation withholds personal contact details ──");
/* The confirmation goes to the team leader. Reproducing every member's email and
   phone onto one forwardable message would let a captain share four other people's
   contact details for no gain — the leader can read the form back. */
for (const [label, address] of [
  ["the leader's own address", "ali@ksu.edu.sa"],
  ["another member's address", "omar@ksu.edu.sa"],
]) {
  check(`html does not carry ${label}`, email.html.includes(address), false);
  check(`the text body does not carry ${label}`, email.text.includes(address), false);
}
for (const phone of ["+966512345678", "+966512345679"]) {
  check(`html does not carry ${phone}`, email.html.includes(phone), false);
  check(`the text body does not carry ${phone}`, email.text.includes(phone), false);
}
/* And it still says enough for the leader to verify the roster. */
check("the roster is still listed", email.html.includes("Ali Hassan") && email.html.includes("Omar Salem"), true);
check("universities are still listed", email.html.includes("King Saud University"), true);
check("the student ID is still listed", email.html.includes("1234"), true);
check("the leader is still marked", email.html.includes("Team leader"), true);
/* The privacy notice describes what the email contains, so it must not claim
   otherwise — a notice that misdescribes the system is worse than a vague one. */
check(
  "the English notice no longer claims every member's details are emailed",
  DEFAULT_PRIVACY_NOTICE.includes("contains the details of every member"),
  false,
);
check(
  "the English notice states what the email withholds",
  DEFAULT_PRIVACY_NOTICE.includes("does **not** include members' email addresses or phone numbers"),
  true,
);
check(
  "the Arabic notice no longer claims every member's details are emailed",
  DEFAULT_PRIVACY_NOTICE_AR.includes("بيانات جميع الأعضاء"),
  false,
);
check(
  "the Arabic notice states what the email withholds",
  DEFAULT_PRIVACY_NOTICE_AR.includes("ولا تتضمن عن قصد عناوين البريد الإلكتروني"),
  true,
);

// The caller decides the image source so it can prefer the inline attachment.
const withCid = buildConfirmationEmail(team, { baseUrl: "https://example.test", logoSrc: "cid:brand" });
check("an inline logo source is honoured", withCid.html.includes('src="cid:brand"'), true);
check("the public logo url is then absent", withCid.html.includes("/ksu-crown-logo.png"), false);

/* A team name, member name or answer is user input and lands in HTML. */
const hostile: StoredTeam = {
  ...team,
  teamName: 'Team <script>alert("x")</script>',
  members: team.members.map((member, index) =>
    index === 0
      ? { ...member, fullName: 'Ali "The< >" Hassan & co' }
      : member,
  ),
};
const escaped = buildConfirmationEmail(hostile, { baseUrl: "https://example.test" });
check("a script tag in a name is escaped", escaped.html.includes("<script>"), false);
check("the escaped form is present", escaped.html.includes("&lt;script&gt;"), true);
check("quotes in a name are escaped", escaped.html.includes('&quot;The'), true);
check("ampersands are escaped", escaped.html.includes("Hassan &amp; co"), true);
check("the plain-text version keeps the raw text", escaped.text.includes("Ali \"The< >\" Hassan & co"), true);

console.log("\n── App base URL ──");
const savedAppUrl = process.env.APP_URL;
process.env.APP_URL = "https://ksucrown.sa/";
check("APP_URL wins, trailing slash trimmed", await appBaseUrl(), "https://ksucrown.sa");
check("paths join without doubling", appUrl(await appBaseUrl(), "/?tab=edit"), "https://ksucrown.sa/?tab=edit");
check("paths join when missing a slash", appUrl(await appBaseUrl(), "x"), "https://ksucrown.sa/x");
delete process.env.APP_URL;

const fakeRequest = new Request("https://preview-abc.vercel.app/api/registrations", { method: "POST" });
check("the request origin is used when APP_URL is unset", await appBaseUrl(fakeRequest), "https://preview-abc.vercel.app");
check("a malformed request falls back rather than throwing", typeof (await appBaseUrl({ url: "not a url" } as Request)), "string");
if (savedAppUrl !== undefined) process.env.APP_URL = savedAppUrl;

console.log("\n── Email size (the inline logo dominates the message) ──");
{
  /* A 256×256 gradient, which compresses poorly — like the real brand mark. */
  const size = 256;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      pixels[i] = (x * 7 + y * 3) % 256;
      pixels[i + 1] = (x * 3 + y * 11) % 256;
      pixels[i + 2] = (x * 13 + y * 5) % 256;
      pixels[i + 3] = 255;
    }
  }

  const original = encodePng({ width: size, height: size, pixels });
  const decoded = decodePng(original);
  check("a PNG round-trips through decode", decoded ? [decoded.width, decoded.height] : null, [size, size]);
  check("round-tripped pixels are identical", decoded ? decoded.pixels.equals(pixels) : false, true);

  const halved = downscale(decoded!, 128);
  check("downscale halves the dimensions", [halved.width, halved.height], [128, 128]);

  const budget = Math.floor(original.byteLength * 0.6);
  const shrunk = shrinkPng(original, budget);
  check("shrinkPng respects its budget", shrunk.byteLength <= budget, true);
  check("the shrunken file is still a valid PNG", decodePng(shrunk) !== null, true);
  check("shrinkPng leaves a small file alone", shrinkPng(original, original.byteLength).byteLength, original.byteLength);

  check("decodePng refuses non-PNG bytes", decodePng(Buffer.from("not a png at all")), null);
  check("decodePng refuses a truncated file", decodePng(original.subarray(0, 20)), null);

  /* Alpha-weighted averaging: a fully transparent pixel must not tint its
     neighbours, however lurid its colour bytes are. */
  const edge = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 4 * 4; i += 1) {
    edge[i * 4] = 255;
    edge[i * 4 + 1] = 0;
    edge[i * 4 + 2] = 0;
    edge[i * 4 + 3] = i < 8 ? 0 : 255;
  }
  const averaged = downscale({ width: 4, height: 4, pixels: edge }, 2);
  check("transparent pixels do not bleed colour", averaged.pixels[0] <= 5, true);
  check("opaque pixels keep their colour", averaged.pixels[2 * 4] >= 250, true);
}

console.log("\n── Admin edits ──");
const adminConfig = normaliseConfig({ ...DEFAULT_TOURNAMENT });
const adminMember = {
  fullName: "Ali Hassan",
  gameTag: "A#1",
  universityId: "ksu",
  /* King Saud students hold `@student.ksu.edu.sa`, and that subdomain is the *only*
     accepted form since the strict rule landed — so a fixture on `@ksu.edu.sa` would
     now fail validation, correctly. */
  email: "admin.a@student.ksu.edu.sa",
  /* Real student numbers are 8–9 digits. These used to read `ADM0001`, which only
     passed because the rule allowed letters. */
  studentId: "445100001",
  discord: "ali",
  phone: "0512345678",
  role: "STARTER",
  requirements: [],
};
const adminBody = {
  teamName: "Falcons",
  gender: "male",
  gameId: "rocket-league",
  leaderIndex: 0,
  members: [
    adminMember,
    { ...adminMember, gameTag: "B#1", email: "admin.b@student.ksu.edu.sa", studentId: "445100002", discord: "ali_b" },
    { ...adminMember, gameTag: "C#1", email: "admin.c@student.ksu.edu.sa", studentId: "445100003", discord: "ali_c" },
  ],
};

const good = validateAdminTeamEdit(adminBody, adminConfig);
check("a valid edit is accepted", good.ok, true);
check("the team name is normalised", good.ok ? good.input.teamName : null, "Team Falcons");
check("the name key is derived", good.ok ? good.input.teamNameKey : null, "team falcons");
check("a complete roster raises no warning", good.ok ? good.warnings : null, []);
check("the phone is normalised", good.ok ? good.input.members[0].phone : null, "+966512345678");

// An organiser removing a disqualified player must not be blocked…
const short = validateAdminTeamEdit({ ...adminBody, members: adminBody.members.slice(0, 2) }, adminConfig);
check("a short roster still saves", short.ok, true);
check("…but it is warned about", short.ok ? short.warnings.some((w) => /exactly 3 starters/.test(w)) : false, true);

// …while field-level problems are hard errors.
const badEmail = validateAdminTeamEdit(
  { ...adminBody, members: [{ ...adminMember, email: "nope@example.com" }, ...adminBody.members.slice(1)] },
  adminConfig,
);
check("a bad email is refused", badEmail.ok, false);
check("the error names the field", badEmail.ok ? null : badEmail.errors["member.0.email"],
  "nope@example.com is not a King Saud University address (expected student.ksu.edu.sa)");

const duplicate = validateAdminTeamEdit(
  { ...adminBody, members: [adminMember, { ...adminMember, gameTag: "B#1", studentId: "445100002" }] },
  adminConfig,
);
check("a duplicated email is refused", duplicate.ok ? null : duplicate.errors["member.1.email"], "Already used by another member");

const badName = validateAdminTeamEdit(
  { ...adminBody, members: [{ ...adminMember, fullName: "1234" }, ...adminBody.members.slice(1)] },
  adminConfig,
);
check("a numeric name is refused", badName.ok ? null : typeof badName.errors["member.0.fullName"], "string");

const coachLeader = validateAdminTeamEdit(
  {
    ...adminBody,
    leaderIndex: 0,
    members: [{ ...adminMember, role: "COACH", gameTag: "", studentId: "" }, ...adminBody.members.slice(1)],
  },
  adminConfig,
);
check("a coach cannot lead", coachLeader.ok ? null : coachLeader.errors.leader, "The team leader must be a player, not a coach");

check("an unknown game is refused", validateAdminTeamEdit({ ...adminBody, gameId: "nope" }, adminConfig).ok, false);
check(
  "a game the division cannot enter is refused",
  validateAdminTeamEdit({ ...adminBody, gender: "female", gameId: "rocket-league" }, adminConfig).ok,
  false,
);
check("an empty roster is refused", validateAdminTeamEdit({ ...adminBody, members: [] }, adminConfig).ok, false);

console.log("\n── Masking addresses in messages ──");
/* These strings are shown to whoever is looking at the screen, and the edit flow
   shows them before anyone has proved they own the address. */
check(
  "a long local part keeps two characters then masks the rest",
  maskEmail("zzrefus.leader@ksu.edu.sa"),
  `zz${"•".repeat("zzrefus.leader".length - 2)}@ksu.edu.sa`,
);
check("the full address never survives", maskEmail("447160056@student.ksu.edu.sa").includes("447160056"), false);
check("the domain is kept so it is recognisable", maskEmail("447160056@student.ksu.edu.sa").endsWith("@student.ksu.edu.sa"), true);
check("a one-character local part still masks", maskEmail("a@ksu.edu.sa"), "a•@ksu.edu.sa");
check("a two-character local part masks", maskEmail("ab@ksu.edu.sa"), "ab•@ksu.edu.sa");
check("a subdomain survives intact", maskEmail("x@mail.student.ksu.edu.sa").endsWith("@mail.student.ksu.edu.sa"), true);
check("a string with no @ is returned unchanged", maskEmail("not-an-email"), "not-an-email");

console.log("\n── Team-name prefix handling ──");
check("a stored prefix is stripped for editing", stripTeamPrefix("Team Falcons"), "Falcons");
check("the prefix is stripped case-insensitively", stripTeamPrefix("team falcons"), "falcons");
check("a name without the prefix is untouched", stripTeamPrefix("Alboussayes team"), "Alboussayes team");
check("a leading word that merely starts with 'Team' is kept", stripTeamPrefix("Teamwork Squad"), "Teamwork Squad");

console.log("\n── Name policy: evasions still caught ──");
/* Every one of these is the same word, disguised a different way. The check is
   pointless if it only catches the plain spelling. */
for (const disguised of ["sh1t", "$hit", "s.h.i.t", "shiiit", "SHIT", "s h i t", "fück", "b!tch"]) {
  check(`"${disguised}" is refused`, findBlockedTerm(disguised) !== null, true);
}

console.log("\n── Name policy: innocent words survive ──");
/* The other half of the job. This check also runs against every member's name, so
   a false positive does not merely annoy someone — it turns a student away.
   "Scunthorpe" and "Dickens" were both refused before the matcher was narrowed
   to runs of single letters. */
for (const innocent of [
  "Scunthorpe", "classic", "assignment", "sheet", "Assumption", "Cassette",
  "Dickens", "Analytics", "Bass", "passion", "Sussex", "Titan", "Ship",
  "X-Force", "Rock & Roll", "O'Neil",
]) {
  check(`"${innocent}" is allowed`, findBlockedTerm(innocent), null);
}

// A real name from the live registrations — Arabic must pass untouched.
const arabicName = "عساف بن قرين";
check("an Arabic name is allowed", findBlockedTerm(arabicName), null);
check("an Arabic team name is allowed", teamNamePolicyError(`Team ${arabicName}`), null);
check("an Arabic personal name is allowed", personNamePolicyError(arabicName), null);

console.log("\n── Name policy: team names ──");
check("a plain name passes", teamNamePolicyError("Team Falcons"), null);
check("digits are allowed", teamNamePolicyError("Team 7"), null);
check("a decimal name is allowed", teamNamePolicyError("Team 3.0"), null);
check("an apostrophe is allowed", teamNamePolicyError("Team O'Neil"), null);
check("an ampersand is allowed", teamNamePolicyError("Rock & Roll"), null);
check("an empty name is refused", typeof teamNamePolicyError(""), "string");
check("brackets are refused", typeof teamNamePolicyError("Team X[Y]"), "string");
check("a slash is refused", typeof teamNamePolicyError("Team A/B"), "string");
check("an @ is refused", typeof teamNamePolicyError("Team @home"), "string");
check("emoji are refused", typeof teamNamePolicyError("Team 🙂"), "string");
check("a disguised swear is refused", typeof teamNamePolicyError("Team Sh1t"), "string");
check("organiser-added terms are refused", typeof teamNamePolicyError("Team Rivals", { blockedTerms: ["rivals"] }), "string");
check("a game tag with a disguised swear is refused", typeof gameTagPolicyError("Sh1t#1234"), "string");
check("a clean game tag passes", gameTagPolicyError("Falcon#1234"), null);

console.log("\n── Consent is required, and reachable ──");
/* The wizard asks for consent on the review step, because that is where the
   checkbox is. Mapping the error to step 0 — as it briefly was — made the form
   impossible to finish: the captain could not leave step 0 without ticking a box
   that only appeared after step 3, and the final button stayed disabled. */
check("consent belongs to the review step", fieldStep("consent"), STEP_COUNT - 1);
check("consent is required by default", config.requireConsent, true);

const noConsent = draft([{ ...verified }], { consentGiven: false });
check("a draft without consent is invalid", typeof validateDraft(noConsent, config).errors.consent, "string");
check("a draft with consent is valid", validateDraft(draft([{ ...verified }]), config).errors.consent, undefined);

/* The deadlock, stated directly. Tested against the consent error on its own
   rather than a whole draft, so nothing else can be mistaken for it: withholding
   consent must not block any step the captain has to pass through to reach the
   checkbox, and must block the one they submit from. */
const consentOnly = { consent: "Please confirm you have read and accept the notice" };
for (let step = 0; step < STEP_COUNT - 1; step += 1) {
  check(`consent alone does not block step ${step + 1}`, isStepValid(step, consentOnly), true);
}
check("consent alone blocks the review step", isStepValid(STEP_COUNT - 1, consentOnly), false);

// Consent can be turned off entirely by the organisers.
const noConsentNeeded = normaliseConfig({ ...DEFAULT_TOURNAMENT, requireConsent: false });
check("consent can be switched off", noConsentNeeded.requireConsent, false);
check(
  "a draft without consent passes when it is off",
  validateDraft(draft([{ ...verified }], { consentGiven: false }), noConsentNeeded).errors.consent,
  undefined,
);

console.log("\n── Reopening a stored registration: consent reflects the record ──");
/* The edit screen builds its draft from the stored team, so this is where an
   invented consent would originate. It used to hardcode `true`, which meant a
   captain opening one of the pre-consent registrations to fix a typo had a consent
   timestamp written on save that nobody was ever asked for. */
check("a team that consented comes back ticked", teamToDraft(team, config).consentGiven, true);
check(
  "a team with no consent on record comes back unticked",
  teamToDraft({ ...team, consentedAt: null }, config).consentGiven,
  false,
);

/* And the unticked case must actually block a save, or "asking again" is theatre. */
const reopened = teamToDraft({ ...team, consentedAt: null }, config);
check(
  "reopening an un-consented team requires consent to save",
  typeof validateDraft(reopened, config).errors.consent,
  "string",
);
const reopenedWithConsent = teamToDraft(team, config);
check(
  "reopening a consented team needs nothing further",
  validateDraft(reopenedWithConsent, config).errors.consent,
  undefined,
);

console.log("\n── Email confirmation is per member ──");
/* One player confirming their own address must never make the rest of the roster
   look confirmed. The stored team below has two members: the first has a
   confirmation timestamp, the coach has none. Reopening the entry must keep the
   pending member pending — that was the bug: every member came back with
   `verifiedEmail` filled in, so a single confirmation looked like it had covered
   the whole team. */
const perMember = teamToDraft(team, config);
check(
  "only the member who confirmed reopens as verified",
  perMember.members.map((member) => member.verifiedEmail),
  [team.members[0].email, ""],
);
check(
  "only confirmed addresses count as proven for an edit",
  [...teamVerifiedEmails(team)],
  [team.members[0].email.trim().toLowerCase()],
);

/* The write itself is scoped to one row and one token, so a confirmation cannot
   reach a sibling no matter how the roster is shaped. */
const storeSourcePerMember = stripComments(readFileSync("src/lib/store.ts", "utf8"));
check(
  "a confirmation updates one member, by id and token",
  /id: member\.id[\s\S]{0,160}confirmTokenHash: hash/.test(storeSourcePerMember),
  true,
);
check(
  "the completion page names the address it belongs to",
  /complete\.emailLabel/.test(
    stripComments(readFileSync("src/components/confirm/confirm-email-panel.tsx", "utf8")),
  ) && /initial\.email/.test(readFileSync("src/components/confirm/confirm-email-panel.tsx", "utf8")),
  true,
);
/* Opening the link must not confirm anything: a mail filter that follows URLs
   would otherwise confirm a player who never clicked. Confirmation is the POST. */
const confirmPageSource = stripComments(readFileSync("src/app/confirm-email/page.tsx", "utf8"));
check("opening the link does not confirm by itself", /confirmMemberEmail/.test(confirmPageSource), false);
check(
  "confirming is a POST, so a link scanner cannot do it",
  existsSync("src/app/api/confirm-email/route.ts") &&
    /export async function POST/.test(readFileSync("src/app/api/confirm-email/route.ts", "utf8")),
  true,
);

/* Each pending member is minted a token inside the loop and the message is sent to
   that member's own address. A shared token — or a shared recipient — is exactly
   what would make one player's confirmation cover the whole roster. */
const memberMailSource = stripComments(readFileSync("src/lib/confirmation-email.ts", "utf8"));
check(
  "each pending member gets their own confirmation token",
  /function sendMemberCompletionRequest[\s\S]{0,600}generateConfirmToken\(\)/.test(memberMailSource) &&
    /eachConcurrently\(pending[\s\S]{0,400}sendMemberCompletionRequest\(/.test(memberMailSource),
  true,
);
check(
  "each confirmation link is sent to that member's own address",
  /to: member\.email,/.test(memberMailSource),
  true,
);

console.log("\n── Mail channels: codes and confirmations are separate accounts ──");
/* Read fresh from the environment on every call, so these set and clear the vars
   around each assertion rather than relying on import order. */
const sharedEnv = {
  SMTP_HOST: "shared.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "one@shared.test",
  SMTP_PASS: "pw",
  SMTP_FROM: "KSU Crown",
};
const clearChannels = () => {
  for (const key of Object.keys(process.env)) {
    if (/^SMTP_(OTP|CONFIRMATION)_/.test(key)) delete process.env[key];
  }
};

// 1. Nothing but SMTP_* — both channels share it, exactly as before channels existed.
Object.assign(process.env, sharedEnv);
clearChannels();
check("with no overrides both channels share the account", (await channelSettings("otp")).host, (await channelSettings("confirmation")).host);
check("the shared host is used", (await channelSettings("otp")).host, "shared.example.test");
check("a shared account is not reported as dedicated", (await channelSettings("confirmation")).dedicated, false);

// 2. Override one channel only. The other must be untouched.
process.env.SMTP_OTP_HOST = "codes.example.test";
process.env.SMTP_OTP_USER = "codes@otp.test";
process.env.SMTP_OTP_PORT = "2525";
check("the overridden channel moves", (await channelSettings("otp")).host, "codes.example.test");
check("the overridden channel takes its own user", (await channelSettings("otp")).user, "codes@otp.test");
check("the overridden channel takes its own port", (await channelSettings("otp")).port, 2525);
check("the other channel is untouched", (await channelSettings("confirmation")).host, "shared.example.test");
check("an overridden channel reports itself dedicated", (await channelSettings("otp")).dedicated, true);

/* Fields fall back one at a time, not as a block — so overriding only the host of
   a second account on the same provider is a one-line change. */
check("an unset field still falls back", (await channelSettings("otp")).from, "KSU Crown");
check("the fallback From borrows the channel's own user", fromAddress(await channelSettings("otp")), "KSU Crown <codes@otp.test>");
check("the shared channel's From borrows the shared user", fromAddress(await channelSettings("confirmation")), "KSU Crown <one@shared.test>");

// 3. Both channels fully separate.
process.env.SMTP_CONFIRMATION_HOST = "records.example.test";
process.env.SMTP_CONFIRMATION_USER = "records@mail.test";
process.env.SMTP_CONFIRMATION_REPLY_TO = "organisers@real.test";
check("both channels can be fully separate", [(await channelSettings("otp")).host, (await channelSettings("confirmation")).host], ["codes.example.test", "records.example.test"]);
check("a per-channel reply-to wins over the shared one", (await channelSettings("confirmation")).replyTo, "organisers@real.test");
check("a channel without its own reply-to falls back", (await channelSettings("otp")).replyTo, "");

/* MAIL_REPLY_TO sits between them: a channel's own value beats it, and it beats
   the authenticated user, which is what `defaultReplyTo` would otherwise use. */
process.env.MAIL_REPLY_TO = "org@example.test";
check("the global reply-to is used when the channel has none", (await channelSettings("otp")).replyTo, "org@example.test");
check("the channel's own reply-to still wins", (await channelSettings("confirmation")).replyTo, "organisers@real.test");

// 4. Passwords are taken literally, unlike every other setting.
process.env.SMTP_OTP_PASS = "  spaced secret  ";
check("a password is not trimmed", (await channelSettings("otp")).pass, "  spaced secret  ");
check("other settings are trimmed", (await channelSettings("otp")).host, "codes.example.test");

// 5. Configuration is per channel, so one can be missing while the other works.
clearChannels();
delete process.env.SMTP_HOST;
check("a channel with no host is unconfigured", await mailerConfigured("otp"), false);
check("the other channel is unaffected", await mailerConfigured("confirmation"), false);
Object.assign(process.env, sharedEnv);
check("and configured once the host is back", await mailerConfigured("otp"), true);
clearChannels();

console.log("\n── Mail speed: one handshake per batch, not per message ──");
/* Reported from a real registration: the confirmation emails took two to three
   minutes to arrive. Two things caused that, and both are about *when* a message is
   handed to the relay rather than how fast the relay is:
     1. every `sendMail` opened, authenticated and closed its own connection;
     2. the leader's receipt was awaited before the first member link was even
        composed, and members were then sent one after another.
   These assert the shape of the fix, because a regression here is invisible in a
   unit test and only shows up as a student waiting. */
const mailerSource = stripComments(readFileSync("src/lib/mailer.ts", "utf8"));
check("the SMTP transport is pooled", /pool:\s*true/.test(mailerSource), true);
check("the pool is bounded", /maxConnections:\s*\d+/.test(mailerSource), true);
check("and connections are closed when idle", /idleTimeout:\s*POOL_IDLE_TIMEOUT_MS/.test(mailerSource), true);

const memberMailTiming = stripComments(readFileSync("src/lib/confirmation-email.ts", "utf8"));
check(
  "member confirmations are sent concurrently rather than in sequence",
  /eachConcurrently\(pending,\s*\d+/.test(memberMailTiming) &&
    !/for \(const member of pending\)/.test(memberMailTiming),
  true,
);

const registrationRoute = stripComments(readFileSync("src/app/api/registrations/route.ts", "utf8"));
check(
  "the receipt and the member links are started together",
  /Promise\.allSettled\(\[\s*sendRegistrationConfirmation[\s\S]{0,120}sendMemberConfirmationRequests/.test(
    registrationRoute,
  ),
  true,
);
check(
  "the response does not wait for the mail",
  /runAfterResponse\(/.test(registrationRoute) &&
    !/const confirmed = await sendRegistrationConfirmation/.test(registrationRoute),
  true,
);
const deferredSource = stripComments(readFileSync("src/lib/deferred.ts", "utf8"));
check("deferred work uses Next's after()", /import \{ after \} from "next\/server"/.test(deferredSource), true);
check(
  "…and falls back to running inline when it cannot defer",
  /catch \{[\s\S]{0,80}await task\(\)/.test(deferredSource),
  true,
);
check(
  "the edit route does not hold the save open for mail either",
  /runAfterResponse\(/.test(
    stripComments(readFileSync("src/app/api/registrations/[reference]/route.ts", "utf8")),
  ),
  true,
);

console.log("\n── Live feedback: what shows while typing ──");
/* The complaint this answers was "there is no check for names". The check was
   always running — but its message stayed hidden until the field was left, so a
   captain who typed a refused name saw nothing and reasonably concluded that
   nothing was being checked. These assert the split: problems typing cannot fix
   appear at once, problems about an unfinished value wait. */
check("a refused word in a team name shows at once", revealsImmediately("teamName", "Team Sh1t"), true);
check("brackets in a team name show at once", revealsImmediately("teamName", "Team X[Y]"), true);
/* Digits alone are *allowed*, because the organisers' own rule prefixes "Team" —
   so the name always has letters by the time it is judged. Asserted so nobody
   "fixes" this into a false positive later. */
check("digits alone are allowed, since the prefix adds letters", teamNamePolicyError(normaliseTeamName("12345")), null);
check("so digits alone stay quiet", revealsImmediately("teamName", "12345"), false);
check("an ordinary team name stays quiet", revealsImmediately("teamName", "Falcons"), false);
check("a half-typed team name stays quiet", revealsImmediately("teamName", "Fa"), false);
check("a single-letter team name stays quiet", revealsImmediately("teamName", "X"), false);
check("an empty team name stays quiet", revealsImmediately("teamName", ""), false);

check("digits in a person's name show at once", revealsImmediately("fullName", "Ali 123"), true);
check("a refused word in a name shows at once", revealsImmediately("fullName", "Shit Head"), true);
check("one word of a name stays quiet", revealsImmediately("fullName", "Ali"), false);
check("a full name stays quiet", revealsImmediately("fullName", "Ali Hassan"), false);
check("an Arabic name stays quiet", revealsImmediately("fullName", "عساف بن قرين"), false);
check("a hyphenated name stays quiet", revealsImmediately("fullName", "Jean-Luc Picard"), false);

check("a malformed finished address shows at once", revealsImmediately("email", "ali@ksu.edu"), true);
check("a valid address stays quiet", revealsImmediately("email", "441313142@student.ksu.edu.sa"), false);
check("a bare address stays quiet", revealsImmediately("email", "441313142"), false);
check("a half-typed address stays quiet", revealsImmediately("email", "ali@"), false);
check("a half-typed domain stays quiet", revealsImmediately("email", "ali@ksu"), false);

check("a refused game tag shows at once", revealsImmediately("gameTag", "Sh1t#1234"), true);
check("an ordinary game tag stays quiet", revealsImmediately("gameTag", "Falcon#1234"), false);

// Organiser-added terms drive the live rule too.
check(
  "an organiser term shows at once",
  revealsImmediately("teamName", "Team Rivals", ["rivals"]),
  true,
);

console.log("\n── Moderation: evasions must be caught ──");
/* Every one of these is the same word, disguised a different way. A filter that
   only compares exact strings catches none of them. */
for (const disguised of [
  "shit", "sh1t", "$hit", "5hit", "shi7", "s.h.i.t", "s_h_i_t", "s h i t",
  "f-u-c-k", "shiiit", "SHIT", "SH1T!!!", "shit!", "fück", "b!tch", "$h!t",
  "f*ck", "sh*t", "f**k", "b*tch",
]) {
  check(`"${disguised}" is refused`, findBlockedTerm(disguised) !== null, true);
}

// Cyrillic and Greek lookalikes — different code points, identical on screen.
check("a Cyrillic 'а' in 'аss' is still caught", findBlockedTerm("аss"), "ass");
check("an Arabic-Indic digit is still caught", findBlockedTerm("sh١t"), "shit");
check("a zero-width space cannot hide a word", findBlockedTerm("sh\u200Bit"), "shit");
check("a soft hyphen cannot hide a word", findBlockedTerm("sh\u00ADit"), "shit");
check("a spelled-out slur is caught", findBlockedTerm("k m s"), "kms");
check("a phrase is caught", findBlockedTerm("kill yourself"), "kill yourself");
check("a phrase with a typo'd word is caught", findBlockedTerm("kill urself"), "kill urself");

console.log("\n── Moderation: innocent text must survive ──");
/* The other half of the job, and the half that matters more. This check also runs
   against every member's name, so a false positive does not merely annoy someone —
   it turns a real student away from the tournament. `Scunthorpe` and `Dickens` were
   both refused by an earlier implementation. */
for (const innocent of [
  "Scunthorpe", "Dickens", "Dickenson", "classic", "assignment", "sheet",
  "Assumption", "Cassette", "Analytics", "Bass", "passion", "Sussex", "Essex",
  "Titan", "Ship", "Class", "Assassin", "Grass", "Passage", "Cocktail",
  "Shuttle", "Peacock", "Hancock", "Cumbria", "Penistone", "Babcock",
  "cumulative", "document", "assume", "bassoon", "sassy", "massive",
  "Massachusetts", "mediterranean", "Mahmoud", "Sussex",
]) {
  check(`"${innocent}" is allowed`, findBlockedTerm(innocent), null);
}

/* `xxx` used to be on the list and folded to a single `x`, so any name with a
   standalone X was refused as sexual content — including the real team name. */
check("a standalone X is not sexual content", findBlockedTerm("X-Force"), null);
check("X-Force is a valid team name", teamNamePolicyError("Team X-Force"), null);
check("X alone is quiet", teamNamePolicyError("Team X"), null);

// A placeholder is not evidence of anything.
check("an already-masked word is left alone", findBlockedTerm("F***rs"), null);

console.log("\n── Moderation: categories, severity and action ──");
const hate = moderateText("Team Nazi");
check("hate speech is flagged", hate.is_flagged, true);
check("hate speech blocks", hate.action, "BLOCK");
check("hate speech is categorised", hate.violations[0]?.category, "HATE_SPEECH");
check("hate speech is high severity", hate.violations[0]?.severity, "HIGH");

const mild = moderateText("Team Crap");
check("mild profanity is flagged", mild.is_flagged, true);
check("mild profanity masks rather than blocks", mild.action, "MASK");
check("mild profanity is low severity", mild.violations[0]?.severity, "LOW");

const clean = moderateText("Team Falcons");
check("clean text is not flagged", clean.is_flagged, false);
check("clean text is allowed", clean.action, "ALLOW");
check("clean text is returned untouched", clean.sanitized_text, "Team Falcons");

const harm = moderateText("kys");
check("self-harm is categorised", harm.violations[0]?.category, "SELF_HARM");
check("self-harm blocks", harm.action, "BLOCK");

const arabic = moderateText("Team كلب");
check("Arabic abuse is caught", arabic.is_flagged, true);
check("Arabic abuse is categorised as an insult", arabic.violations[0]?.category, "INSULT");

const franco = moderateText("Team sharmouta");
check("Franco-Arab abuse is caught", franco.is_flagged, true);
check("Franco-Arab abuse is categorised", franco.violations[0]?.category, "PROFANITY");

console.log("\n── Moderation: sanitising ──");
check("a blocked word is masked", moderateText("Team sh1t crows").sanitized_text, "Team s*** crows");
check("masking keeps the spaces between words", moderateText("Team crap and shit").sanitized_text, "Team c*** and s***");
check("masking survives a dotted spelling", moderateText("Team s.h.i.t").sanitized_text.startsWith("Team s"), true);
check("masking survives a leet spelling", moderateText("Team $hit").sanitized_text.includes("$***"), true);
check("masking does not run past the word", moderateText("Team Crap squad").sanitized_text, "Team C*** squad");
check("a clean string is not altered", moderateText("Team Falcons").sanitized_text, "Team Falcons");
/* The violation names what the person typed, not the list entry — the organisers
   read this line. */
check("the violation reports the original spelling", moderateText("Team sh1t").violations[0]?.word, "sh1t");
check("the violation spelling is not lower-cased", moderateText("Team SH1T").violations[0]?.word, "SH1T");

console.log("\n── Moderation: what reaches the organiser ──");
/* Mild terms are accepted but flagged. Refusing "Team Idiots" would be
   heavy-handed; accepting it silently would leave the organisers unaware of what
   is about to be published on their bracket. */
check("mild abuse produces a warning", nameWarnings("Team Idiots").length, 1);
check("mild abuse is not refused", teamNamePolicyError("Team Idiots"), null);
check("severe abuse produces no warning, because it is refused", nameWarnings("Team Nazis").length, 0);
check("clean text produces no warning", nameWarnings("Team Falcons").length, 0);
/* The message must never echo the term — an error on a public form should not
   publish the slur it is complaining about. */
check("the refusal does not repeat the word", teamNamePolicyError("Team Shit")?.includes("shit"), false);
check("the hate-speech refusal names the reason", teamNamePolicyError("Team Nazi")?.includes("attacks people"), true);
check("the self-harm refusal is not accusatory", teamNamePolicyError("Team kys")?.includes("talk to somebody"), true);

// Validation surfaces the warning to the captain and the console.
const mildDraft = draft([{ ...verified, fullName: "Ali Idiot" }], { teamName: "Idiots" });
const mildResult = validateDraft(mildDraft, config);
check("a mild name still validates", mildResult.errors.teamName, undefined);
check("a mild name warns", mildResult.warnings.some((w) => w.includes("mild")), true);

check("organiser-added terms block", typeof teamNamePolicyError("Team Rivals", { blockedTerms: ["rivals"] }), "string");
check("organiser-added terms are categorised", moderateText("Team Rivals", ["rivals"]).violations[0]?.category, "PROFANITY");

console.log("\n── Moderation: plurals ──");
/* Whole-word matching is strict, so a trailing `s` was enough to slip a slur past:
   the list holds `nazi` and `Team Nazis` was accepted. */
for (const plural of ["Team Nazis", "Team Idiots", "Team Morons", "Team Losers", "Team Bastards"]) {
  check(`"${plural}" is caught`, findBlockedTerm(plural) !== null, true);
}
check("a plural slur blocks", moderateText("Team Nazis").action, "BLOCK");

/* The plural rule must not start refusing words that merely end in `s`. */
for (const innocent of [
  "Team Assists", "Team Classes", "Team Passes", "Team Masses", "Team Glass",
  "Team Brass", "Assessment", "Assistant", "Massage", "Nobility",
]) {
  check(`"${innocent}" is still allowed`, findBlockedTerm(innocent), null);
}

console.log("\n── Bilingual form: every message shown has an Arabic translation ──");
/* `validation.ts` runs on the server too, so it emits English strings that the UI
   translates on the way to the screen. If a rule is added without a translation the
   Arabic form silently shows English — so this enumerates what validation can
   actually produce and asserts each one is covered. */
const invalidDrafts: { label: string; draft: RegistrationDraft }[] = [
  { label: "empty team name", draft: draft([{ ...verified }], { teamName: "" }) },
  { label: "short team name", draft: draft([{ ...verified }], { teamName: "X" }) },
  { label: "refused team name", draft: draft([{ ...verified }], { teamName: "Sh1t" }) },
  { label: "no division", draft: draft([{ ...verified }], { gender: "" }) },
  { label: "no game", draft: draft([{ ...verified }], { gameId: "" }) },
  { label: "wrong game for division", draft: draft([{ ...verified }], { gender: "female", gameId: "rocket-league" }) },
  { label: "no consent", draft: draft([{ ...verified }], { consentGiven: false }) },
  { label: "empty name", draft: draft([{ ...verified, fullName: "" }]) },
  { label: "one-word name", draft: draft([{ ...verified, fullName: "Ali" }]) },
  { label: "numeric name", draft: draft([{ ...verified, fullName: "1234" }]) },
  { label: "refused name", draft: draft([{ ...verified, fullName: "Shit Head" }]) },
  { label: "empty game tag", draft: draft([{ ...verified, gameTag: "" }]) },
  { label: "unusable game tag", draft: draft([{ ...verified, gameTag: "!!!" }]) },
  { label: "refused game tag", draft: draft([{ ...verified, gameTag: "Sh1t#1" }]) },
  { label: "no university", draft: draft([{ ...verified, universityId: "" }]) },
  { label: "unknown university", draft: draft([{ ...verified, universityId: "nope" }]) },
  { label: "empty email", draft: draft([{ ...verified, email: "" }]) },
  { label: "non-edu email", draft: draft([{ ...verified, email: "a@b.com" }]) },
  { label: "unverified email", draft: draft([{ ...verified, verifiedEmail: "" }]) },
  { label: "empty student id", draft: draft([{ ...verified, studentId: "" }]) },
  { label: "short student id", draft: draft([{ ...verified, studentId: "12" }]) },
  /* A student number is digits and nothing else. Letters used to be accepted,
     which let a Discord handle be typed into the field the organisers look a
     student up by. */
  { label: "letters in student id", draft: draft([{ ...verified, studentId: "ADM0001" }]) },
  { label: "letters after digits", draft: draft([{ ...verified, studentId: "445100001a" }]) },
  { label: "a dash in student id", draft: draft([{ ...verified, studentId: "445-100" }]) },
  { label: "a space in student id", draft: draft([{ ...verified, studentId: "4451 000" }]) },
  { label: "an Arabic-Indic student id", draft: draft([{ ...verified, studentId: "٤٤٥١٠٠٠٠١" }]) },
  { label: "empty discord", draft: draft([{ ...verified, discord: "" }]) },
  { label: "bad discord", draft: draft([{ ...verified, discord: "has spaces!" }]) },
  { label: "empty phone", draft: draft([{ ...verified, phone: "" }]) },
  { label: "bad phone", draft: draft([{ ...verified, phone: "123" }]) },
  { label: "too few starters", draft: draft([{ ...verified }]) },
  { label: "too many substitutes", draft: draft([
    ...Array.from({ length: 5 }, () => ({ ...verified })),
    ...Array.from({ length: 3 }, () => ({ ...verified, role: "SUBSTITUTE" as const })),
  ]) },
];

const emitted = new Set<string>();
for (const { draft: candidate } of invalidDrafts) {
  const result = validateDraft(candidate, config);
  for (const message of Object.values(result.errors)) emitted.add(message);
}

check("the battery produces messages at all", emitted.size > 10, true);
const untranslated = [...emitted].filter((message) => !hasArabicMessage(message));
check("every emitted message has an Arabic translation", untranslated, []);

// The server path emits its own set, so it is checked too.
const serverMessages = new Set<string>();
const badPayload = {
  tournamentName: "KSU Crown", teamName: "", gender: "male", gameId: "nope",
  gameName: "", leaderIndex: 99, consentGiven: false, members: [],
};
const serverResult = validatePayload(badPayload, config, { verifyEmail: () => false });
if (!serverResult.ok) {
  for (const message of Object.values(serverResult.errors)) serverMessages.add(message);
}
check("the server battery produces messages", serverMessages.size > 3, true);
check(
  "every server message has an Arabic translation",
  [...serverMessages].filter((message) => !hasArabicMessage(message)),
  [],
);

/* A placeholder substitution that silently failed would show `{count}` to a user. */
check(
  "placeholders are substituted",
  t("ar", "roster.needMore", { max: 6 }).includes("6"),
  true,
);
check(
  "an unknown placeholder is left visible rather than blanked",
  t("en", "roster.needMore").includes("{max}"),
  true,
);
/* The two dictionaries must not drift; the type already enforces it, but an empty
   string would satisfy the type and show nothing. */
const dictionaryKeys = Object.keys(EN) as (keyof typeof EN)[];

/* Keys the organisers have deliberately blanked.
 *
 * The guards below exist to catch a *missing* translation: an empty string satisfies
 * `Record<MessageKey, string>` while rendering nothing, which is exactly how a blank
 * label ships. That is not the same as a line of UI the organiser chose to remove — and
 * blanking the string is the right way to remove one, because the component keeps
 * calling `t(key)`, the key keeps existing in both languages, and nothing else changes.
 *
 * Scoped to these keys on purpose, so the guard stays meaningful for all ~230 others.
 *
 * `team.gamesOpen` is blank in **both** languages, which is what a deliberate removal
 * looks like. The other two are blank in Arabic only — an Arabic reader sees no line
 * where an English one does — so they are recorded here rather than endorsed, and they
 * are worth confirming. */
const EMPTY_BY_DESIGN = new Set<keyof typeof EN>([
  "team.gamesOpen",
  "team.gamesOpenOne",
  "step.team.blurb",
]);

check(
  "no English string is empty",
  dictionaryKeys.filter((key) => !EN[key].trim() && !EMPTY_BY_DESIGN.has(key)),
  [],
);
check(
  "no Arabic string is empty",
  dictionaryKeys.filter((key) => !AR[key].trim() && !EMPTY_BY_DESIGN.has(key)),
  [],
);
/* A handful of strings are literal values rather than prose — an email example, a
   reference-code format — so they are meant to be identical in both languages. */
const IDENTICAL_BY_DESIGN = new Set([
  "field.emailPlaceholder",
  "field.emailCoachPlaceholder",
  "field.phonePlaceholder",
  "edit.referencePlaceholder",
]);
check(
  "no Arabic string is still English",
  dictionaryKeys.filter(
    (key) =>
      AR[key] === EN[key] &&
      !IDENTICAL_BY_DESIGN.has(key) &&
      /* Two blank strings are trivially equal, so a deliberate blank would otherwise
         report itself as untranslated text. */
      !EMPTY_BY_DESIGN.has(key),
  ),
  [],
);

console.log("\n── Emails follow the reader's language ──");
/* A student filling the form in Arabic must get Arabic mail. The language cannot
   come from the server — it lives in their browser — so it travels with the request;
   these assert the rendering side of that. */
const codeEn = renderOtpEmail("123456", "player-email", "Team Falcons", "en");
const codeAr = renderOtpEmail("123456", "player-email", "Team Falcons", "ar");

check("the English code subject is English", /verification code/i.test(codeEn.subject), true);
check("the Arabic code subject is Arabic", /[\u0600-\u06FF]/.test(codeAr.subject), true);
check("the English code body is English", /Use this code/.test(codeEn.html), true);
check("the Arabic code body is Arabic", /[\u0600-\u06FF]/.test(codeAr.html), true);
/* The "check your Spam or Junk folder" line used to be printed inside the code
   email. The organiser asked for it to leave: telling someone to go and look in
   their junk folder, in the message they are supposed to be receiving, reads as
   the sender admitting it will not arrive. It stays on the page instead
   (`verify.checkSpam` and `success.checkSpamTitle`), where the person is looking
   for it anyway. */
for (const [language, mail] of [["en", codeEn], ["ar", codeAr]] as const) {
  check(`the ${language} code email does not mention a spam folder`, /Spam|Junk|spam|junk|غير المرغوب/.test(mail.html + mail.text), false);
}
/* And the page still says it — a hint removed from both places would be lost. */
check("the page still offers the spam hint", t("ar", "verify.checkSpam") !== t("en", "verify.checkSpam"), true);
/* Read from the component, not just the dictionary: the key existing proves
   nothing about the form using it, which is the whole reason this file has a
   source scan. */
for (const [file, key] of [
  ["src/components/form/email-verification.tsx", "verify.checkSpam"],
  ["src/components/form/success-panel.tsx", "success.checkSpamTitle"],
  ["src/components/form/edit-flow.tsx", "edit.checkSpam"],
] as const) {
  const source = stripComments(readFileSync(file, "utf8"));
  check(`${file.split("/").pop()} renders ${key}`, source.includes(`t("${key}")`), true);
}

/* A key that exists in both dictionaries and is rendered nowhere is a hint the
   site forgot. `edit.checkSpam` was exactly that: the edit flow never showed it,
   while the email-verification panel and the success panel both did. */
const HINT_KEYS = ["verify.checkSpam", "success.checkSpamTitle", "edit.checkSpam"];
const componentSources = [
  "src/components/form/email-verification.tsx",
  "src/components/form/success-panel.tsx",
  "src/components/form/edit-flow.tsx",
].map((file) => stripComments(readFileSync(file, "utf8")));
for (const key of HINT_KEYS) {
  check(
    `${key} is rendered by a component, not just defined`,
    componentSources.some((source) => source.includes(`t("${key}")`)),
    true,
  );
}
/* And the reverse of the same mistake: none of them may return to the mail. The
   hint is for the page. Banning it from the templates is what keeps a later
   "helpful" reintroduction from undoing the organiser's request. */
const mailSources = ["src/lib/mailer.ts", "src/lib/email-copy.ts", "src/lib/confirmation-email.ts"];
for (const file of mailSources) {
  const source = stripComments(readFileSync(file, "utf8"));
  check(`${file.split("/").pop()} carries no spam hint`, /spam hint|Spam or Junk|checkSpam|غير المرغوب/.test(source), false);
}

console.log("\n── The review step's counts are dictionary keys, not English words ──");
/* The review breakdown was assembled by hand:
     `${counts.starters} starter${counts.starters === 1 ? "" : "s"}`
   so the Arabic review screen read "1 أساسي · 2 substitutes · 1 coach". Every other
   count in the form used a key; this one line did not. */
const reviewSource = stripComments(readFileSync("src/components/form/step-review.tsx", "utf8"));
for (const key of [
  "review.starterOne",
  "review.startersMany",
  "review.subOne",
  "review.subsMany",
  "review.coachOne",
  "review.coachesMany",
] as const) {
  /* `t("key"` and not `t("key")`: the plural forms are called with a count, so the
     call does not close right after the key. */
  check(`the review step renders ${key}`, reviewSource.includes(`t("${key}"`), true);
  check(`${key} is not identical in both languages`, t("ar", key) !== t("en", key), true);
}
/* The plural forms take a count, and the singular ones must not need one. */
for (const [key, count] of [
  ["review.startersMany", 3],
  ["review.subsMany", 2],
  ["review.coachesMany", 1],
] as const) {
  for (const language of ["en", "ar"] as const) {
    const rendered = t(language, key, { count });
    check(`${key} in ${language} shows its count and no placeholder`, rendered.includes(String(count)) && !rendered.includes("{"), true);
  }
}
check("the Arabic code email declares rtl", /dir="rtl"/.test(codeAr.html), true);
check("the English code email declares ltr", /dir="ltr"/.test(codeEn.html), true);
/* The code is a token to be transcribed, not prose to be read, so it stays in
   Western digits in both languages — the same digits the server hashes.
   This used to render ١٢٣٤٥٦ in Arabic, which looked thoughtful and locked every
   Arabic-speaking student out: they typed what they saw and the comparison
   stripped it to nothing. */
check("the Arabic code is rendered in Western digits", codeAr.html.includes("123456"), true);
check("the Arabic code is not rendered in Arabic-Indic digits", codeAr.html.includes(arabicDigits("123456")), false);
check("the code is wrapped in a forced-ltr run", /dir="ltr"[^>]*>\s*123456/.test(codeAr.html), true);
check("the Arabic text form has the same code", codeAr.text.includes("123456"), true);

/* The regression test the bug deserved: read the code back out of the Arabic
   email the way a reader would, normalise it the way the endpoint does, and check
   that it still matches the stored hash. Any future change that shows digits the
   comparison cannot accept fails here rather than in a student's inbox. */
for (const [language, email] of [["ar", codeAr], ["en", codeEn]] as const) {
  const shown = /font-size:34px[^>]*>\s*([0-9\u0660-\u0669\u06f0-\u06f9]{6})/.exec(email.html)?.[1] ?? "";
  const shownHash = await hashCode(digitsOnly(shown), "player@example.test", "player-email");
  const expectedHash = await hashCode("123456", "player@example.test", "player-email");
  check(`the ${language} code round-trips back to the stored hash`, safeEqual(shownHash, expectedHash), true);
}

/* The digit helpers themselves. Arabic-Indic (U+0660) and Extended Arabic-Indic
   (U+06F0) are both real keyboards, and both defeated `\D`. */
check("Arabic-Indic digits fold to Western", toWesternDigits("١٢٣٤٥٦"), "123456");
check("Extended Arabic-Indic digits fold to Western", toWesternDigits("۱۲۳۴۵۶"), "123456");
check("mixed scripts fold together", toWesternDigits("12٣٤56"), "123456");
check("Western digits are untouched", toWesternDigits("123456"), "123456");
check("digitsOnly keeps Arabic-Indic digits", digitsOnly("١٢٣٤٥٦"), "123456");
check("digitsOnly keeps Extended Arabic-Indic digits", digitsOnly("۱۲۳۴۵۶"), "123456");
check("digitsOnly drops spaces and dashes", digitsOnly(" 123-456 "), "123456");
check("digitsOnly of prose is empty", digitsOnly("no digits here"), "");
/* The old bug, stated as its own check: the obvious implementation loses the code. */
check("the ASCII-only form would have lost the code", "١٢٣٤٥٦".replace(/\D/g, ""), "");
check("arabicDigits and toWesternDigits are inverses", toWesternDigits(arabicDigits("482913")), "482913");
check("no English prose leaks into the Arabic code email", /Use this code|expires in/.test(codeAr.html), false);

const confirmEn = buildConfirmationEmail(team, { baseUrl: "https://example.test", language: "en" });
const confirmAr = buildConfirmationEmail(team, { baseUrl: "https://example.test", language: "ar" });

check("the Arabic confirmation declares rtl", /dir="rtl"/.test(confirmAr.html), true);
check("the Arabic confirmation is Arabic", /[\u0600-\u06FF]/.test(confirmAr.html), true);
check("the Arabic confirmation subject is Arabic", /[\u0600-\u06FF]/.test(confirmAr.subject), true);
/* Nothing in the furniture should still be English — the roster labels are the ones
   most likely to be missed, since they live in a helper rather than the template. */
for (const english of [
  "Team leader",
  "The roster",
  "What happens next",
  "REGISTRATION CONFIRMED",
  "Your reference code",
  "Student ID",
  "Discord",
]) {
  check(`"${english}" is translated in the Arabic confirmation`, confirmAr.html.includes(english), false);
}
check("the Arabic reference is still a valid code", confirmAr.html.includes(team.reference), true);
/* The reference and phone numbers must stay LTR even inside an RTL message, or the
   characters render in the wrong order. */
check("the Arabic reference is wrapped in a forced-ltr run", /dir="ltr"[^>]*>\s*KSU-26/.test(confirmAr.html), true);
check("the plain-text version is Arabic too", /[\u0600-\u06FF]/.test(confirmAr.text), true);
check("the plain-text reference survives", confirmAr.text.includes(team.reference), true);
/* An Arabic email must not be *wider* than the English one in any meaningful way —
   both stay well under Gmail's 102 kB clipping limit. */
/* A language-specific branch that quietly added the contact details back would be
   the obvious way to reintroduce the leak, so it is checked in both. */
check("the Arabic confirmation withholds addresses too", confirmAr.html.includes("ali@ksu.edu.sa"), false);
check("the Arabic confirmation withholds phones too", confirmAr.html.includes("+966512345678"), false);
check("the Arabic confirmation still lists the roster", confirmAr.html.includes("Ali Hassan"), true);
check("the Arabic confirmation is under the clipping limit", Buffer.byteLength(confirmAr.html) < 102_400, true);
check("the English confirmation is under the clipping limit", Buffer.byteLength(confirmEn.html) < 102_400, true);
check("English mail is unchanged by the bilingual work", /Team leader/.test(confirmEn.html), true);

/* Whichever language is asked for, the request's choice wins; anything else is the
   default rather than an error, because "we could not tell" must still send mail. */
check("a request's language is used", requestedLanguage({ language: "en" }), "en");
check("an absent language falls back to the default", requestedLanguage({}), DEFAULT_LANGUAGE);
check("an unknown language falls back to the default", requestedLanguage({ language: "fr" }), DEFAULT_LANGUAGE);
check("a non-object body falls back to the default", requestedLanguage(null), DEFAULT_LANGUAGE);

console.log("\n── No message reaches a reader with a raw placeholder ──");
/* A template whose placeholder is never substituted shows `{members}` to a student.
   That happened while building the consent paragraph, so it is checked rather than
   assumed: every message that takes a variable is rendered with the variables its
   caller passes, and the result must contain no braces. */
const substitutionCases: { key: MessageKey; vars: Record<string, string | number> }[] = [
  { key: "wizard.intro", vars: { tournament: "KSU Crown" } },
  { key: "wizard.stepOf", vars: { step: 1, total: 4 } },
  { key: "wizard.fieldsToGo", vars: { count: 3 } },
  { key: "team.nameHint", vars: { max: 40 } },
  { key: "team.gamesOpen", vars: { count: 3 } },
  { key: "game.openForDivision", vars: { division: "x" } },
  { key: "game.mayAdd", vars: { extras: "x" } },
  { key: "game.listJoin", vars: { first: "a", second: "b" } },
  { key: "game.onField", vars: { format: "5v5", count: 5 } },
  { key: "roster.complete", vars: { done: 1, total: 5 } },
  { key: "roster.startersNeeded", vars: { have: 1, want: 5 } },
  { key: "roster.subs", vars: { have: 0, want: 2 } },
  { key: "roster.coaches", vars: { have: 0, want: 1 } },
  { key: "roster.addStarter", vars: { count: 4 } },
  { key: "roster.fieldsAtLeast", vars: { game: "x", count: 5, missing: 4 } },
  { key: "roster.needMore", vars: { max: 6 } },
  { key: "roster.gameFieldsPlayers", vars: { game: "x", count: 5, format: "5v5" } },
  { key: "roster.onlyRegions", vars: { regions: "Riyadh" } },
  { key: "roster.universitiesCount", vars: { count: 2 } },
  { key: "roster.playerN", vars: { n: 1 } },
  { key: "roster.makeLeader", vars: { n: 1 } },
  { key: "roster.roleFor", vars: { role: "x", n: 1 } },
  { key: "verify.sent", vars: { email: "a@b" } },
  { key: "review.rosterN", vars: { count: 5 } },
  { key: "review.memberMany", vars: { count: 5 } },
  { key: "review.declaration", vars: { game: "x" } },
  /* The one that broke: the member phrase AND the link, both substituted. */
  { key: "review.consentBody", vars: { members: "MEMBERS", link: "LINK" } },
  { key: "review.consentMemberMany", vars: { count: 5 } },
  { key: "success.body", vars: { team: "x", tournament: "y" } },
  { key: "success.membersMany", vars: { count: 5 } },
  { key: "edit.codeSent", vars: { email: "a@b" } },
  { key: "edit.savedBody", vars: { team: "x", reference: "R" } },
  { key: "roster.trimmed", vars: { game: "x", count: 5, from: 6, to: 5 } },
  { key: "roster.trimmedOne", vars: { game: "x", count: 1, from: 5, to: 1 } },
  { key: "conflict.row", vars: { value: "a@b", team: "x" } },
  { key: "field.phoneSaved", vars: { phone: "+966" } },
  { key: "summary.issues", vars: { count: 2 } },
  { key: "summary.more", vars: { count: 1 } },
];

const unresolved: string[] = [];
for (const { key, vars } of substitutionCases) {
  for (const language of ["en", "ar"] as const) {
    const rendered = t(language, key, vars);
    if (/\{[a-zA-Z]+\}/.test(rendered)) unresolved.push(`${language}/${key} → ${rendered}`);
  }
}
check("every templated message substitutes all of its variables", unresolved, []);

/* And the reverse: a message with no variables must not be called with the wrong
   ones, which would leave the placeholder visible. */
check(
  "the consent sentence keeps {link} for the component to replace",
  t("ar", "review.consentBody", { members: "M", link: "{link}" }).includes("{link}"),
  true,
);

console.log("\n── No hardcoded English left in the entrant form ──");
/* The tests above prove the *dictionary* is complete, which is not the same as the
   UI using it. Field labels, the role summary and the role names were all still
   English on an Arabic form while every one of those tests passed — so this reads
   the components themselves.

   It looks for English words sitting as literal JSX text (`>Full name<`) and for the
   label constants a component might render without translating. Proper nouns and the
   organiser's own configured text are excluded, since those are not ours to
   translate. */
const FORM_COMPONENTS = [
  "src/components/form/step-team.tsx",
  "src/components/form/step-game.tsx",
  "src/components/form/step-roster.tsx",
  "src/components/form/step-review.tsx",
  "src/components/form/registration-form.tsx",
  "src/components/form/edit-flow.tsx",
  "src/components/form/email-verification.tsx",
  "src/components/form/success-panel.tsx",
  "src/components/form/validation-summary.tsx",
  "src/components/form/registration-wizard.tsx",
];

/** Words that are the same in both languages, or not ours to translate. */
const NOT_UI_COPY = new Set([
  "Record", // a TypeScript generic in a type annotation
  "KSU Crown",
  "Arabic",
  "English",
]);

const hardcoded: string[] = [];

for (const relative of FORM_COMPONENTS) {
  const source = stripComments(readFileSync(relative, "utf8"));

  for (const match of source.matchAll(/>\s*([A-Z][A-Za-z][A-Za-z0-9 ,.'’&:!?()\-/]{2,})\s*</g)) {
    const text = match[1].trim();
    if (NOT_UI_COPY.has(text)) continue;
    hardcoded.push(`${relative}: "${text}"`);
  }

  /* A constant like `MEMBER_ROLE_LABEL[role]` renders English words the moment the
     form is Arabic, and no dictionary test can see it. */
  for (const constant of ["MEMBER_ROLE_LABEL", "GENDER_LABEL"]) {
    const index = source.indexOf(`${constant}[`);
    if (index !== -1) hardcoded.push(`${relative}: renders ${constant}[…] directly`);
  }

  /* A text node, and English.
     It must hold two words, which is what separates copy from an indented tag
     boundary, a bare `&mdash;`, a lowercase fragment or an attribute list.

     Two boundaries, because a text node follows either a tag *or* an expression:
     `{game.format} · {squadSize} on field` puts the English after a `}`, and a scan
     that only looked after `>` walked straight past it — the Arabic review screen read
     "1v1 · 1 on field". Allowing a lowercase start is what makes that visible.

     Deliberately **no alternation and no lookahead**. The first version was
     `(?:[class]|\s)+?` followed by `\s*(?=…)`, and because a space was in the class
     *and* in the alternation the engine could split a run of spaces in exponentially
     many ways: 203 ms on one component, and it hung indefinitely on
     `step-roster.tsx`. A single negated class has one way to match each character. */
  for (const match of source.matchAll(/[>}]([^<>{]+)/g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (NOT_UI_COPY.has(text)) continue;
    if (!/[A-Za-z]{2,}[^A-Za-z0-9_/@.$-]*\s+[A-Za-z]{2,}/.test(text)) continue;
    /* Entities are text, not code — `&apos;` is a semicolon that means an apostrophe,
       and testing the raw string rejected the English copy that used one. */
    const plain = text.replace(/&[a-z]+;|&#\d+;/gi, " ");
    /* Punctuation that appears in code and not in this form's copy. `=` and `{}` are
       here because the run after a `}` inside an opening tag is an attribute list
       (`} required error=…`); prose in this form contains none of them. */
    if (/[()[\]{};=]|=>|&&|\|\||\breturn\b|\bconst\b|\bfunction\b/.test(plain)) continue;
    hardcoded.push(`${relative}: "${text}" (text node)`);
  }

  /* English sitting *inside* a JSX expression rather than as JSX text.
     ``{cond ? a : `Enter the 6-digit code we sent to ${email}.`}`` was English on the
     Arabic edit screen, and no pattern above could see it: the words are in a template
     literal, so there is no `>` for them to follow. */
  for (const match of source.matchAll(/`([^`]{6,})`/g)) {
    const literal = match[1];
    if (!isHandWrittenSentence(literal) && !hasCountedEnglishWord(literal)) continue;
    hardcoded.push(`${relative}: template literal \`${literal.replace(/\s+/g, " ").trim().slice(0, 44)}…\``);
  }

  /* Template literals. `hint` and `label` are just as often expressions as strings,
     and a sentence built from a template literal is English the moment it is not
     read from the dictionary — `Saved as ${formatPhone(…)}` was exactly that. */
  for (const match of source.matchAll(
    /\b(?:title|label|hint|placeholder|aria-label|warning)=\{`([^`]{3,})`\}/g,
  )) {
    const value = match[1].trim();
    if (NOT_UI_COPY.has(value)) continue;
    hardcoded.push(`${relative}: ${match[0]}`);
  }

  /* A template literal standing alone as a JSX child. */
  for (const match of source.matchAll(/\{\s*`([^`]{3,})`\s*\}/g)) {
    const value = match[1].trim();
    /* Only prose. Most template literals in a form are DOM ids and URLs —
       `name-${index}`, `/api/games/${id}/logo` — and those are not copy. A sentence
       has two words separated by whitespace, which none of them do. */
    if (!/[A-Za-z]{2,}[^A-Za-z0-9_/{}$]*\s+[A-Za-z]{2,}/.test(value)) continue;
    hardcoded.push(`${relative}: literal \`${value}\``);
  }

  /* Props too. A label can be English without ever appearing as JSX text —
     `title="Team"` and `label="University"` were both shipped that way, and a scan
     that only looked at `>text<` walked straight past them. */
  for (const match of source.matchAll(
    /\b(?:title|label|hint|placeholder|aria-label|warning)="([A-Z][A-Za-z][A-Za-z0-9 ,.'’&:!?()\-/]{1,})"/g,
  )) {
    const value = match[1].trim();
    if (NOT_UI_COPY.has(value)) continue;
    /* `placeholder="e.g. Falcons"` is an example of a team name, not UI copy — it is
       deliberately the same in both languages, like the email and phone examples. */
    if (/^e\.g\./.test(value)) continue;
    hardcoded.push(`${relative}: ${match[0]}`);
  }
}

check("the form components contain no hardcoded English labels", hardcoded, []);

/* And the reviewer-facing strings do resolve to real translations. */
check("a role name has its own key", [roleLabelKey("STARTER"), roleLabelKey("SUBSTITUTE"), roleLabelKey("COACH")], ["roster.starter", "roster.substitute", "roster.coach"]);
for (const role of ["STARTER", "SUBSTITUTE", "COACH"] as const) {
  const english = t("en", roleLabelKey(role));
  const arabic = t("ar", roleLabelKey(role));
  check(`the ${role} role reads differently in Arabic`, arabic !== english, true);
}

console.log("\n── An organiser's default text still reaches an Arabic reader in Arabic ──");
/* `gameTagLabel` and `gameTagHint` are the organiser's to edit, so they live in the
   config rather than the dictionary. Their *defaults* are English, and the roster step
   rendered them straight through: an Arabic captain read `Game tag` and a sentence
   about Epic IDs in the middle of an Arabic form. The rule is that an untouched
   default is translated and a value the organisers typed is left alone. */
check("the default game tag label is not translated by the config itself", DEFAULT_TOURNAMENT.gameTagLabel, "Game tag");
check("the dictionary knows the game tag label", t("ar", "field.gameTag") !== t("en", "field.gameTag"), true);
check("the dictionary knows the game tag hint", t("ar", "field.gameTagHint") !== t("en", "field.gameTagHint"), true);
/* A value the organisers changed must survive untouched — that is the whole point of
   it being configurable. */
const customTag = normaliseConfig({ ...DEFAULT_TOURNAMENT, gameTagLabel: "Riot ID" });
check("a custom game tag label is kept verbatim", customTag.gameTagLabel, "Riot ID");
check("a custom label differs from the default", customTag.gameTagLabel !== DEFAULT_TOURNAMENT.gameTagLabel, true);

/* Provinces are stored as English keys, so a student-facing sentence that joins
   them read "Only universities in Riyadh are listed" inside an otherwise Arabic
   sentence. `allowedRegions` itself must stay in English — it is the identity used
   by the university table. */
check("a province has an Arabic name", regionLabel("Riyadh", "ar"), "الرياض");
check("a province keeps its English name", regionLabel("Riyadh", "en"), "Riyadh");
check("every province has an Arabic name", SAUDI_REGIONS.filter((region) => !regionLabel(region, "ar")), []);
check("every province's Arabic name is actually Arabic", SAUDI_REGIONS.filter((region) => !/[\u0600-\u06FF]/.test(regionLabel(region, "ar"))), []);
check("no province's Arabic name is the English key", SAUDI_REGIONS.filter((region) => regionLabel(region, "ar") === region), []);
check("the stored keys stay English regardless of language", config.allowedRegions, []);
for (const region of SAUDI_REGIONS) {
  check(`${region} reads differently in Arabic`, regionLabel(region, "ar") !== regionLabel(region, "en"), true);
}

console.log("\n── A student number is digits and nothing else ──");
/* The field is how the organisers look a student up, so it accepts what a
   university actually issues and nothing else. It used to allow letters, dashes
   and 4–20 of them, which is wide enough to type a Discord handle into. */
for (const good of ["445100001", "1234", "1".repeat(STUDENT_ID_MAX)]) {
  check(`${good.length} digits is a valid student number`, STUDENT_ID_PATTERN.test(good), true);
}
for (const bad of [
  "ADM0001",      // letters
  "445100001a",   // letters after digits
  "445-100",      // a dash
  "445 100",      // a space
  "٤٤٥١٠٠٠٠١",   // Arabic-Indic — the client folds these, the server must not store them
  "445.100",
  "445100001#1",
  "123",          // one short
  "1".repeat(STUDENT_ID_MAX + 1), // one long
  "",
]) {
  check(`${JSON.stringify(bad).slice(0, 14)} is not a valid student number`, STUDENT_ID_PATTERN.test(bad), false);
}
/* The input's maxLength is built from the same constant as the rule, so the two
   cannot drift apart. */
check("the pattern is built from the exported bounds", STUDENT_ID_PATTERN.test("1".repeat(STUDENT_ID_MIN)) && !STUDENT_ID_PATTERN.test("1".repeat(STUDENT_ID_MIN - 1)), true);
check("the message states the new rule", /numbers/.test(t("en", "field.studentIdHint")) && !/letters/.test(t("en", "field.studentIdHint")), true);
check("the Arabic hint states the new rule", /رقم/.test(t("ar", "field.studentIdHint")), true);

console.log("\n── A Latin field carries its own direction, badge included ──");
/* The duplicate badge is pinned with logical `end-3`, and the input it floats in
   pads its logical *inline end*. Those agree only when both resolve `end` the same
   way. In Arabic the wrapper inherited RTL, so the badge moved to the left — over
   the digits — while the input still reserved its room on the right. Proved in a
   browser: the "available" tick sat on top of the student number.
 *
 * The rule is that a wrapper must agree with the input it contains, so a field
 * pinned `dir="ltr"` needs its wrapper pinned too. Free text that may legitimately
 * be Arabic — the team name — is deliberately *not* pinned, and its badge flipping
 * with the paragraph is correct. */
const LTR_FIELDS = [
  { file: "src/components/form/step-roster.tsx", id: "email-${index}", what: "the email" },
  { file: "src/components/form/step-roster.tsx", id: "id-${index}", what: "the student number" },
];
for (const { file, id, what } of LTR_FIELDS) {
  const source = stripComments(readFileSync(file, "utf8"));
  const idAt = source.indexOf(`id={\`${id}\`}`);
  if (idAt === -1) {
    check(`${what} field was found in ${file}`, true, false);
    continue;
  }
  /* Back up to the wrapper div and the input's own opening tag — `idAt` points at
     the id, which is *inside* the `<Input`, so a slice forward from it would not
     contain the tag name. */
  const wrapperAt = source.lastIndexOf("<div", idAt);
  const tag = source.slice(wrapperAt, source.indexOf(">", wrapperAt) + 1);
  const inputAt = source.lastIndexOf("<Input", idAt);
  const inputTag = source.slice(inputAt, source.indexOf(">", inputAt) + 1);
  check(`${what} input is pinned ltr`, /\bdir="ltr"/.test(inputTag), true);
  check(`${what} wrapper is pinned ltr to match`, /\bdir="ltr"/.test(tag), true);
}

/* And the badge itself must stay logical — a physical `right-3` would be correct
   in English and wrong in Arabic. */
const badgeSource = stripComments(readFileSync("src/components/form/duplicate-badge.tsx", "utf8"));
check("the badge is positioned logically", /\bend-3\b/.test(badgeSource), true);
check("the badge uses no physical side", /\b(?:left|right)-\d/.test(badgeSource), false);

console.log("\n── IBM Plex in both scripts, and each language gets its own ──");
/* The typeface rules are CSS, so nothing in the render path can be unit-tested
   directly. What can be checked is the structure they depend on, and that structure is
   where the bugs were:

   - `font-family: var(--font-sans)` on `body` beat the per-language rule, because a
     declaration on `body` wins over what `body` would inherit.
   - `--font-display` was both the raw family and the composed list, so a rule that
     named the raw family read its own property — invalid at computed-value time, and
     the winner between the two was decided by source order.
   - Neither rule could be reached from the Arabic document by a subtree declaring
     English, because custom properties inherit: the English block inside the Arabic
     privacy notice and the organiser console both came out in the wrong face. */
const css = readFileSync("src/app/globals.css", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* Both families are declared from files this repository serves itself. A CDN or a
   `next/font` fetch puts a third party on the critical path, and a network that blocks
   it leaves the whole site in the fallback face. */
check("Latin is self-hosted as IBM Plex Sans",
  /@font-face\s*\{[^}]*font-family:\s*"IBM Plex Sans"/.test(css), true);
check("Arabic is self-hosted as IBM Plex Sans Arabic",
  /@font-face\s*\{[^}]*font-family:\s*"IBM Plex Sans Arabic"/.test(css), true);
check("the Arabic family also ships a Latin subset, so mixed text stays even",
  /font-family:\s*"IBM Plex Sans Arabic"[^}]*plex-sans-arabic-latin-\d{3}-normal\.woff2/.test(css), true);
check("…and the Arabic subset is scoped by unicode-range, so English never downloads it",
  /font-family:\s*"IBM Plex Sans Arabic"[^}]*unicode-range:\s*U\+0600-06FF/.test(css), true);

/* Only the weights the interface paints. Nothing is synthesised from a missing one. */
for (const weight of ["400", "500", "600", "700"]) {
  check(`IBM Plex ${weight} is declared`,
    new RegExp(`font-family:\\s*"IBM Plex Sans";[^}]*font-weight:\\s*${weight};`).test(css), true);
  check(`IBM Plex Sans Arabic ${weight} is declared`,
    new RegExp(`font-family:\\s*"IBM Plex Sans Arabic";[^}]*font-weight:\\s*${weight};`).test(css), true);
}

/* Every referenced file must actually exist: a typo in a `src:` url fails silently at
   runtime — the browser just falls back, which is exactly the bug this catches. */
const fontFiles = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map((match) => match[1]);
check("the stylesheet references at least one font file per family", fontFiles.length >= 12, true);
for (const href of new Set(fontFiles)) {
  check(`${href} is present in public/`, existsSync(join("public", href)), true);
}

/* The default family must be on `html`, or the language rules cannot displace it. */
check("the default family is declared on html, not body", /html\s*\{[^}]*font-family:\s*var\(--font-sans\)/.test(css), true);
check("body carries no font-family", /body\s*\{[^}]*font-family/.test(css), false);

/* The raw families must not share a name with the composed lists. */
check("the Latin family has its own variable name", /--font-plex-sans:/.test(css), true);
check("the Arabic family has its own variable name", /--font-plex-arabic:/.test(css), true);
check("the composed default points at the Latin family", /--font-sans:\s*var\(--font-plex-sans\)/.test(css), true);
check("no rule makes --font-sans refer to itself", /--font-sans:\s*var\(--font-sans\)/.test(css), false);

/* Both directions, declared as properties so a subtree can opt out. */
check("Arabic declares its own font-family", /\[lang="ar"\]\s*\{[^}]*font-family:\s*var\(--font-plex-arabic\)/.test(css), true);
check("English declares font-family too, to stop inheriting Arabic", /\[lang="en"\]\s*\{[^}]*font-family:\s*var\(--font-plex-sans\)/.test(css), true);

/* The monospace face is a Latin token renderer in both languages. */
check("Arabic leaves --font-mono alone", /\[lang="ar"\][^}]*--font-mono/.test(css), false);

/* Headings. IBM Plex's 400 is an ordinary text weight, so the family swap alone
   flattened the hierarchy; both scripts are asked for the heaviest weight shipped. */
check("Arabic headings are given a heavy weight", /\[lang="ar"\]\s*\.font-display\s*\{[^}]*font-weight:\s*700/.test(css), true);
check("English headings are heavy too", /\[lang="en"\]\s*\.font-display\s*\{[^}]*font-weight:\s*700/.test(css), true);
check("English headings use the Latin family", /\[lang="en"\]\s*\.font-display\s*\{[^}]*var\(--font-plex-sans\)/.test(css), true);

/* The old stack is gone, not merely overridden. A leftover Google font import would
   still be downloaded and could still win by source order. */
for (const gone of ["Tajawal", "Archivo_Black", "Inter,"]) {
  check(`${gone} is no longer loaded`, layout.includes(gone), false);
}
check("no next/font family is left for the body face", /from "next\/font\/google"/.test(layout) === false || /JetBrains_Mono/.test(layout), true);

console.log("\n── The English-only console declares itself English ──");
/* `lang` does double duty: the typeface rules key off it, and a screen reader uses it
   to choose a voice. The console is English-only but renders inside a document whose
   language follows the *entrant* form, so it has to say so. */
const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
check("the console pins its language as well as its direction", /<div[^>]*dir="ltr"[^>]*lang="en"/.test(adminPage), true);

console.log("\n── The footer's blocked-step line reaches the reader in their language ──");
/* `stepSummary` returns a message straight out of `validateDraft`, which emits English
   because it also runs on the server. The footer rendered it raw, so the Arabic game
   step read "Choose a game" while the identical field error beside it read
   "اختر لعبة" — one string, two languages, same screen. */
const formSource = stripComments(readFileSync("src/components/form/registration-form.tsx", "utf8"));
check("the blocked-step line is translated", /message\(stepSummaryText\)/.test(formSource), true);
check("it is not rendered raw", /\{\s*stepSummary\(step, allErrors\)\s*\}/.test(formSource), false);
/* And the message itself has a translation, which is the half that was already right. */
for (const message of ["Choose a game", "Choose a game from the list"]) {
  check(`"${message}" has an Arabic translation`, translateMessage(message, "ar") !== message, true);
}


console.log("\n── Security: the server enforces what the form offers ──");
/* Regression tests for the October 2026 security audit. Each one is a rule a
   hand-made request could previously get around. */
{
  const secured = normaliseConfig({ ...DEFAULT_TOURNAMENT, hiddenUniversities: ["seu"], allowedRegions: [] });
  const gameId = secured.games[0]?.id ?? "";
  const member = (universityId: string) => ({
    fullName: "Ali Ahmed", gameTag: "AliA", universityId, email: "ali@ksu.edu.sa", emailProof: "x",
    studentId: "441234567", discord: "ali.1", phone: "0512345678", role: "STARTER",
  });
  const universityError = (universityId: string, gender: "male" | "female") => {
    const result = validatePayload(
      { teamName: "Falcons", gender, gameId, leaderIndex: 0, consentGiven: true, members: [member(universityId)] },
      secured,
      { verifyEmail: () => true },
    );
    return result.ok ? null : result.errors["member.0.university"] ?? null;
  };
  check("a hidden university is refused", universityError("seu", "male"), "This university is not available for this section");
  check("a women-only university is refused in the male division", universityError("pnu", "male"), "This university is not available for this section");
  check("a women-only university is accepted in the female division", universityError("pnu", "female"), null);
  check("an open university is accepted", universityError("ksu", "male"), null);

  const flood = validatePayload(
    { teamName: "Falcons", gender: "male", gameId, members: Array.from({ length: 500 }, () => member("ksu")) },
    secured,
    { verifyEmail: () => true },
  );
  check("an oversized roster is refused", !flood.ok && /at most \d+ members/.test(flood.errors.members ?? ""), true);
  check("…before any member is validated", !flood.ok && Object.keys(flood.errors).some((key) => key.startsWith("member.")), false);

  for (const text of [
    "This university is not available for this section",
    "A roster may have at most 6 members",
    "Registration is closed.",
    "Registration is closed, so registrations can no longer be edited.",
    "That request is too large.",
    "We have already sent several codes for this registration. Please wait 15 minutes, then try again.",
    "We found your registration, but could not reach the email service to send the code to al***@ksu.edu.sa.",
  ]) {
    check(`"${text.slice(0, 48)}…" has an Arabic translation`, hasArabicMessage(text), true);
  }
  check("the Arabic lookup failure does not leave English behind", translateMessage("We found your registration, but could not reach the email service to send the code to al***@ksu.edu.sa.", "ar").includes("your registration"), false);
}

console.log("\n── Security: exports and emails cannot carry live markup ──");
check("a formula in exported text is defused", plainText("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
check("a leading minus is defused", plainText("-2+3"), "'-2+3");
check("a leading @ is defused", plainText("@SUM(1)"), "'@SUM(1)");
check("ordinary text is untouched", plainText("Team Falcons"), "Team Falcons");
check("a single quote is escaped in email HTML", escapeHtml("O'Neil"), "O&#39;Neil");

console.log("\n── Security: the API routes keep their guards ──");
{
  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  const checkRoute = read("src/app/api/registrations/check/route.ts");
  check(
    "a bare reference no longer exempts a team",
    /readProof\(editProof\)/.test(checkRoute) && /scope\?\.teamId === team\.id/.test(checkRoute),
    true,
  );
  check("emails need a proof before they are checked", /verifyProof\(proof, key, "player-email"\)/.test(checkRoute), true);
  check("creating refuses when registration is closed", /!config\.registrationOpen/.test(read("src/app/api/registrations/route.ts")), true);
  check("editing refuses when registration is closed", /!config\.registrationOpen/.test(read("src/app/api/registrations/[reference]/route.ts")), true);
  const lookup = read("src/app/api/registrations/lookup/route.ts");
  const codeSent = /stage: "code-sent",[\s\S]*?\}\);/.exec(lookup)?.[0] ?? "";
  check("the code-sent reply does not name the team", codeSent.length > 0 && !/teamName/.test(codeSent), true);
  check("edit codes have a durable per-team cap", /countRecentOtps\(normalised, "edit-access"/.test(lookup), true);
  const auth = read("src/lib/admin-auth.ts");
  check("a request with no admin code is not counted as a guess", /!candidate\.trim\(\)\)\s*\{\s*return \{ ok: false, retryAfterSeconds: 0 \}/.test(auth), true);
  check("API responses are not cacheable", /\/api\/:path[^"]*"[\s\S]{0,80}no-store/.test(readFileSync("next.config.mjs", "utf8")), true);
  check("mail refuses to fall back to plaintext", /requireTLS:/.test(read("src/lib/mailer.ts")), true);
}


console.log("\n── Security: deep-test regressions ──");
{
  const link = (policyUrl: string) => normaliseConfig({ ...DEFAULT_TOURNAMENT, policyUrl }).policyUrl;
  check("a site path is kept as the privacy link", link("/privacy"), "/privacy");
  check("an https privacy link is kept", link("https://example.org/notice"), "https://example.org/notice");
  check("a javascript: privacy link is refused", link("javascript:alert(1)"), "/privacy");
  check("a data: privacy link is refused", link("data:text/html,x"), "/privacy");
  check("a protocol-relative privacy link is refused", link("//evil.example/x"), "/privacy");

  const scoped = await makeProof("lead@ksu.edu.sa", "edit-access", "team-a");
  check("an edit proof opens its own team", await verifyProof(scoped, "lead@ksu.edu.sa", "edit-access", "team-a"), true);
  check("an edit proof does not open another team", await verifyProof(scoped, "lead@ksu.edu.sa", "edit-access", "team-b"), false);
  check("an edit proof is not an unscoped proof", await verifyProof(scoped, "lead@ksu.edu.sa", "edit-access"), false);
  check("a player proof still verifies unscoped", await verifyProof(await makeProof("p@ksu.edu.sa", "player-email"), "p@ksu.edu.sa", "player-email"), true);

  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  for (const route of ["src/app/api/otp/verify/route.ts", "src/app/api/registrations/lookup/route.ts"]) {
    const source = read(route);
    check(`${route.split("/").slice(-2, -1)[0]}: a guess is spent atomically before comparing`, /claimOtpAttempt\(record\.id, OTP_MAX_ATTEMPTS\)[\s\S]*safeEqual\(\s*(await\s+)?hashCode/.test(source), true);
    check(`${route.split("/").slice(-2, -1)[0]}: a code is consumed only once`, /consumeOtpOnce\(record\.id\)/.test(source), true);
  }
  check("a site-wide cap backs up the per-address admin lockout", /countAllAdminFailures\(since\)\) >= ADMIN_GLOBAL_MAX_FAILURES/.test(read("src/lib/admin-auth.ts")), true);
  check("no codes are mailed once registration has closed", /registrationOpen/.test(read("src/app/api/otp/request/route.ts")), true);
  for (const text of ["That code has already been used. Ask for a new code.", "That code has already been used. Start again to get a new code."]) {
    check(`"${text.slice(0, 40)}…" has an Arabic translation`, hasArabicMessage(text), true);
  }
}

console.log("\n── The rules acknowledgement ──");
/* Two promises are made before an entry is accepted: consent (personal data) and
   accepting the tournament rules (conduct). Both are asserted in the draft *and* on
   the server, because reading a rulebook is an assertion nothing can verify — but
   requiring the assertion is what makes the step real rather than decorative. */
{
  const accepted = draft([{ ...verified }], { rulesAccepted: true });
  const notAccepted = draft([{ ...verified }], { rulesAccepted: false });

  check("the draft is refused without the rules acknowledgement",
    typeof validateDraft(notAccepted, config).errors.rules, "string");
  check("the draft passes with it",
    validateDraft(accepted, config).errors.rules, undefined);
  /* Unconditional — unlike the rulebook *document*, the rules themselves exist
     whether or not a PDF has been published. */
  check("it is required even with no rulebook published",
    typeof validateDraft(notAccepted, config).errors.rules, "string");

  const base = {
    tournamentName: "KSU Crown", teamName: "Falcons", gender: "male",
    gameId: "ea-fc-26", gameName: "EA FC", leaderIndex: 0,
    consentGiven: true, members: [{
      fullName: "Ali Hassan", gameTag: "A#1", universityId: "ksu",
      email: "a@student.ksu.edu.sa", emailProof: "x", studentId: "445123456",
      discord: "ali", phone: "0512345678", role: "STARTER",
    }],
  };
  const refused = validatePayload({ ...base, rulesAccepted: false }, config, { verifyEmail: () => true });
  check("the API refuses a submission without it",
    !refused.ok && typeof refused.errors.rules, "string");
  const allowed = validatePayload({ ...base, rulesAccepted: true }, config, { verifyEmail: () => true });
  check("the API accepts one with it", allowed.ok, true);
  /* Absent (not false) must be refused too — a client omitting the field is exactly
     the case this guards. */
  const omitted = validatePayload(base, config, { verifyEmail: () => true });
  check("the API refuses a submission that omits it entirely",
    !omitted.ok && typeof omitted.errors.rules, "string");

  /* It belongs to the review step, where the box is, or the captain would be blocked
     from a step they cannot fix — the deadlock consent had. */
  check("the rules error belongs to the review step", fieldStep("rules"), STEP_COUNT - 1);
  const rulesOnly = { rules: "Please confirm you have read the rulebook and agree to the rules" };
  for (let step = 0; step < STEP_COUNT - 1; step += 1) {
    check(`the rules error alone does not block step ${step + 1}`, isStepValid(step, rulesOnly), true);
  }
  check("the rules error alone blocks the review step", isStepValid(STEP_COUNT - 1, rulesOnly), false);

  check("the rules error has an Arabic translation",
    hasArabicMessage("Please confirm you have read the rulebook and agree to the rules"), true);
  check("and it reads differently in Arabic",
    translateMessage("Please confirm you have read the rulebook and agree to the rules", "ar") !==
      "Please confirm you have read the rulebook and agree to the rules", true);
}

console.log("\n── The rulebook tab and viewer ──");
{
  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  const wizard = read("src/components/form/registration-wizard.tsx");
  check("the rulebook is a tab, next to the two registration modes",
    /rulebook\.tab/.test(wizard) && /wizard\.newTab/.test(wizard) && /wizard\.editTab/.test(wizard), true);
  /* Always present, even before a document is published.
     It used to be conditional on one existing, on the reasoning that there is nothing
     to read without it — which was wrong in practice: the tab is how anyone discovers
     the rulebook exists, so hiding it meant the organiser could not find where to put
     the PDF. The panel explains the empty state instead. */
  check("the rulebook tab does not depend on a document existing",
    /rulebook\s*\?\s*\[\s*\{\s*id: "rules"/.test(wizard), false);
  check("the panel has an empty state",
    /rulebook\.notPublished/.test(read("src/components/form/rulebook-panel.tsx")), true);
  check("the empty state is translated",
    t("ar", "rulebook.notPublished") !== t("en", "rulebook.notPublished"), true);
  /* The form must survive a trip to the rules: unmounting it would discard every
     answer typed so far, because only the draft is persisted, not the component. */
  check("the form stays mounted behind the rulebook",
    /tab === "rules" \? "hidden"/.test(wizard), true);
  check("the viewer reports when the document has been read to the end",
    /onViewed/.test(wizard) && /onReadToEnd/.test(read("src/components/form/rulebook-panel.tsx")), true);
  /*
   * The way back to the form.
   *
   * Reading the rules is something this page asks the captain to leave the form to do, so
   * the page has to offer the way back. The tab bar technically does — but that tab is
   * labelled "New registration", which reads as *start over* to somebody who has just
   * filled in a whole form. Without an explicit button, the likeliest outcome is a captain
   * abandoning at the last step.
   */
  {
    const panel = read("src/components/form/rulebook-panel.tsx");
    check("the panel offers a way back to the form",
      /onContinue/.test(panel) && /rulebook\.continue/.test(panel), true);
    check("that button is gated on the document having been read to the end",
      /disabled=\{!hasRead\}/.test(panel), true);
    /* Per game, because it gates that game's box: reading Rocket League's rules must not
       present Rocket League's button as read while the reader is looking at EA FC. */
    check("the gate is per game, not a single flag",
      /const hasRead = current \? viewed\.has\(current\.id\) : false/.test(panel), true);
    check("the unlock is translated",
      t("ar", "rulebook.continue") !== t("en", "rulebook.continue"), true);

    /* Returning must restore the *form they were using and the step they were on*. The
       step is inside the form, which is hidden rather than unmounted, so switching back to
       `formTab` is what restores it — hard-coding "register" would send an editing captain
       to the wrong form. */
    check("returning uses the remembered form tab",
      /setTab\(formTab\)/.test(wizard), true);
    check("returning does not hard-code the register tab",
      /const backToForm = React\.useCallback\(\(\) => \{\s*setReadingGame\(null\);\s*setTab\("register"\)/.test(wizard),
      false);
    check("the wizard passes the callback to the panel",
      /onContinue=\{backToForm\}/.test(wizard), true);
    /* `viewedGames` is passed down because the panel unmounts on every tab switch — a
       local `useState` would forget, and the way back would re-lock itself. */
    check("the panel is told which games have been viewed",
      /viewed=\{viewedGames\}/.test(wizard), true);
  }
  /* Always shown, not only when a rulebook exists: the second promise covers the
     rules themselves, which stand even before a PDF is published. */
  check("the review step always shows the acknowledgement",
    /<RulesField/.test(read("src/components/form/step-review.tsx")), true);
  /* Locked only when *the team's own game* has a rulebook that has not been shown.
     Reading one game's rules says nothing about another's. */
  check("the box is locked per game, not globally",
    /hasRulebook=\{Boolean\(rulebooks\[draft\.gameId\]\)\}/.test(read("src/components/form/step-review.tsx")), true);
  check("it unlocks on the team's own game",
    /unlocked=\{gamesRead\?\.has\(draft\.gameId\)/.test(read("src/components/form/step-review.tsx")), true);
  /* The acknowledgement links to that game's rulebook. */
  check("the acknowledgement links to the game's rulebook",
    /onOpenRulebook\(gameId\)/.test(read("src/components/form/step-review.tsx")), true);
  /* …and the sentence it lives in must still *contain* the placeholder. Interpolating
     the game name first leaves `withLink` with nothing to split on: it returns the
     plain sentence, the link disappears, and nothing anywhere reports a problem. The
     marker therefore has to survive into the string handed to `withLink`. */
  {
    const review = read("src/components/form/step-review.tsx");
    check("the linked sentence keeps its placeholder",
      /withLink\(linkedLabel, "\{game\}"/.test(review), true);
    check("the linked sentence is built with the marker intact",
      /t\("rules\.acceptWithRulebook", \{ game: "\{game\}" \}\)/.test(review), true);
    /* The consent line sets the precedent, and is what a reader copies from. */
    check("the consent link keeps its placeholder too",
      /link: "\{link\}"/.test(review), true);
    /* The member phrase is inside consentBody, so printing it again underneath the
       sentence repeats it to every reader and doubles the checkbox's accessible name. */
    check("the consent sentence is not printed twice",
      /\{members\}<\/span>/.test(review), false);
  }

  /*
   * Reading to the end, rather than merely opening.
   *
   * The acknowledgement used to unlock when the PDF iframe fired `load`, which is to say
   * when the tab was opened — not when anything was read. Nothing inside a native PDF
   * frame can report scrolling, so the pages are drawn onto canvases by `pdfjs-dist` and
   * the container's own scroll position becomes the signal.
   */
  {
    const reader = read("src/components/form/rulebook-reader.tsx");
    const pkgScripts = (JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;

    check("the reader draws the pages itself",
      /pdfjs-dist\/legacy\/build\/pdf\.mjs/.test(reader), true);
    /* Imported inside the effect: the renderer is about a megabyte and only the rules tab
       needs it, so a static import would put it in every visitor's bundle. */
    check("the renderer is loaded only when the tab is opened",
      /await import\(\s*"pdfjs-dist\//.test(reader), true);
    /*
     * The worker is named by a **fixed** path under `public/`, not derived from
     * `import.meta.url`.
     *
     * The derived form becomes a content-hashed `/_next/static/media/…` path, which makes
     * the worker's location a build artefact that has to agree across Next's asset
     * pipeline *and* OpenNext's — two manifests, one filename. A constant under `public/`
     * is served identically by both, so the reader cannot end up pointing at a file the
     * deployed host does not have.
     */
    check("the worker is served from this origin at a fixed path",
      /workerSrc = "\/pdfjs\/pdf\.worker\.min\.mjs"/.test(reader), true);
    check("…and is not resolved through import.meta.url",
      /new URL\(\s*"pdfjs-dist/.test(reader), false);
    check("the worker file is copied alongside the other assets",
      existsSync("public/pdfjs/pdf.worker.min.mjs"), true);

    /* The document is fetched as bytes rather than streamed by pdf.js: a partial or
       re-encoded range response from an edge proxy yields mangled glyphs, not an error. */
    check("the document is fetched as bytes", /arrayBuffer\(\)/.test(reader), true);
    check("…and handed to pdf.js as data", /data: bytes/.test(reader), true);
    check("…and the %PDF- magic number is checked", /%PDF-/.test(reader), true);

    /*
     * And the one check that makes "corrupted text" impossible to *show*: pdf.js does not
     * throw when font data cannot be decoded, it draws `.notdef` and yields U+FFFD. If page
     * one contains one, the reader falls back to the browser's viewer instead.
     */
    check("undecodable text is detected before drawing",
      /getTextContent\(\)/.test(reader) && /uFFFD/.test(reader), true);


    /*
     * **Non-Latin text needs the CMap and standard-font assets.**
     *
     * A PDF can embed its font (safe) or refer to a predefined CMap / one of the fourteen
     * standard fonts (needs a lookup). Without `cMapUrl` and `standardFontDataUrl` that
     * lookup fails and Arabic renders as garbage — "the words are corrupted" — rather than
     * as visibly missing glyphs, so the failure looks like a broken document instead of a
     * missing setting. Two of the three stored rulebooks embed their fonts and render
     * correctly either way, which is exactly why the setting is easy to omit and only
     * noticed on the next upload.
     */
    check("CMaps are configured", /cMapUrl:\s*"\/pdfjs\/cmaps\/"/.test(reader), true);
    check("…and are the packed form pdf.js ships", /cMapPacked:\s*true/.test(reader), true);
    check("standard fonts are configured",
      /standardFontDataUrl:\s*"\/pdfjs\/standard_fonts\/"/.test(reader), true);
    /* The assets have to be on disk, or the URLs above are decoration. */
    /* A real shipped table, not `Identity-H`: that one needs no external file, which is
       why this class of bug hides — the PDFs that break are the ones using a *named*
       CMap, and Identity-H is the form that already works. */
    check("the CMap assets are present",
      existsSync("public/pdfjs/cmaps/78-H.bcmap"), true);
    check("the standard fonts are present",
      existsSync("public/pdfjs/standard_fonts/FoxitFixed.pfb"), true);
    /* Copied, not hand-maintained: a stale copy from another pdf.js release would map
       code points differently, which is worse than having none. */
    check("a script keeps them in step with pdfjs-dist",
      existsSync("scripts/copy-pdfjs-assets.mjs"), true);
    check("the build copies them", /pdfjs:assets/.test(pkgScripts.build), true);
    check("the Cloudflare build copies them", /pdfjs:assets/.test(pkgScripts["build:cloud"]), true);
    check("a fresh install copies them", /pdfjs:assets/.test(pkgScripts.postinstall), true);
    /* A PDF is a program to a viewer, and this one is rendered beside the session cookie. */
    check("nothing in the document is evaluated",
      /isEvalSupported: false/.test(reader), true);

    /*
     * **The fix for "the rulebook is corrupted in Arabic".**
     *
     * Not a font problem and not a document problem: the same file renders correctly in
     * Chrome's own viewer. pdf.js registers an embedded font as a `FontFace` and lets the
     * *browser* lay the string out — but a PDF of Arabic stores the already-joined
     * presentation forms (`ﺔ`, `ﻦ`) and states each glyph's advance width. Shaping them a
     * second time in the browser pulls the letters apart and splits words, and it does it
     * to Latin too ("ROCK ET LEAGU E"), which is the tell.
     *
     * `disableFontFace` makes pdf.js paint the glyph *outlines* at their stated
     * positions instead. The cost is that text is no longer selectable in the reader; the
     * download button beside it covers the case where someone wants the text.
     */
    check("glyphs are drawn as outlines, not re-shaped by the browser",
      /disableFontFace:\s*true/.test(reader), true);
    /* Typed locally, so it has to be declared as well as passed — otherwise the parameter
       object is a type error rather than a silent no-op. */
    check("…and the local pdf.js type allows it",
      /disableFontFace\?:\s*boolean/.test(reader), true);

    check("reaching the bottom is what unlocks the acknowledgement",
      /scrollHeight - container\.scrollTop - container\.clientHeight/.test(reader), true);
    /* A short document offers nothing to scroll; demanding a gesture the layout does not
       provide would be a dead end. */
    check("a document that fits unlocks without a scroll",
      /scrollHeight <= container\.clientHeight/.test(reader), true);
    /* The signal is reported once. Two sections of the page read it, and a second report
       after the reader has scrolled back up would be noise, not information. */
    check("the reader reports only once",
      /if \(reported\.current\) return;/.test(reader), true);
    /* The reader is a nicety; the rulebook is not. A viewer that cannot start must not be
       able to block a registration. */
    check("a reader that cannot start falls back to the browser viewer",
      /status === "failed"/.test(reader) && /<iframe/.test(reader), true);
    check("the fallback still reports the document as reached",
      /onLoad=\{report\}/.test(reader), true);
    check("the scrolling instruction is translated",
      t("ar", "rulebook.scrollHint") !== t("en", "rulebook.scrollHint"), true);
  }

  /* A PDF only renders in the frame if the response may be framed *by this site*.
     The site-wide DENY would refuse it, same-origin or not — so the exception is
     load-bearing, not tidiness. */
  const config = readFileSync("next.config.mjs", "utf8");
  check("the blanket frame denial excludes the rulebook",
    /source: "\/:path\(\(\?!api\/games\/\[\^\/\]\+\/rulebook\)/.test(config), true);
  check("every game's rulebook may be framed by this site",
    /source: "\/api\/games\/:gameId\/rulebook"/.test(config) && /X-Frame-Options", value: "SAMEORIGIN"/.test(config), true);
}

console.log("\n── Staff access ──");
{
  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  const staffRoute = read("src/app/api/admin/staff/route.ts");
  check("the allowlist is owner-only, not merely hidden",
    /isOwnerRequest/.test(staffRoute) && !/isAdminRequest/.test(staffRoute), true);
  check("the allowlist is not gated by the student email rule",
    /STAFF_EMAIL_PATTERN/.test(staffRoute) && !/from "@\/lib\/validation"/.test(staffRoute), true);

  /* The gate: an address with no grant must be refused *before* a code is minted, or
     the OTP table would hold codes for people who are not allowed in. */
  const request = read("src/app/api/admin/staff/request/route.ts");
  check("a non-granted address is refused before any code is created",
    request.indexOf("await findLiveStaffAccess(") < request.indexOf("await createOtp("), true);
  check("no code is sent when the address is refused",
    /if \(!grant\)[\s\S]{0,200}status: 403/.test(request), true);

  /* Revocation has to bite immediately, not when an in-flight code expires. */
  const verify = read("src/app/api/admin/staff/verify/route.ts");
  check("the grant is re-checked when the code is redeemed",
    /findLiveStaffAccess/.test(verify), true);

  /* Staff are code, not secret: a staff session must not open owner-only routes. */
  /* Exactly one section is reserved: the staff list. Handing out access is how access
     spreads, so it stays with the grand admin; everything else a granted helper needs
     to run the tournament is shared. */
  check("the staff list requires the owner",
    /isOwnerRequest/.test(read("src/app/api/admin/staff/route.ts")), true);
  check("the staff list is the only owner-only route",
    /isOwnerRequest/.test(read("src/app/api/config/route.ts")) ||
      /isOwnerRequest/.test(read("src/app/api/admin/games/[gameId]/logo/route.ts")),
    false);
  /* Everything else is open to any signed-in admin. */
  for (const anyAdmin of [
    "src/app/api/config/route.ts",
    "src/app/api/admin/games/[gameId]/logo/route.ts",
    "src/app/api/admin/games/[gameId]/rulebook/route.ts",
    "src/app/api/admin/registrations/route.ts",
    "src/app/api/admin/teams/[id]/route.ts",
    "src/app/api/admin/export/sheets/route.ts",
  ]) {
    check(`${anyAdmin.split("/").slice(-2, -1)[0]} accepts staff`, /isAdminRequest/.test(read(anyAdmin)), true);
  }
  /* And the console renders the same split, so a staff session is not shown a tab
     whose every request would fail. */
  const consoleSource = read("src/components/admin/admin-console.tsx");
  const ownerOnlyTabs = [...consoleSource.matchAll(/label: "([^"]+)", icon: \w+, ownerOnly: true/g)];
  /* Two: granting access, and the credential that grants it. Everything else is shared,
     because a helper has to be able to run the tournament. */
  check("only the access and password tabs are owner-only in the console",
    ownerOnlyTabs.map((match) => match[1]), ["Staff access", "Password"]);
  /* A staff session must not be able to sit on either — the effect that moves them off is
     what stops the console rendering an empty content area. */
  check("staff are moved off both owner-only tabs",
    /role === "staff" && \(tab === "staff" \|\| tab === "password"\)/.test(consoleSource), true);

  /* `PUT /api/config` accepts any signed-in admin, so the Save bar must be offered to
     staff. It was owner-only once, and then hidden on the Registrations tab — which is
     where a staff session *lands* — so a staff member could open the console and never
     see a save control at all. The bar is now pinned on every tab that is not owner-only,
     which is the property asserted here. */
  check("staff always have a save control, on every shared tab",
    /!TABS\.find\(\(entry\) => entry\.id === tab\)\?\.ownerOnly &&/.test(consoleSource), true);
  check("…with no tab-specific exception hiding it",
    /tab !== "registrations" &&/.test(consoleSource), false);
  check("…and the bar still carries the save action",
    /Save changes/.test(consoleSource), true);

  /* Hiding a tab is cosmetic. Every owner-only section must also be refused by the route
     behind it, or a hidden-but-open endpoint is the worst of both: invisible to the person
     who should be using it, and reachable by anyone who reads the source. Driven from the
     tab list above, so a new owner-only tab fails this until its route is guarded too. */
  const OWNER_ONLY_ROUTES: Record<string, string> = {
    "Staff access": "src/app/api/admin/staff/route.ts",
    Password: "src/app/api/admin/password/route.ts",
  };
  for (const [label, route] of Object.entries(OWNER_ONLY_ROUTES)) {
    const source = stripComments(read(route));
    check(`${label}: the route behind the tab is owner-only`,
      /isOwnerRequest/.test(source), true);
    /* Not merely "an admin check": isOwnerRequest is the one that refuses a staff session. */
    check(`${label}: it does not accept any signed-in admin`,
      /isAdminRequest/.test(source), false);
  }
  /* Every method on the password route must be guarded. A GET left open leaks when the
     password was last changed, and a DELETE left open needs no explanation. */
  {
    const passwordRoute = stripComments(read("src/app/api/admin/password/route.ts"));
    const handlers = (passwordRoute.match(/export async function (GET|POST|DELETE)/g) ?? []).length;
    const guards = (passwordRoute.match(/await isOwnerRequest\(request\)/g) ?? []).length;
    check("every method on the password route is guarded", guards, handlers);
    check("the password route has the three methods expected", handlers, 3);
  }

  /* The code email must not arrive branded as somebody else's. */
  const mailSource = readFileSync("src/lib/mailer.ts", "utf8");
  check("the staff code email has its own wording", /codeIntroStaff/.test(mailSource) && /subjectStaff/.test(mailSource), true);
  check("staff sign-in has its own OTP purpose", /"staff-access"/.test(readFileSync("src/lib/otp.ts", "utf8")), true);

  /* Staff sign-in honours the dev-only OTP skip switch, so the console can be used
     before a sending account exists. The trap is ordering: the skip must come *after*
     the grant check, or the test aid would step over the feature it exists to test. */
  {
    const request = stripComments(readFileSync("src/app/api/admin/staff/request/route.ts", "utf8"));
    check("staff sign-in can skip the email in development",
      /otpSkipVerify\(\)/.test(request) && /skipVerify: true/.test(request), true);
    check("the grant is checked before the skip is taken",
      /findLiveStaffAccess\(email\)[\s\S]*?otpSkipVerify\(\)/.test(request), true);

    const verify = stripComments(readFileSync("src/app/api/admin/staff/verify/route.ts", "utf8"));
    /* `await` because settings are read through the async `getEnv()`; the branch itself is
       unchanged, but a pattern written for the synchronous form captured nothing and made
       this assertion fail for a reason unrelated to what it protects. */
    const skipBranch = /if \(await otpSkipVerify\(\)\) \{([\s\S]*?)\n  \}/.exec(verify)?.[1] ?? "";
    /* Skipping the code must not skip the allowlist — including a grant withdrawn
       moments ago, which is why the check is the live one. */
    check("skip mode still requires a live grant",
      /findLiveStaffAccess\(email\)/.test(skipBranch), true);
    /* And both ways in must set the cookie through one function, so the attributes
       cannot drift apart between them. */
    check("both sign-in paths share one session response",
      (verify.match(/sessionResponse\(email\)/g) ?? []).length, 2);
    check("the cookie is only set inside that shared function",
      (verify.match(/response\.cookies\.set/g) ?? []).length, 1);
  }
}

console.log("\n── The grand admin's second factor ──");
/* The secret used to be the whole credential. It now only causes an email, and the emailed
   code is what opens the console — so these assertions are about the sign-in having two
   steps and neither of them being skippable by misconfiguration. */
{
  const stepOne = stripComments(readFileSync("src/app/api/admin/verify/route.ts", "utf8"));
  const stepTwo = stripComments(readFileSync("src/app/api/admin/verify/otp/route.ts", "utf8"));

  /* Step one must NOT be able to sign anyone in once a second factor is configured. */
  check("step one sends a code instead of signing in",
    /stage: "otp"/.test(stepOne), true);
  check("step one mails the admin address",
    /sendOtpEmail\(to, code, "admin-access"/.test(stepOne), true);
  /* Every configured grand-admin address receives the same code, so any of them can open
     the console — one code, one stored row, several inboxes. */
  check("step one mails every grand-admin address",
    /Promise\.allSettled\([\s\S]{0,200}sendOtpEmail\(to, code, "admin-access"/.test(stepOne), true);
  check("one refused inbox does not fail the others",
    /delivered\.length === 0/.test(stepOne), true);
  /* …and when it is configured but unusable, it refuses rather than falling through — the
     second step must not be skippable by a broken mailer. */
  check("a configured second factor that cannot send refuses the sign-in",
    /could not send the confirmation code|provider refused/.test(stepOne), true);
  /*
   * **No `ADMIN_EMAIL` means the sign-in proceeds, with a warning.** This is the reversal of
   * an earlier decision, made after it locked an organiser out of production: the route used
   * to refuse, which took away the password *and* the deployment secret over one unset
   * variable whose absence looks like an omission rather than a setting.
   *
   * Refusing gained nothing. There is no second factor either way, so the sign-in being
   * refused stops nobody who has the password — it only stops the owner. So the console
   * warns instead, permanently, and that banner is what makes the missing step visible.
   */
  check("no admin address means the sign-in still works",
    /const emails = await adminEmails\(\);\s*const email = emails\[0\][\s\S]{0,2600}return await sessionResponse\(\)/.test(stepOne), true);  check("…and it warns loudly rather than silently",
    /ADMIN_EMAIL is not set[\s\S]{0,120}NO emailed/.test(stepOne), true);
  check("…and reports the state so the console can warn too",
    /twoStep: await adminTwoStep\(\)/.test(stepOne), true);

  /*
   * Several grand admins, functionally rather than by reading the source.
   *
   * A tournament outlives one person's inbox. The parser is the part worth testing: the
   * address list is free text typed into a dashboard, so commas, semicolons, newlines,
   * mixed case, duplicates and a mail client's `Name <addr>` form all have to land on the
   * same answer — and an entry that is not an address at all must be dropped rather than
   * become the place the code is sent.
   */
  const savedAdminEmail = process.env.ADMIN_EMAIL;

  process.env.ADMIN_EMAIL = " first@ksu.edu.sa , second@ksu.edu.sa;third@ksu.edu.sa\nfourth@ksu.edu.sa ";
  check("commas, semicolons and newlines all separate addresses", await adminEmails(),
    ["first@ksu.edu.sa", "second@ksu.edu.sa", "third@ksu.edu.sa", "fourth@ksu.edu.sa"]);
  check("the primary is the first address configured", await adminEmail(), "first@ksu.edu.sa");

  process.env.ADMIN_EMAIL = " Ali@KSU.edu.sa, ali@ksu.edu.sa ";
  check("case is folded and duplicates collapse", await adminEmails(), ["ali@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "Ali <ali@ksu.edu.sa>";
  check("a mail client's display-name form is understood", await adminEmails(), ["ali@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "not-an-address, ok@ksu.edu.sa";
  check("entries that are not addresses are dropped", await adminEmails(), ["ok@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "a@ksu.edu.sa,b@ksu.edu.sa";
  check("membership recognises every configured address", await isAdminEmail(" B@KSU.edu.sa "), true);
  check("membership still refuses a stranger", await isAdminEmail("c@ksu.edu.sa"), false);

  process.env.ADMIN_EMAIL = "";
  check("an empty value means there is no grand admin", await adminEmails(), []);
  check("…and no primary address", await adminEmail(), null);

  if (savedAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = savedAdminEmail;

  /* Step two must not be a way in on its own: it is reachable without the secret, so the
     only thing standing between it and a session is the emailed code. */
  check("step two takes no address from the caller",
    /adminEmail\(\)/.test(stepTwo) && /JSON\.parse[\s\S]{0,200}email/.test(stepTwo), false);
  check("step two checks the code against the stored hash",
    /safeEqual\(\s*(await\s+)?hashCode\(code, email, "admin-access"\), record\.codeHash\)/.test(stepTwo), true);
  check("step two spends a guess before comparing",
    /claimOtpAttempt\(record\.id, OTP_MAX_ATTEMPTS\)[\s\S]{0,300}safeEqual/.test(stepTwo), true);
  check("step two consumes the code once",
    /consumeOtpOnce\(record\.id\)/.test(stepTwo), true);
  /* With no second factor configured there is no code to check, so completing a sign-in
     here would skip step one entirely. It must refuse. */
  check("step two refuses when no code can exist",
    /if \(!\(await adminTwoStep\(\)\)\)[\s\S]{0,200}Two-step sign-in is not configured/.test(stepTwo), true);

  /* The admin address is configuration, and its absence means different things in each
     environment — a fresh clone must work, a deployment must not silently lose the step. */
  const auth = stripComments(readFileSync("src/lib/admin-auth.ts", "utf8"));
  check("the admin address is read from the environment",
    /getEnv\("ADMIN_EMAIL"\)/.test(auth), true);
  /* More than one grand admin: the list is split on commas, semicolons or whitespace, and
     the first address stays primary so reordering is the only way to move the anchor. */
  check("several grand-admin addresses are supported",
    /export async function adminEmails\(\)/.test(auth), true);
  check("the list is split on commas, semicolons and whitespace",
    /split\(\/\[\\s,;\]\+\//.test(auth), true);
  check("the primary address is the first configured",
    /return \(await adminEmails\(\)\)\[0\] \?\? null/.test(auth), true);
  /* The step is in force exactly when there is somewhere to send the code — so the function
     answers "is it running", not "ought it to be". Those came apart once and cost a
     production lockout; see the note above. */
  check("the step is on exactly when it can send",
    /return Boolean\(await adminEmail\(\)\)/.test(auth), true);
  check("it no longer depends on NODE_ENV",
    /adminTwoStep[\s\S]{0,200}NODE_ENV === "production"/.test(auth), false);

  /* The code is bound to a purpose, so an admin code cannot be replayed as a staff or
     player code and vice versa. */
  check("admin codes have their own OTP purpose",
    /"admin-access"/.test(readFileSync("src/lib/otp.ts", "utf8")), true);
  const copy = readFileSync("src/lib/email-copy.ts", "utf8");
  for (const key of ["subjectAdmin", "codeIntroAdmin"]) {
    /* Three: the interface declaration, the English dictionary and the Arabic one. Two
       would mean a language is missing it, and the code would arrive untranslated. */
    check(`${key} is declared once and translated twice`,
      (copy.match(new RegExp(`${key}:`, "g")) ?? []).length, 3);
  }

  /* The browser must actually ask for the second step rather than treating any 200 as
     success — that is how a two-step flow silently becomes one step. */
  const gate = stripComments(readFileSync("src/components/admin/secret-gate.tsx", "utf8"));
  check("the gate waits for the code before unlocking",
    /if \(payload\.stage === "session"\)[\s\S]{0,120}onUnlock/.test(gate), true);
  check("the gate posts the code to the second step",
    /fetch\("\/api\/admin\/verify\/otp"/.test(gate), true);
}

console.log("\n── The console is not at /admin ──");
/* Hiding the console's address is obscurity rather than protection, so these assertions
   are about the *mechanism* being intact — a rewrite that quietly stopped happening
   would put the sign-in form back at a guessable URL with nothing to say so. */
{
  const middleware = stripComments(readFileSync("src/middleware.ts", "utf8"));
  check("middleware refuses /admin",
    /pathname === "\/admin" \|\| pathname\.startsWith\("\/admin\/"\)/.test(middleware), true);
  /* Refused by rewriting to a path with no route, so it is answered with the ordinary
     404. A redirect or a distinct status would advertise that something is there. */
  check("the refusal is an ordinary-looking 404",
    /return \{ url: new URL\(NOT_FOUND, request\.url\), segment: null \}/.test(middleware), true);
  check("the console's own path is mapped onto the internal route",
    /url\.pathname = `\$\{internal\}\$\{pathname\.slice\(prefix\.length\)\}`/.test(middleware), true);
  /* Both doors are mapped, from two separate segments, and to two separate routes — so
     handing out the staff address does not lead to the grand admin's page. */
  check("both doors are routed",
    /\{ segment: owner, internal: "\/admin" \}/.test(middleware) &&
      /\{ segment: staff, internal: "\/admin\/staff" \}/.test(middleware), true);
  check("the two segments are resolved separately",
    /await Promise\.all\(\[adminPath\(\), staffPath\(\)\]\)/.test(middleware), true);
  /* The CSP kill switch must not be able to un-hide the console. */
  check("the rewrite happens before the CSP kill switch",
    middleware.indexOf("const route = await consoleRoute(request)") <
      middleware.indexOf('getEnv("CSP_STRICT")'), true);
  /* A rewrite that drops the nonce headers would break every script on the console. */
  check("the rewrite carries the security headers",
    /NextResponse\.rewrite\(route\.url, \{ request: \{ headers \} \}\)/.test(middleware), true);

  /* The middleware must run on **every** page request.
   *
   * It used to exclude prefetch requests from its matcher, which was harmless while the
   * middleware only set headers — and became a hole the moment it decided who could
   * reach the console: a request carrying `Next-Router-Prefetch` (which no RSC payload
   * accompanies when curl sends it) skipped the middleware entirely and rendered the
   * whole sign-in form at `/admin`. Verified live before fixing: `/admin` answered 200
   * on that path and 404 after. */
  check("the middleware does not skip prefetch requests",
    /missing:/.test(middleware), false);

  /*
   * Cross-origin isolation, for the logo tool's WASM backend.
   *
   * `@imgly/background-removal` drives ONNX Runtime's threaded build, which needs
   * `SharedArrayBuffer` — available only to a document that is both `COOP: same-origin`
   * and `COEP: require-corp`. Without COEP the organiser got
   * `no available backend found. ERR: [wasm] TypeError: Load failed`, which reads like a
   * CDN or CORS problem; measured live, the CDN returned 200 and a `blob:` module import
   * worked, while `crossOriginIsolated` was false and `SharedArrayBuffer` undefined.
   */
  check("the console is cross-origin isolated for its WASM logo tool",
    /response\.headers\.set\("Cross-Origin-Embedder-Policy", "require-corp"\)/.test(middleware), true);
  /* Scoped to the console: `require-corp` makes the document refuse cross-origin
     resources that have not opted in, and the public form gains nothing from that. */
  check("…and only on the console",
    /if \(route\?\.segment\) \{\s*response\.headers\.set\("Cross-Origin-Embedder-Policy"/.test(middleware), true);
  /* The kill switch must not switch this off too — an organiser turning CSP_STRICT off
     to unbreak a page would otherwise break the logo tool for an unrelated-looking reason. */
  check("…and the CSP kill switch does not disable it",
    /getEnv\("CSP_STRICT"\)[\s\S]{0,420}Cross-Origin-Embedder-Policy/.test(middleware), true);
  /* COOP is the other half; it is set in next.config.mjs for every page. */
  const nextConfig = readFileSync("next.config.mjs", "utf8");
  check("COOP is still sent globally",
    /key: "Cross-Origin-Opener-Policy", value: "same-origin"/.test(nextConfig), true);

  /* The library's own error is misleading, so the code states the real requirement
     before it gets that far. */
  const logoPrepare = stripComments(readFileSync("src/lib/logo-prepare.ts", "utf8"));
  check("the logo tool checks isolation before starting",
    /if \(!globalThis\.crossOriginIsolated\)/.test(logoPrepare), true);
  check("…and says what is actually wrong",
    /cross-origin isolation|COOP \+ COEP/.test(logoPrepare), true);

  /* Belt and braces: the route refuses on its own, because a matcher is configuration
     and configuration is what gets edited later by someone who has not read it. */
  const adminPage = stripComments(readFileSync("src/app/admin/page.tsx", "utf8"));  check("the console page requires the marker the middleware sets",
    /headers\(\)\)\.get\(CONSOLE_HEADER\)/.test(adminPage) && /notFound\(\)/.test(adminPage), true);
  /* A constant marker would be one leaked string away from re-exposing the console, so
     the marker is the secret segment itself. */
  check("the marker is the secret segment, not a constant",
    /if \(!presented \|\| presented !== \(await adminPath\(\)\)\) notFound\(\)/.test(adminPage), true);

  const adminPathSource = readFileSync("src/lib/admin-path.ts", "utf8");
  /* Reading the secret at call time is what lets the value be swapped and, more
     importantly, what stops a build-time `undefined` becoming a fixed public path. */
  check("the path is derived from the live secret",
    /getEnv\("ADMIN_SECRET"\)/.test(adminPathSource), true);
  check("no secret in production means no console",
    /if \(process\.env\.NODE_ENV !== "production"\) return DEV_ADMIN_SECRET;[\s\S]{0,80}return null;/
      .test(adminPathSource), true);
  check("the segment override is validated, not trusted",
    /SEGMENT\.test\(raw\)/.test(adminPathSource), true);

  /* Nothing may hardcode the old path as a navigation target again. */
  for (const source of [
    "src/components/form/registration-wizard.tsx",
    "src/components/form/edit-flow.tsx",
  ]) {
    const file = stripComments(readFileSync(source, "utf8"));
    check(`${source.split("/").pop()} does not navigate to /admin`,
      /(href|assign)\(\s*["'`]\/admin/.test(file), false);
  }
  check("the shortcut uses the resolved path",
    /window\.location\.assign\(destination\)/.test(readFileSync("src/components/form/registration-wizard.tsx", "utf8")), true);
  /* Both doors are resolved on the server, and now in the same batch as the config and
     the logo versions — three sequential round trips to a pooled database put the whole
     page behind their sum, and the logo images cannot even be requested until the page
     knows they exist. The assertion therefore pins the *batch*, not a particular call
     shape: either address resolved outside it would put the latency back. */
  const homePage = stripComments(readFileSync("src/app/page.tsx", "utf8"));
  check("the page resolves both addresses on the server",
    /Promise\.all\(\[/.test(homePage) && /adminHref\(\)/.test(homePage) && /staffHref\(\)/.test(homePage), true);
  check("…in the same batch as the config and logo versions",
    /loadConfig\(\)[\s\S]{0,400}adminHref\(\)[\s\S]{0,200}staffHref\(\)/.test(homePage), true);
  check("…with no second, sequential await for either",
    /await adminHref\(\)/.test(homePage) || /await staffHref\(\)/.test(homePage), false);

  /* Neither page may be opened by the other's address. This is the whole reason the
     middleware forwards the segment that matched rather than a role: each page checks
     for *its own* segment, so the staff address cannot open the grand admin's form. */
  const staffPage = stripComments(readFileSync("src/app/admin/staff/page.tsx", "utf8"));
  check("the staff page exists and guards on its own segment",
    /presented !== \(await staffPath\(\)\)/.test(staffPage) && /notFound\(\)/.test(staffPage), true);
  check("the grand admin page does not accept the staff segment",
    /presented !== \(await staffPath\(\)\)/.test(adminPage), false);
  check("the staff page renders the staff door",
    /mode="staff"/.test(staffPage), true);
  check("the grand admin page renders its own door",
    /mode="owner"/.test(adminPage), true);

  /* The split's point: one address, one way in. A switcher would put the secret prompt
     back in front of whoever was handed the staff address. */
  const gate = stripComments(readFileSync("src/components/admin/secret-gate.tsx", "utf8"));
  check("the gate offers no way to switch doors",
    /setMode\(/.test(gate), false);
  check("the gate takes its door from the route",
    /mode: "owner" \| "staff"/.test(gate), true);

  /* The minus is matched by character *and* by key code, because the character changes
     with the modifiers: Shift turns it into `_` on every platform, and macOS composes
     Option+minus into `–` rather than sending the bare key. Matching only on `-` would
     make the combo unreachable on exactly the platform the organisers asked for. */
  const wizardSource = readFileSync("src/components/form/registration-wizard.tsx", "utf8");
  check("the minus is matched by code as well as character",
    /event\.code === "Minus"/.test(wizardSource), true);
  for (const dash of ["_", "–", "—"]) {
    check(`the ${JSON.stringify(dash)} a modified minus produces is accepted`,
      new RegExp(`DASH_KEYS = new Set\\(\\[[^\\]]*"${dash}"`).test(wizardSource), true);
  }
  check("both shortcuts are bound to their own address",
    /useOrganiserShortcut\(adminHref, staffHref\)/.test(wizardSource), true);
  /* Alt is the grand admin's, Shift is the staff's, and the two branches exclude each
     other — otherwise Ctrl+Alt+Shift+minus would resolve to whichever came first. */
  check("the grand admin combo uses Alt",
    /event\.altKey && !event\.shiftKey \? ownerHref/.test(wizardSource), true);
  check("the staff combo uses Shift",
    /event\.shiftKey && !event\.altKey \? staffHref/.test(wizardSource), true);
  /* The old combination is gone, not merely supplemented. */
  check("the shortcut is no longer bound to the 5 key",
    /Digit5|event\.key === "5"/.test(wizardSource), false);

  const envExample = readFileSync(".env.example", "utf8");
  check("ADMIN_PATH is documented as optional",
    /ADMIN_PATH/.test(envExample) && /Optional/.test(envExample), true);
  check("STAFF_PATH is documented too", /STAFF_PATH/.test(envExample), true);
}

console.log("\n── Attempt ceilings ──");
/* The organisers asked for three on both, so the numbers are asserted rather than
   left to drift — a limit that quietly relaxes is a limit nobody notices relaxing. */
check("a code allows three wrong guesses", OTP_MAX_ATTEMPTS, 3);

{
  const adminSource = readFileSync("src/lib/admin-auth.ts", "utf8");
  const failures = /const ADMIN_MAX_FAILURES = (\d+);/.exec(adminSource)?.[1];
  check("the admin secret allows three wrong guesses", failures, "3");
  /* The site-wide cap stays looser than the per-caller one: it exists to blunt a
     distributed attack, not to lock out one organiser who mistyped. */
  const global = /const ADMIN_GLOBAL_MAX_FAILURES = (\d+);/.exec(adminSource)?.[1];
  check("the site-wide cap is looser than the per-caller one", Number(global) > Number(failures), true);

  /* Both ceilings have to be enforced somewhere that actually spends the allowance,
     not merely declared. */
  const verifyRoutes = [
    "src/app/api/otp/verify/route.ts",
    "src/app/api/admin/staff/verify/route.ts",
  ];
  for (const route of verifyRoutes) {
    const source = stripComments(readFileSync(route, "utf8"));
    check(`${route.split("/").slice(-2, -1)[0]} spends an attempt per guess`,
      /claimOtpAttempt\(record\.id, OTP_MAX_ATTEMPTS\)/.test(source), true);
  }
  /* The lockout comes before the credential comparison — that is the brute-force
     protection, and it applies to whatever the credential is. */
  check("the lockout is consulted before the credential is compared",
    adminSource.indexOf("adminLockout(request)") < adminSource.indexOf("checkAdminSecret(candidate)"),
    true);

  /*
   * **The stored password is the credential; ADMIN_SECRET is bootstrap only.**
   *
   * This is the rule the organisers asked for, and it is worth pinning in the source as
   * well as in behaviour: a leaked deployment secret must stop being a permanent way in
   * once a password exists, or rotating the password achieves nothing.
   */
  const credentialBody = /export async function verifyAdminCredentials[\s\S]*?\n\}/.exec(adminSource)?.[0] ?? "";
  check("the stored password is verified against the row",
    /verifyCredential\(stored\.passwordHash, candidate, await adminPepper\(\)\)/.test(credentialBody), true);
  check("a valid stored password does not fall through to the secret",
    /return verifyCredential\(stored\.passwordHash[\s\S]{0,40}\);/.test(credentialBody), true);
  check("a malformed stored row refuses rather than falling through",
    /isCredentialHash[\s\S]{0,400}return false;/.test(credentialBody), true);
  /* Bootstrap: no row at all is the only case that reaches the environment secret. */
  check("the secret is only consulted when no password is stored",
    /if \(!stored\) \{[\s\S]{0,500}checkEnvAdminSecret\(candidate\)/.test(credentialBody), true);
  /* Configured-but-unreachable must not be read as "no row", or an outage would
     promote the secret back to a full credential. */
  check("an unreadable database fails closed",
    /catch \(error\) \{[\s\S]{0,300}return false;/.test(credentialBody), true);
  /* The message must not promise a way in that no longer exists. */
  check("the lockout message does not offer the secret as a way back",
    /ADMIN_SECRET/.test(LOCKED_OUT_MESSAGE), false);
  /* Recovery now happens out of band, so the tool has to exist and be runnable. */
  check("a password reset tool exists", existsSync("scripts/reset-admin-password.ts"), true);
  check("…and is a runnable npm script",
    /"admin:reset":/.test(readFileSync("package.json", "utf8")), true);
}

console.log("\n── The database TLS mode ──");
/* `pg` treats `sslmode=require` as `verify-full` today and will treat it as
   *unverified* encryption in its next major version. That arrives with a dependency
   bump nobody would connect to a security property, so the diagnostic names it — and
   this pins the diagnostic. */
{
  const source = readFileSync("scripts/check-stack.ts", "utf8");
  check("the diagnostics check the TLS mode", /tlsModeWarning/.test(source), true);
  /* A hosted URL with no sslmode is not "safe by default" — pg would connect
     without TLS at all. */
  check("an unencrypted hosted URL is reported",
    /no sslmode in the URL — the connection may not be encrypted/.test(source), true);
  check("verify-ca is reported for skipping the hostname check",
    /verify-ca does not check the hostname/.test(source), true);

  const read = (path: string) => readFileSync(path, "utf8");
  check("the example env asks for verify-full", /sslmode=verify-full/.test(read(".env.example")), true);
  check("the README explains the change", /pg v9|next major version/.test(read("README.md")), true);

  /* The live configuration must not be the mode that is about to change meaning.
     A checkout without a `.env` has nothing to compare — that is not a failure, it
     just means there is no deployment URL here to judge. */
  const envPath = ".env";
  if (existsSync(envPath) && readFileSync(envPath, "utf8").includes("DATABASE_URL=")) {
    const url = read(envPath);
    check("the configured URL is not on the ambiguous mode",
      /sslmode=require/.test(url), false);
  }
}

/**
 * The console's path, which is derived with `crypto.subtle` and so cannot be checked
 * synchronously. Everything above has already run by the time this does.
 *
 * These pin the properties that make the hiding worth anything: that the segment
 * depends on the secret rather than being a fixed string, that an unusable override is
 * refused, and that a deployment with no secret has *no* console rather than a
 * predictable one.
 */
async function derivedPathChecks() {
  /* Next's types mark `NODE_ENV` read-only, and this battery has to move it to check
     both sides of the production branch. The cast is the narrowest way to say "this is
     a value under test, not a compile-time constant". */
  const env = process.env as Record<string, string | undefined>;
  const original = {
    secret: env.ADMIN_SECRET,
    path: env.ADMIN_PATH,
    staffPath: env.STAFF_PATH,
    nodeEnv: env.NODE_ENV,
  };

  try {
    delete env.ADMIN_PATH;
    delete env.STAFF_PATH;
    env.NODE_ENV = "production";

    env.ADMIN_SECRET = "secret-one";
    const one = await adminPath();
    const staffOne = await staffPath();

    /* Stability, checked under the *same* secret — comparing against a value captured
       under a different one would only prove that different secrets differ. */
    check("the same secret always gives the same path", await adminPath(), one);
    check("the staff path is stable for one secret", await staffPath(), staffOne);
    check("it is unguessable in shape", /^crown-[0-9a-f]{12}$/.test(one ?? ""), true);

    /* Two doors, two addresses. If both roles hashed the same context string they would
       produce identical segments, and the staff address would open the grand admin's
       page — which is the single thing the split exists to prevent. */
    check("the staff path is derived too", /^crew-[0-9a-f]{12}$/.test(staffOne ?? ""), true);
    check("the two doors have different addresses", one !== staffOne, true);
    check("the staff address is not the grand admin's with a different prefix",
      (one ?? "").slice("crown-".length) !== (staffOne ?? "").slice("crew-".length), true);

    /* And the path is a function of the secret, not a constant somebody could read out
       of the source and use against every deployment. */
    env.ADMIN_SECRET = "secret-two";
    const two = await adminPath();
    check("the console path is derived from the secret", one !== two, true);

    /* An override is convenient; an override that silently becomes a *different* path, or
       that moves the other door, is not. */
    const staffBefore = await staffPath();
    env.ADMIN_PATH = "/My-Ops/";
    check("ADMIN_PATH overrides the derived path", await adminPath(), "my-ops");
    check("overriding one door leaves the other alone", await staffPath(), staffBefore);
    env.ADMIN_PATH = "has a space";
    check("an unusable override is refused, not used", await adminPath(), two);
    env.STAFF_PATH = "/My-Crew/";
    check("STAFF_PATH overrides the staff door", await staffPath(), "my-crew");
    delete env.ADMIN_PATH;
    delete env.STAFF_PATH;

    /* Fail closed. A guessable fallback in production would look like protection while
       the console sat at a path anybody could compute. */
    delete env.ADMIN_SECRET;
    check("no secret in production means no console", await adminPath(), null);
    check("…and no staff door either", await staffPath(), null);

    env.NODE_ENV = "development";
    const dev = await adminPath();
    const devStaff = await staffPath();
    check("the development secret keeps a fresh checkout usable", /^crown-[0-9a-f]{12}$/.test(dev ?? ""), true);
    check("…and the development staff door is usable and different",
      /^crew-[0-9a-f]{12}$/.test(devStaff ?? "") && devStaff !== dev, true);
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete env[key];
      else env[key] = value;
    };
    restore("ADMIN_SECRET", original.secret);
    restore("ADMIN_PATH", original.path);
    restore("STAFF_PATH", original.staffPath);
    restore("NODE_ENV", original.nodeEnv);
  }
}

/**
 * An organiser may open the form from "View form" and finish a registration while the
 * public window is shut.
 *
 * Two halves, and both matter:
 *
 * - **Behaviour** — a real signed cookie for either role satisfies `hasAdminSession`,
 *   and nothing else does. That function is the exemption every guard calls, so testing
 *   it here covers all four routes without a database or a running server.
 * - **Wiring** — each closed-registration guard must actually *call* it. A correct
 *   helper that one route forgot to consult is exactly the bug this catches, and it is
 *   invisible to a behavioural test of the helper alone.
 */
async function organiserPreviewChecks() {
  const env = process.env as Record<string, string | undefined>;
  const originalSecret = env.ADMIN_SECRET;

  /* Both minting and verifying derive their key from `ADMIN_SECRET`, so pin one for the
     duration. In development the fallback would work too, but a developer who happens to
     export a real secret should still get a deterministic result here. */
  env.ADMIN_SECRET = "self-test-organiser-preview";

  try {
    const requestWith = (token: string | null) =>
      new Request("http://localhost/?tab=register", {
        headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      });

    const owner = await createAdminSession();
    const staff = await createStaffSession("staff@ksu.edu.sa");

    check("a grand admin session is minted for the check", typeof owner, "string");
    check("a staff session is minted for the check", typeof staff, "string");

    check("the grand admin passes the closed-registration gate",
      await hasAdminSession(requestWith(owner)), true);
    check("a staff member does too — 'View form' is for both roles",
      await hasAdminSession(requestWith(staff)), true);

    /* The exemption must not become a way in for the public. */
    check("an anonymous visitor is still refused", await hasAdminSession(requestWith(null)), false);
    check("a tampered session is refused",
      await hasAdminSession(requestWith(`${owner!.slice(0, -1)}x`)), false);
    check("a staff session cannot be forged from an owner one",
      await hasAdminSession(requestWith(owner!.replace(".", "x."))), false);
  } finally {
    if (originalSecret === undefined) delete env.ADMIN_SECRET;
    else env.ADMIN_SECRET = originalSecret;
  }

  /* ---- Wiring: the page keeps the form open for a signed-in organiser ---- */
  const homePage = stripComments(readFileSync("src/app/page.tsx", "utf8"));
  check("the form page reads the session on the server",
    /await adminSession\(/.test(homePage), true);
  check("…and tells the wizard, rather than deciding in the browser",
    /organiserPreview=\{organiserSession !== null\}/.test(homePage), true);

  const wizard = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  check("the wizard opens the form when registration is open *or* an organiser is allowed",
    /const formOpen = config\.registrationOpen \|\| organiserMayEnter;/.test(wizard), true);
  check("…so an organiser is not shown the closed panel",
    /!formOpen \? \(\s*<ClosedPanel/.test(wizard), true);
  check("…and is told the window is closed to the public",
    /previewingClosed &&/.test(wizard) && /t\("preview\.title"\)/.test(wizard), true);

  /* ---- Wiring: "View form" lands on the form itself ---- */
  const consoleSource = stripComments(readFileSync("src/components/admin/admin-console.tsx", "utf8"));
  check("'View form' opens the registration tab directly",
    /<Link href="\/\?tab=register">View form<\/Link>/.test(consoleSource), true);
  check("…and the page honours that tab",
    /skipLanding=\{params\.tab === "register"\}/.test(homePage), true);
  check("…by starting on the form, not the landing page",
    /React\.useState\(skipLanding \|\| initialTab === "edit"\)/.test(wizard), true);

  /* **Refreshing must return to the landing page.**
     "View form" leaves `?tab=register` in the address bar, so without this a refresh
     re-opened the form and the site looked like it had no home page. The link is
     consumed once: the address is rewritten to `/` as soon as the form is on screen.
     `replaceState` rather than `pushState`, so Back is not trapped in a loop. */
  const layoutSource = stripComments(readFileSync("src/app/layout.tsx", "utf8"));
  check("the register deep link is cleared before hydration",
    /FORM_DEEP_LINK_BOOTSTRAP_SCRIPT/.test(layoutSource) &&
      /searchParams\.delete\("tab"\)/.test(layoutSource) &&
      /history\.replaceState/.test(layoutSource), true);
  check("…only when the deep link was used",
    /searchParams\.get\("tab"\)!=="register"/.test(layoutSource), true);
  check("…keeps the language the link carried",
    /u\.pathname\+\(u\.search\|\|""\)\+u\.hash/.test(layoutSource), true);
  check("…and the wizard has the same fallback after hydration",
    /if \(!skipLanding\) return;[\s\S]{0,200}searchParams\.delete\("tab"\)/.test(wizard), true);
  check("…without pushing a history entry",
    /history\.pushState/.test(wizard) || /history\.pushState/.test(layoutSource), false);
  /* The edit link from the confirmation email is meant to be reopened, so it is
     deliberately left alone. */
  check("the edit deep link is not rewritten",
    /params\.tab === "register"/.test(homePage), true);

  /* ---- The site footer ---- */
  const footerSource = stripComments(readFileSync("src/components/form/site-footer.tsx", "utf8"));
  const landingSource = stripComments(readFileSync("src/components/form/landing.tsx", "utf8"));
  const wizardSource = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));

  /* On **both** pages: a captain halfway through the form must still be able to reach
     the policy and the contact address without going back to the home page. */
  check("the footer is mounted on the landing page",
    /<SiteFooter config=\{config\} logoVersions=\{sponsorLogoVersions\} \/>/.test(landingSource), true);
  check("…and inside the registration wizard",
    /<SiteFooter config=\{config\} logoVersions=\{sponsorLogoVersions\} \/>/.test(wizardSource), true);
  /* The one-line note it replaced is gone, not left beside it. */
  check("the old single-line footer note is gone",
    /wizard\.footerNote/.test(wizardSource), false);

  /* The privacy link is a fixed route: it opens the notice the consent box refers to. */
  check("the privacy link points at the real notice",
    /href="\/privacy"/.test(footerSource), true);
  check("…and is not configurable",
    /config\.policyUrl/.test(footerSource), false);

  /* Contact and social are omitted when unset — no dead links. */
  check("the contact link needs a configured address",
    /\{contact && \(/.test(footerSource), true);
  check("…built as a mailto, not a raw href",
    /href=\{`mailto:\$\{contact\}`\}/.test(footerSource), true);
  check("the social list is hidden when empty",
    /social\.length > 0 &&/.test(footerSource), true);
  check("…and opens each account in a new tab safely",
    /rel="noreferrer noopener"/.test(footerSource), true);

  /* The requested logo: transparent artwork, no black plate under it. */
  check("the footer carries the club logo",
    /src="\/club-logo\.png"/.test(footerSource), true);
  /* Scoped to the `img` element itself: the social pills below it legitimately carry a
     translucent fill, and matching the whole file would fail on those. */
  const logoTag = /<img[\s\S]*?\/>/.exec(footerSource)?.[0] ?? "";
  check("…with no background box behind it",
    /\bbg-/.test(logoTag), false);
  check("…and no black plate class around it",
    /bg-black/.test(footerSource), false);
  check("the transparent logo asset exists", existsSync("public/club-logo.png"), true);

  /* The language switch moved here, and is no longer in the hero or the wizard header. */
  check("the footer carries the language switch",
    /<LanguageToggle \/>/.test(footerSource), true);
  check("…and the hero no longer has its own",
    /LanguageToggle/.test(landingSource), false);
  check("…nor does the wizard header",
    /LanguageToggle/.test(wizardSource), false);

  /* Config: both fields are real, validated, and saved with everything else. */
  const tournamentConfig = stripComments(readFileSync("src/lib/tournament.ts", "utf8"));
  check("the contact address is normalised, not trusted",
    /contactEmail: emailLike\(input\.contactEmail\)/.test(tournamentConfig), true);
  check("…and dropped when it is not an address",
    /!raw\.includes\("@"\)/.test(tournamentConfig), true);
  check("social links go through the same link filter as watch links",
    /normaliseSocialLink/.test(tournamentConfig) && /normaliseWatchLink\(value, index\)/.test(tournamentConfig), true);
  check("…and are capped", /MAX_SOCIAL_LINKS/.test(tournamentConfig), true);

  /* Editable from the console — by staff as well as the owner. */
  const generalSource = stripComments(readFileSync("src/components/admin/general-section.tsx", "utf8"));
  check("the console exposes the contact address",
    /patch\("contactEmail", value\)/.test(generalSource), true);
  check("…and the social accounts",
    /patch\("socialLinks"/.test(generalSource), true);
  check("…in a Footer card any signed-in organiser can open",
    /title="Footer"/.test(generalSource), true);

  /* Social accounts print their uploaded logo alone, in one horizontal row. A text
     label in the footer pushed the strip into a column and buried the rest of the page. */
  check("the footer renders social artwork rather than text labels",
    footerSource.includes("/api/social/") && !/>\{link\.label\}</.test(footerSource), true);
  check("…in a horizontal row",
    /flex flex-row flex-wrap/.test(footerSource), true);
  check("…and hides an account until it has a logo",
    footerSource.includes("version === undefined ? [] : [{ link, version }]"), true);
  check("the console offers a logo upload per social account",
    generalSource.includes("/api/admin/social/${encodeURIComponent(link.id)}/logo"), true);
  check("there is a public social-logo route",
    existsSync("src/app/api/social/[socialId]/logo/route.ts"), true);
  check("…and a guarded upload route",
    existsSync("src/app/api/admin/social/[socialId]/logo/route.ts") &&
      /isAdminRequest/.test(readFileSync("src/app/api/admin/social/[socialId]/logo/route.ts", "utf8")), true);
  check("saving an account does not re-prefix its id",
    tournamentConfig.includes('link.id.startsWith("social-") ? link.id :'), true);

  /* The entrant-facing field is "your section", and the coach's university is
     explicitly optional in the label as well as the hint. */
  check("the field is called Your section", EN["team.divisionLabel"], "Your section");
  check("…in Arabic", AR["team.divisionLabel"], "قسمك");
  check("…and the review row matches", EN["review.division"], "Your section");
  check("the coach's university label says optional",
    EN["field.universityCoachLabel"].includes("optional for coaches"), true);
  check("…and the hint explains what to do",
    EN["field.universityCoachHint"].includes("leave this blank"), true);

  /* The two requested copy changes. */
  check("the rulebook button says Back to submission",
    EN["rulebook.continue"], "Back to submission");
  check("…in Arabic too",
    /العودة إلى الإرسال/.test(AR["rulebook.continue"]), true);
  check("the Arabic games heading is ساحات المعركة",
    AR["home.gamesTitle"], "ساحات المعركة");

  /* The console header — and therefore "View form" — is rendered for both roles. */
  check("the staff door uses the same console header",
    /mode="staff"/.test(readFileSync("src/app/admin/staff/page.tsx", "utf8")), true);

  /* ---- Wiring: every closed-registration guard consults the session ---- */
  const guards = [
    "src/app/api/registrations/route.ts",
    "src/app/api/registrations/[reference]/route.ts",
    "src/app/api/registrations/lookup/route.ts",
    "src/app/api/otp/request/route.ts",
  ];

  for (const file of guards) {
    const source = stripComments(readFileSync(file, "utf8"));
    const short = file.split("/").slice(-2).join("/");
    /* The exemption is two conditions now: the session *and* the organisers' switch.
       Either one alone would let a signed-in organiser in when the console says they
       should be refused. */
    check(`${short} refuses a closed window only for the public`,
      /![\w.]*registrationOpen[\s\S]{0,200}allowOrganiserEntriesClosed[\s\S]{0,60}hasAdminSession\(request\)/
        .test(source), true);
    check(`${short} honours the console's organiser-entries switch`,
      /allowOrganiserEntriesClosed/.test(source), true);
    check(`${short} imports the session check rather than assuming it`,
      /from "@\/lib\/admin-auth"/.test(source) && /hasAdminSession/.test(source), true);
  }

  /* ---- The switch itself: a checkbox below the closed-registration settings ---- */
  const general = stripComments(readFileSync("src/components/admin/general-section.tsx", "utf8"));
  check("the console offers a checkbox for organiser entries while closed",
    /<CheckboxField[\s\S]{0,200}allowOrganiserEntriesClosed/.test(general), true);
  check("…labelled for both roles",
    /Allow admins and staff to register while closed/.test(general), true);
  check("…sitting below the closed message",
    general.indexOf("Closed message") < general.indexOf("allowOrganiserEntriesClosed"), true);

  /* Defaults matter: a settings row saved before this existed must keep the behaviour
     organisers already relied on, and a fresh install must allow it too. */
  const tournamentSource = stripComments(readFileSync("src/lib/tournament.ts", "utf8"));
  check("the switch is on by default",
    /allowOrganiserEntriesClosed:\s*true,/.test(tournamentSource), true);
  check("…and survives normalisation as on unless explicitly turned off",
    /allowOrganiserEntriesClosed:\s*input\.allowOrganiserEntriesClosed !== false/.test(tournamentSource), true);

  /* Turning it off must close the form for an organiser as well — the whole point of
     the checkbox, and the case the page-side expression has to get right. */
  check("the wizard requires the switch as well as the session",
    /organiserPreview && config\.allowOrganiserEntriesClosed/.test(wizard), true);
}

console.log("\n── A Discord invite after registration ──");
{
  /* **The link is configuration, not part of a stored team.** It changes when an invite
     expires, so editing it must never require touching registrations — and it must be
     editable by staff, who are the people running the tournament day to day. */
  const config = normaliseConfig({});

  check("a tournament with no invite shows none", config.discordInviteUrl, "");
  check("an http invite is kept",
    normaliseConfig({ discordInviteUrl: "https://discord.gg/ksucrown" }).discordInviteUrl,
    "https://discord.gg/ksucrown");
  check("……and is trimmed",
    normaliseConfig({ discordInviteUrl: "  https://discord.gg/ksucrown  " }).discordInviteUrl,
    "https://discord.gg/ksucrown");
  /* The same rule every other organiser-supplied link goes through. */
  check("a javascript: invite is refused",
    normaliseConfig({ discordInviteUrl: "javascript:alert(1)" }).discordInviteUrl, "");
  check("a protocol-relative invite is refused",
    normaliseConfig({ discordInviteUrl: "//evil.example/x" }).discordInviteUrl, "");
  check("a site path is allowed",
    normaliseConfig({ discordInviteUrl: "/discord" }).discordInviteUrl, "/discord");

  /* Rendered on the success screen, and only when configured. */
  const success = stripComments(readFileSync("src/components/form/success-panel.tsx", "utf8"));
  check("the success screen takes the invite as a prop",
    /discordInviteUrl\?: string/.test(success), true);
  check("…and renders nothing when it is empty",
    /discordInviteUrl && \(/.test(success), true);
  check("…as an external link that cannot leak the opener",
    /rel="noreferrer noopener"/.test(success), true);
  check("the form passes the configured invite through",
    /discordInviteUrl=\{config\.discordInviteUrl\}/.test(
      stripComments(readFileSync("src/components/form/registration-form.tsx", "utf8")),
    ), true);

  /* Editable from the console — in General, which staff can open. */
  const general = stripComments(readFileSync("src/components/admin/general-section.tsx", "utf8"));
  check("the console offers the invite for editing",
    /label="Discord invite link"/.test(general), true);
  check("…bound to the config field, so saving persists it",
    /patch\("discordInviteUrl", value\)/.test(general), true);
  check("…in a section staff can see",
    /After registration/.test(general), true);

  /* Both languages, or the Arabic success screen shows an English card. */
  for (const key of ["success.discordTitle", "success.discordBody", "success.discordCta"]) {
    check(`${key} exists in English`, typeof EN[key as keyof typeof EN], "string");
    check(`${key} exists in Arabic`, typeof AR[key as keyof typeof AR], "string");
    check(`${key} is written in Arabic`,
      /[\u0600-\u06FF]/.test(AR[key as keyof typeof AR] ?? ""), true);
  }
}

console.log("\n── The closed notice is a warning, not the logo ──");
{
  const wizard = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  const panel = /function ClosedPanel[\s\S]*?\n}/.exec(wizard)?.[0] ?? "";

  check("the closed panel is still rendered when registration is shut",
    /<ClosedPanel config=\{config\} \/>/.test(wizard), true);
  /* The logo is the same mark shown above a *working* form, so a closed window read as
     an empty page that had failed to load. The warning icon says "stopped" on its own. */
  check("the closed panel no longer shows the tournament logo",
    /KsuCrownMark/.test(panel), false);
  check("…it shows a warning icon instead", /TriangleAlert/.test(panel), true);
  check("…in the danger colour, not the brand one",
    /text-danger/.test(panel) && /bg-danger/.test(panel), true);
  check("…and the logo import is gone from the wizard",
    /KsuCrownMark/.test(wizard), false);
}

console.log("\n── The console edits and deletes registrations ──");
{
  /*
   * **This block used to assert the opposite, and the reversal is the point.**
   *
   * The per-row Edit button was removed at the organisers' request: the console was for
   * reading entries and exporting them. Then they asked for it back — "let staff and grand
   * admin make changes on registrations" — which is the same answer the API always gave:
   * `PATCH /api/admin/teams/[id]` and `validateAdminTeamEdit` never stopped working, so the
   * capability existed the whole time with no way to reach it.
   *
   * The lesson worth keeping in the test: a UI decision and a capability decision are
   * different things, and this codebase drifted between them twice. So the assertions now
   * pin *reachability* — the console must offer both edit and delete — rather than pinning
   * a particular reading of what the console is for.
   */
  const section = stripComments(readFileSync("src/components/admin/registrations-section.tsx", "utf8"));

  /* Reaching the editor at all. */
  check("the list mounts the team editor", /<TeamEditor/.test(section), true);
  check("…offers an edit action", /onEdit/.test(section), true);
  check("…with a visible label, not just an icon",
    /Edit team/.test(section), true);
  check("…which opens exactly one editor at a time",
    /const \[editing, setEditing\] = React\.useState<string \| null>\(null\)/.test(section), true);

  /* The editor needs the tournament settings to know the roster rules and games. */
  check("…and is given the config it needs", /config=\{config\}/.test(section), true);
  check("the console passes the config down",
    /<RegistrationsSection[^>]*config=\{config\}/.test(
      stripComments(readFileSync("src/components/admin/admin-console.tsx", "utf8")),
    ), true);

  /* A save has to reach the list, or the row keeps showing the old values. */
  check("a saved team replaces its row", /entry\.id === saved\.id/.test(section), true);
  /* The server reports roster problems as warnings rather than refusing — an organiser
     part-way through rebuilding a squad must still be able to save — so they must be shown
     rather than swallowed. */
  check("…and the warnings are surfaced, not swallowed",
    /warnings\.length > 0/.test(section), true);

  /* Both roles. The route guards with `isAdminRequest`, which admits staff and the grand
     admin; an `isOwnerRequest` here would quietly make the button a grand-admin tool and
     contradict what was asked for. */
  const teamRoute = stripComments(readFileSync("src/app/api/admin/teams/[id]/route.ts", "utf8"));
  check("any signed-in organiser may edit", /isAdminRequest/.test(teamRoute), true);
  check("…staff included, so not owner-only", /isOwnerRequest/.test(teamRoute), false);
  check("…and a PATCH endpoint exists to save it",
    /export async function PATCH/.test(teamRoute), true);

  /*
   * **Deleting is still on the row, and still the only place.**
   *
   * It used to live inside `TeamEditor` alone, so unmounting the editor took the delete
   * button with it — the organiser reported exactly that ("the button was disappeared").
   * Removing the duplicate from the editor's footer leaves one irreversible action with one
   * route to it, rather than two depending on whether the editor happens to be open.
   */
  check("the list offers a delete action", /method: "DELETE"/.test(section), true);
  check("…on the team row, not inside an editor", /onDeleted/.test(section), true);
  check("…which reports the reference upward", /onDeleted\(typeof payload\.reference/.test(section), true);
  check("…and asks twice before doing it", /Yes, delete/.test(section) && /Keep/.test(section), true);
  /* The trigger is its own control with its own accessible name, not a click target
     nested inside the header button — nesting one button in another is invalid HTML and
     the browser usually lets the inner one eat the click, which would stop the row
     expanding. It also has to say *which* team it will delete. */
  check("…as its own labelled control",
    /aria-label=\{`Delete \$\{team\.reference\}`\}/.test(section), true);
  check("the editor no longer deletes as well",
    /method: "DELETE"/.test(stripComments(readFileSync("src/components/admin/team-editor.tsx", "utf8"))), false);
}

console.log("\n── The console's sheet link ──");
/* The spreadsheet's address is a separate setting from the webhook that writes to it, and
   the link is deliberately console-only — the sheet holds every player's contact details. */
{
  const env = process.env as Record<string, string | undefined>;
  const original = env.SHEET_URL;

  try {
    delete env.SHEET_URL;
    check("no SHEET_URL means no link", (await sheetUrl()), null);

    env.SHEET_URL = "   ";
    check("a blank SHEET_URL means no link", (await sheetUrl()), null);

    const real = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0";
    env.SHEET_URL = real;
    check("a real sheets address is accepted", (await sheetUrl()) !== null, true);
    check("it is recognised as a sheets address", looksLikeSheetUrl(real), true);
    /* The webhook is a script.google.com URL, which must NOT be mistaken for the sheet. */
    check("the Apps Script URL is not a sheets address",
      looksLikeSheetUrl("https://script.google.com/macros/s/AKfycb/exec"), false);

    /* The value lands in an href on the console — the one page holding every setting and
       every registration — so a non-http scheme must be refused, not rendered. */
    env.SHEET_URL = "javascript:alert(1)";
    check("a javascript: URL is refused", (await sheetUrl()), null);
    env.SHEET_URL = "data:text/html,<script>alert(1)</script>";
    check("a data: URL is refused", (await sheetUrl()), null);
    env.SHEET_URL = "not a url at all";
    check("a malformed URL is refused", (await sheetUrl()), null);
  } finally {
    if (original === undefined) delete env.SHEET_URL;
    else env.SHEET_URL = original;
  }

  /* Where the link is rendered, asserted from the source: it belongs behind the console's
     sign-in, never on the page entrants use. */
  const publicSources = [
    "src/app/page.tsx",
    "src/components/form/registration-wizard.tsx",
    "src/components/form/success-panel.tsx",
    "src/components/form/step-review.tsx",
  ];
  for (const path of publicSources) {
    const source = stripComments(readFileSync(path, "utf8"));
    check(`${path.split("/").pop()} does not link to the sheet`,
      /sheetUrl|SHEET_URL|docs\.google\.com\/spreadsheets/.test(source), false);
  }
  check("the console's registrations section renders the link",
    /sheetUrl && \(/.test(readFileSync("src/components/admin/registrations-section.tsx", "utf8")), true);
  /* Both doors pass it, because staff may export too. */
  for (const path of ["src/app/admin/page.tsx", "src/app/admin/staff/page.tsx"]) {
    check(`${path.split("/").slice(-2)[0]} passes the sheet link`,
      /sheetUrl=\{await sheetUrl\(\)\}/.test(readFileSync(path, "utf8")), true);
  }
  check("the example env documents SHEET_URL",
    /SHEET_URL=/.test(readFileSync(".env.example", "utf8")), true);
}

/**
 * `ADMIN_SECRET` may hold a hash rather than the secret itself.
 *
 * The interesting cases are the boundaries: that a hash accepts its own password and
 * nothing else, that salted hashes of the same password differ, that the old plaintext
 * form still works so nobody is locked out by this change, and that a hash we cannot
 * verify is **refused** rather than silently compared as if it were the literal password.
 */
async function hashedSecretChecks() {
  const env = process.env as Record<string, string | undefined>;
  const original = { secret: env.ADMIN_SECRET, url: env.DATABASE_URL };
  const password = "correct horse battery staple";

  /* **Bootstrap conditions on purpose.** `ADMIN_SECRET` is a credential only while no
     password is stored, and without a database there is nowhere one could be stored — so
     removing `DATABASE_URL` here is what puts the battery on the path it is testing. It
     also keeps the suite independent of whatever is exported in the shell, which is how
     these checks failed the first time: a `DATABASE_URL` inherited from the environment
     made the credential check try to read a row, fail, and correctly refuse. */
  delete env.DATABASE_URL;

  try {
    /* --- scrypt, the recommended form ------------------------------------ */
    const hashed = hashAdminSecret(password);
    check("a generated secret is a scrypt value", hashed.startsWith("scrypt:"), true);
    /* Two hashes of one password must differ, or the salt is not doing its job and the
       same password would be recognisable across deployments. */
    check("hashing twice gives different values", hashAdminSecret(password) !== hashed, true);

    env.ADMIN_SECRET = hashed;
    check("a hashed secret is recognised as hashed", await adminSecretIsHashed(), true);
    check("the right password is accepted", await checkAdminSecret(password), true);
    check("a wrong password is refused", await checkAdminSecret("something else entirely"), false);
    check("a prefix of the password is refused", await checkAdminSecret(password.slice(0, -1)), false);
    /* Appending a character is a real variant; a trailing *space* is not, because the
       verifier trims before comparing — see the tolerance check below. */
    check("the password plus a character is refused", await checkAdminSecret(`${password}x`), false);
    check("an empty candidate is refused", await checkAdminSecret(""), false);
    check("a null candidate is refused", await checkAdminSecret(null), false);
    /* Surrounding whitespace is trimmed before comparing, so a pasted secret works. */
    check("surrounding whitespace is tolerated", await checkAdminSecret(`  ${password}  `), true);

    /* --- sha256, for a hash from a general-purpose tool ------------------ */
    const { createHash } = await import("node:crypto");
    env.ADMIN_SECRET = `sha256:${createHash("sha256").update(password).digest("hex")}`;
    check("a sha256 secret is recognised as hashed", await adminSecretIsHashed(), true);
    check("the sha256 form verifies", await checkAdminSecret(password), true);
    check("the sha256 form rejects a wrong password", await checkAdminSecret("nope"), false);
    /* Uppercase hex is the same hash, and a person pasting one should not be locked out. */
    env.ADMIN_SECRET = `sha256:${createHash("sha256").update(password).digest("hex").toUpperCase()}`;
    check("uppercase hex is accepted", await checkAdminSecret(password), true);

    /* --- plaintext, so this change cannot lock anyone out --------------- */
    env.ADMIN_SECRET = "an-ordinary-secret";
    check("a plaintext secret still works", await checkAdminSecret("an-ordinary-secret"), true);
    check("a plaintext secret rejects a wrong value", await checkAdminSecret("other"), false);
    check("a plaintext secret is not reported as hashed", await adminSecretIsHashed(), false);

    /* --- values we cannot verify are refused, not misinterpreted -------- */
    /* The failure to avoid: treating `$2b$10$…` as the literal password. That would
       "work" for whoever knew the hash, which is the opposite of the point. */
    for (const [label, value] of [
      ["bcrypt", "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"],
      ["argon2", "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG"],
    ] as const) {
      env.ADMIN_SECRET = value;
      check(`a ${label} hash is refused, not compared as plaintext`,
        await checkAdminSecret(value), false);
    }

    /* A malformed recognised prefix must not fall through to a plaintext compare either —
       that would make the literal string "scrypt:…" a valid password. */
    env.ADMIN_SECRET = "scrypt:onlyonesegment";
    check("a malformed scrypt value is refused", await checkAdminSecret("scrypt:onlyonesegment"), false);
    env.ADMIN_SECRET = "sha256:nothex";
    check("a malformed sha256 value is refused", await checkAdminSecret("sha256:nothex"), false);

    /* --- the tool and the verifier cannot drift ------------------------- */
    const generator = readFileSync("scripts/hash-admin-secret.ts", "utf8");
    check("the generator uses the shared hashing function",
      /hashAdminSecret/.test(generator), true);
    /* No argument path for the password: argv is world-readable in the process list. */
    check("the generator never reads the password from argv",
      /process\.argv/.test(stripComments(generator)), false);
    check("the generator reads it from stdin", /process\.stdin/.test(generator), true);
    check("admin:hash is a runnable npm script",
      /"admin:hash":/.test(readFileSync("package.json", "utf8")), true);
  } finally {
    if (original.secret === undefined) delete env.ADMIN_SECRET;
    else env.ADMIN_SECRET = original.secret;
    if (original.url === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = original.url;
  }
}

/**
 * The stored password is the credential; `ADMIN_SECRET` is bootstrap only.
 *
 * The rule the organisers asked for: once a password exists, the deployment secret must
 * stop being a way in, or rotating the password achieves nothing against somebody who
 * holds the secret.
 *
 * Behaviourally testable without PostgreSQL, because of how the rule is written: with **no
 * database configured at all** there is nowhere a password could live, so `ADMIN_SECRET` is
 * the only credential and this exercises the real `adminLogin` path. The "a password row
 * exists" half is pinned in the source assertions above, since it needs a database.
 */
async function lockoutEscapeChecks() {
  const env = process.env as Record<string, string | undefined>;
  const original = { secret: env.ADMIN_SECRET, url: env.DATABASE_URL };

  env.ADMIN_SECRET = "test-root-secret-for-bootstrap";
  delete env.DATABASE_URL;

  const attempt = (candidate: string) =>
    adminLogin(new Request("http://localhost/api/admin/verify", { method: "POST" }), candidate);

  try {
    /* With no database, the secret is the bootstrap credential and is accepted. */
    const accepted = await attempt("test-root-secret-for-bootstrap");
    check("with no database the secret is accepted as bootstrap", accepted.ok, true);

    /* It is not accepted when it is merely close. */
    const nearly = await attempt("test-root-secret-for-bootstra");
    check("a near-miss secret is refused", nearly.ok, false);

    /* The lockout still applies to it. Two more wrong guesses reach the ceiling. */
    await attempt("wrong-1");
    await attempt("wrong-2");
    const lockedOut = await attempt("wrong-3");
    check("the third wrong guess locks the caller out",
      !lockedOut.ok && lockedOut.retryAfterSeconds > 0, true);

    /* And the correct secret is refused during the lockout — including for the bootstrap
       credential, because a lockout that exempted it would be no lockout at all. The way
       back is to wait, or to reset out of band with `npm run admin:reset`. */
    const duringLockout = await attempt("test-root-secret-for-bootstrap");
    check("the secret is refused while locked out",
      !duringLockout.ok && duringLockout.retryAfterSeconds > 0, true);

    /* An empty submission never counts as a guess, so a scanner cannot lock the organiser
       out by posting nothing. */
    const empty = await attempt("");
    check("an empty submission is refused without counting", empty.ok, false);
  } finally {
    if (original.secret === undefined) delete env.ADMIN_SECRET;
    else env.ADMIN_SECRET = original.secret;
    if (original.url === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = original.url;
  }
}

/**
 * The grand admin's stored password.
 *
 * The password moved out of the environment and into the database, which is a real trade:
 * a stolen dump used to give up contact details and nothing else. These checks are about
 * the mitigations that buy that back — the pepper above all.
 */
async function credentialChecks() {
  const pepper = Buffer.from("a-test-pepper-that-never-reaches-the-database", "utf8");
  const password = "correct horse battery staple";

  /* --- hashing and verification --------------------------------------- */
  /* No pepper by default: an empty buffer means the hash depends only on the password and the
     database, so it verifies identically in every environment. That is the property that was
     missing, and it is why a password set locally failed on a deployment. */
  const unpeppered = hashCredential(password, Buffer.alloc(0));
  check("an unpeppered hash is tagged as such",
    unpeppered.startsWith("scrypt:"), true);
  check("…and not confused with the peppered form",
    unpeppered.startsWith("scrypt-pepper:"), false);
  check("the password does not appear in the stored value",
    unpeppered.includes(password), false);
  check("an unpeppered hash verifies",
    await verifyCredential(unpeppered, password, Buffer.alloc(0)), true);
  check("…and rejects a wrong password",
    await verifyCredential(unpeppered, "wrong", Buffer.alloc(0)), false);
  /* The whole point of the change: a pepper supplied elsewhere must NOT change the answer,
     because the stored value records that it was not peppered. */
  check("an unpeppered hash still verifies when a pepper is available",
    await verifyCredential(unpeppered, password, Buffer.from("unrelated", "utf8")), true);

  /* --- the peppered form is still supported, and still strong --------- */
  const stored = hashCredential(password, pepper);
  check("a peppered hash is tagged as such", stored.startsWith("scrypt-pepper:"), true);
  check("the peppered hash does not contain the password", stored.includes(password), false);
  check("the stored value has a salt and a digest", stored.split(":").length, 3);

  check("the right password verifies", await verifyCredential(stored, password, pepper), true);
  check("a wrong password is refused", await verifyCredential(stored, "wrong", pepper), false);
  check("an empty password is refused", await verifyCredential(stored, "", pepper), false);
  check("a missing stored value is refused", await verifyCredential(null, password, pepper), false);
  check("a malformed stored value is refused",
    await verifyCredential("scrypt:onlyonepart", password, pepper), false);
  check("a foreign format is refused",
    await verifyCredential("scrypt-pepper:abc:def", password, Buffer.alloc(0)), false);

  /* --- the pepper, when used, is what protects a stolen dump ---------- */
  /* Leaving the old coupling behind: the same password under a different pepper must not
     verify, or a peppered deployment would accept a hash made anywhere else. */
  const otherPepper = Buffer.from("a different server secret entirely", "utf8");
  check("the same password under a different pepper does not verify",
    await verifyCredential(stored, password, otherPepper), false);
  /* A peppered value cannot be checked with no pepper. Reported, not silently refused — the
     message is what stops this reading as "wrong password". */
  check("a peppered hash with no pepper is refused",
    await verifyCredential(stored, password, Buffer.alloc(0)), false);

  /* Two hashes of one password must differ, or the salt is missing. */
  check("hashing twice gives different values", hashCredential(password, pepper) !== stored, true);
  /* …and the async form must agree with the sync one, since requests use it. */
  const asyncStored = await hashCredentialAsync(password, pepper);
  check("the async form verifies too", await verifyCredential(asyncStored, password, pepper), true);

  check("the stored format is recognised", isCredentialHash(stored), true);
  check("a plaintext value is not mistaken for a stored hash", isCredentialHash("hunter2"), false);

  /* --- strength policy ------------------------------------------------ */
  /* The user's own example. `1234` has ten thousand possibilities: no amount of scrypt
     makes that expensive, which is why this is refused rather than warned about. */
  check("a four-digit password is refused", isPasswordStrong("1234"), false);
  check("the message says why it is refused",
    /at least 12 characters/.test(passwordProblem("1234") ?? ""), true);

  for (const weak of [
    "password12345",
    "CrownAdmin2026!",
    "qwertyuiop123",
    "aaaaaaaaaaaa",
    "abcdefghijkl",
    "123456789012",
  ]) {
    check(`${JSON.stringify(weak)} is refused`, isPasswordStrong(weak), false);
  }
  check("a passphrase of unrelated words is accepted",
    isPasswordStrong("correct horse battery staple"), true);
  check("a long mixed password is accepted", isPasswordStrong("Tf9$mq-Lz72!wB"), true);
  /* The tournament's own name is on the list, so a password built from it is refused even
     though it looks strong. Asserted, because it is the kind of refusal that reads as a bug
     unless someone knows it is deliberate. */
  check("a password containing the tournament name is refused",
    isPasswordStrong("Ksu!Crown-2026-esports"), false);
  check("…and the message names the offending word",
    /crown/.test(passwordProblem("Ksu!Crown-2026-esports") ?? ""), true);
  /* The composition rule must not become a rule that bans passphrases — that would push
     people towards short, symbol-studded passwords, which are the weaker choice. */
  check("a long lower-case passphrase is accepted on length alone",
    isPasswordStrong("the moon landing was staged in a kitchen"), true);
  /* Boundaries: one below the minimum is refused, and the message names the floor. */
  check("one below the minimum is refused", isPasswordStrong("A1!bcdefghi"), false);
  check("the minimum length is stated in the message",
    (passwordProblem("A1!bcdefghi") ?? "").includes(String(MIN_PASSWORD_LENGTH)), true);
  check("a short mixed password is still refused",
    isPasswordStrong("Ab1!cdefghi"), false);

  /* A hash pasted into the password field. Easy to do — the same project tells people to
     produce hashes with `npm run admin:hash` — and left unchecked it "succeeds": a hash of
     the hash is stored, and from then on the only thing that works is that exact hash text.
     The person signs in with their real password, is refused, and cannot see why. */
  for (const hashLike of [
    "scrypt:abc:def",
    "scrypt-pepper:abc:def",
    "sha256:" + "a".repeat(64),
    "  scrypt:abc:def  ",
  ]) {
    const problem = passwordProblem(hashLike);
    check(`${JSON.stringify(hashLike.slice(0, 18))}… is refused as hash-shaped`, problem !== null, true);
    check("…and the message explains it is a hash, not a password",
      /looks like a hash, not a password/.test(problem ?? ""), true);
  }
  /* The guard must not catch a password that merely starts with a similar word. */
  check("an ordinary password is not mistaken for a hash",
    isPasswordStrong("Scryptography-2026!"), true);

  /* --- the two credentials, and the route that guards them ------------- */
  const auth = stripComments(readFileSync("src/lib/admin-auth.ts", "utf8"));
  check("the environment secret is still checked", /checkEnvAdminSecret/.test(auth), true);
  /* Both must be tried, or the root credential would stop working and a forgotten password
     would become a lockout with no way back in. */
  check("the stored password is tried before the root",
    /verifyAdminCredentials\(candidate\.trim\(\)\)/.test(auth), true);
  /* ⚠️ The pepper must NOT be derived from ADMIN_SECRET. That coupling is what made a
     password set locally stop working on a deployment — silently, and reading as "wrong
     password". Its own variable, empty by default. */
  check("the pepper is its own variable", /getEnv\("ADMIN_PEPPER"\)/.test(auth), true);
  check("the pepper is empty when unset",
    /const configured = \(await getEnv\("ADMIN_PEPPER"\)\)\?\.trim\(\);\s*if \(!configured\) return Buffer\.alloc\(0\)/.test(auth),
    true);
  /* Checked on the function body alone: a window wide enough to catch the next function
     would match an `adminSecret()` call there and pass for the wrong reason. */
  {
    const body = /export async function adminPepper\(\): Promise<Buffer> \{([\s\S]*?)\n\}/.exec(auth)?.[1] ?? "";
    check("the pepper function was found", body.length > 0, true);
    check("the pepper is not derived from ADMIN_SECRET", /adminSecret\(\)/.test(body), false);
  }

  const route = stripComments(readFileSync("src/app/api/admin/password/route.ts", "utf8"));
  check("the password route is owner-only", /isOwnerRequest/.test(route), true);
  /* Every mutation re-proves the current credential — that is about the unlocked laptop,
     not about the session. */
  check("setting a password requires the current credential",
    /adminLogin\(request, current\)/.test(route), true);
  check("removing a password requires it too",
    (route.match(/adminLogin\(request,/g) ?? []).length, 2);
  /* The policy runs on the server; the browser's copy is a courtesy. */
  check("the strength policy runs on the server", /passwordProblem\(password\)/.test(route), true);
  /* Never echo the credential back. */
  check("the password is never returned", /password:\s*password|passwordHash:/.test(route), false);
}

console.log("\n── Rate-limit keys cannot be chosen by the caller ──");
/*
 * Confirmed vulnerability: `clientKey` trusted `x-vercel-forwarded-for` **first and
 * unconditionally**. On Vercel the edge overwrites it, but on nginx (or any container
 * platform) it is simply a header the client sends, so rotating it produced a fresh bucket
 * per request and defeated every IP-keyed control — OTP request quotas, submission limits,
 * and the admin brute-force lockout. The external report rated it High and it reproduces.
 */
{
  const original = { vercel: process.env.VERCEL, trusted: process.env.TRUSTED_IP_HEADER };
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/api/x", { headers });

  try {
    delete process.env.VERCEL;
    delete process.env.TRUSTED_IP_HEADER;

    /* The attack: a forged platform header on a non-Vercel deployment. */
    check("a forged x-vercel-forwarded-for is ignored off Vercel",
      await callerAddress(req({ "x-vercel-forwarded-for": "1.2.3.4" })), "local");
    /*
     * **`X-Forwarded-For` is not trusted at all off-Vercel.**
     *
     * The first version of this fix fell back to the *rightmost* entry, reasoning that a
     * proxy which appends puts the real address last. That only holds if a proxy is
     * actually there — and it is not, on a directly reachable deployment. Verified: a client
     * sending three different values got three different buckets, i.e. still
     * attacker-chosen. Rotation is therefore useless to an attacker now: every request
     * lands in the same shared bucket.
     */
    const rotated: string[] = [];
    for (const spoof of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      rotated.push(await callerAddress(req({ "x-forwarded-for": spoof })));
    }
    check("rotating X-Forwarded-For gives one bucket, not many",
      new Set(rotated).size, 1);
    check("…and that bucket is the shared one", rotated[0], "local");
    check("an appended chain is not trusted either",
      await callerAddress(req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" })), "local");
    /* Also client-settable, so not read implicitly at all — trusting it as a last resort
       would reopen the same hole. */
    check("a bare x-real-ip is not trusted by default",
      await callerAddress(req({ "x-real-ip": "7.7.7.7" })), "local");
    check("no headers falls back to one shared bucket",
      await callerAddress(req({})), "local");

    /* On Vercel the platform overwrites these, so they are authoritative there. */
    process.env.VERCEL = "1";
    check("on Vercel the edge header is used",
      await callerAddress(req({ "x-vercel-forwarded-for": "1.2.3.4" })), "1.2.3.4");
    check("on Vercel a bare X-Forwarded-For is still ignored",
      await callerAddress(req({ "x-forwarded-for": "9.9.9.9" })), "local");
    delete process.env.VERCEL;

    /* An operator naming the authoritative header is the precise answer. */
    process.env.TRUSTED_IP_HEADER = "x-real-ip";
    check("TRUSTED_IP_HEADER is honoured",
      await callerAddress(req({ "x-real-ip": "7.7.7.7" })), "7.7.7.7");
    check("…and outranks a forged platform header",
      await callerAddress(req({ "x-real-ip": "7.7.7.7", "x-vercel-forwarded-for": "1.2.3.4" })),
      "7.7.7.7");
    /* Configuring trust must never end up trusting *more* than nothing: if the named
       header is absent, do not fall back to something the client wrote. */
    check("a configured-but-absent header does not fall back to X-Forwarded-For",
      await callerAddress(req({ "x-forwarded-for": "5.5.5.5" })), "local");
  } finally {
    if (original.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original.vercel;
    if (original.trusted === undefined) delete process.env.TRUSTED_IP_HEADER;
    else process.env.TRUSTED_IP_HEADER = original.trusted;
  }

  /* And the source must not drift back. */
  const source = stripComments(readFileSync("src/lib/rate-limit.ts", "utf8"));
  check("the trust decision is gated on VERCEL",
    /if \(await getEnv\("VERCEL"\)\)/.test(source), true);
  check("X-Forwarded-For is never read as a fallback",
    /headers\.get\("x-forwarded-for"\)/.test(source), false);
  check("x-real-ip is not read implicitly", /return realIp \|\| "local"/.test(source), false);
}

console.log("\n── Spreadsheet formula injection in every export ──");
/*
 * Confirmed vulnerability: the Sheets export defused formulas; the **CSV export did not**.
 * `quote()` only doubled quotes — CSV *syntax* — which says nothing about a cell beginning
 * `=`. `gameTagPolicyError` accepts `=cmd|' /C calc'!A0`, so a player could register with it
 * and have it run on the organiser's machine when the CSV was opened.
 */
{
  /* --- control characters and whitespace -------------------------------- */
  /*
   * Found by testing the matrix rather than the happy path: the original pattern listed
   * `\t` and `\r` but **not `\n`**, so `"\n=1+1"` was not defused while `"\r=1+1"` was —
   * an inconsistency, not a decision. Whitespace-prefixed formulas (`" =1+1"`) also passed.
   */
  for (const hostile of ["\n=1+1", "\n\n=1+1", " =1+1", " @SUM(A1)", " \t=1+1", "\u0000=1+1"]) {
    check(`${JSON.stringify(hostile)} is defused`, plainText(hostile).startsWith("'"), true);
  }
  /* Ordinary text must survive untouched, including a newline *inside* the value. */
  for (const ordinary of ["Team Falcons", "line1\nline2", "a,b,c", 'he said "hi"', "فريق الصقور", "Team 🦅", ""]) {
    check(`${JSON.stringify(ordinary)} passes through unchanged`, plainText(ordinary), ordinary);
  }
  /* Deliberately conservative: a leading control character is defused even when no formula
     character follows, because importers differ over whether they trim it first. */
  check("a leading newline is defused even without a formula",
    plainText("\nnotes").startsWith("'"), true);
  check("plainText defuses a plus-led value", plainText("+1"), "'+1");
  check("plainText defuses an at-led value", plainText("@SUM(A1)"), "'@SUM(A1)");
  check("plainText leaves ordinary text alone", plainText("Team Falcons"), "Team Falcons");

  /* The reachability that made it exploitable: validation does not stop it. */
  check("a game tag may legally contain a formula",
    gameTagPolicyError("=cmd|' /C calc'!A0"), null);
  /* …which is exactly why the export must defuse it rather than lean on validation. */
  check("…and the sheet export defuses it",
    (teamToPlayerRows({
      reference: "KSU-26-TEST01",
      teamName: "Team X",
      gameName: "Valorant",
      gender: "male",
      division: "male",
      consentedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      members: [
        {
          role: "STARTER",
          fullName: "Probe Player",
          gameTag: "=1+1",
          universityName: "King Saud University",
          universityRegion: "Riyadh",
          email: "probe@student.ksu.edu.sa",
          studentId: "441234567",
          discord: "probe",
          phone: "+966512345678",
          requirements: [],
          emailVerifiedAt: null,
        },
      ],
    } as never)[0] as Record<string, string>)["Game Tag"],
    "'=1+1");

  /* Both export paths, asserted from source: a third path that forgets is how this returns. */
  const section = stripComments(readFileSync("src/components/admin/registrations-section.tsx", "utf8"));
  check("the CSV export defuses every cell", /\.map\(cell\)/.test(section), true);
  check("the CSV cell helper applies plainText", /plainText\(value\)/.test(section), true);
  check("the CSV export no longer quotes raw values",
    /\.map\(quote\)/.test(section), false);
}

console.log("\n── The edit-lookup endpoint is not an existence oracle ──");
/*
 * Confirmed vulnerability (missed by the external report): the RES-04 fix made the *happy
 * path* identical but left three tells for an unauthenticated caller.
 *
 *   1. `maskedEmail` was returned before the code was verified, and the stand-in for an
 *      unknown reference was `@ksu.edu.sa` with a ten-character local part while every real
 *      team is `@student.ksu.edu.sa` with nine — the mask itself answered the question, and
 *      disclosed part of a real address besides.
 *   2. When the mailer was down, a real reference returned **502** with `emailFailed` and an
 *      unknown one returned **200**. Verified live: 502 vs 200, decisive.
 *   3. The send was awaited, so a real reference took seconds and an unknown one
 *      milliseconds.
 */
{
  const route = stripComments(readFileSync("src/app/api/registrations/lookup/route.ts", "utf8"));

  /* 1 — nothing team-specific before verification. */
  check("the pre-verification response carries no masked address",
    /maskedEmail/.test(route), false);
  check("…and no delivery-failure signal", /emailFailed/.test(route), false);
  /* 3 — the send must not be on the response path. */
  check("the edit code is sent after the response", /after\(async \(\) =>/.test(route), true);
  /* The await must live *inside* the deferred callback — that is the whole point. A bare
     "does the string appear" check would pass even with the send back on the hot path. */
  {
    const inline = /\n\s{6}await sendOtpEmail\(normalised, fresh, "edit-access"/.test(route);
    check("the send is not awaited by the route handler itself", inline, false);
    check("…it is awaited inside the deferred callback",
      /after\(async \(\) => \{[\s\S]{0,400}await sendOtpEmail\(normalised, fresh, "edit-access"/.test(route),
      true);
  }
  /* The failure is still handled, just not disclosed to the caller. */
  check("a failed send is logged", /could not send the edit code/.test(route), true);
  check("…and the row is discarded so it does not spend a send",
    /discardOtp\(record\.id\)/.test(route), true);

  /* An unknown reference still cannot obtain editing access. */
  check("a correct code against an unknown reference is still refused",
    /if \(!team \|\| !identity\)[\s\S]{0,180}That code has expired/.test(route), true);

  /* 2 — unbounded OTP growth via rotating references. */
  check("the edit-lookup endpoint has a site-wide ceiling",
    /countAllRecentOtps\("edit-access"/.test(route), true);
  /*
   * …and the ceiling must **not** refuse a real reference.
   *
   * It used to refuse everybody once tripped, which handed any script a trivial denial of
   * service: burn the quota with junk references and no team can fetch an edit code for the
   * rest of the window. Measured — with the ceiling at four, seven consecutive requests were
   * refused, legitimate ones included. Now the ceiling only stops *row creation* for an
   * unknown reference, and the response is unchanged either way.
   */
  check("the ceiling is scoped to unknown references",
    /if \(!deliverable && overGlobalCeiling\)/.test(route), true);
  check("…and that branch still answers exactly as usual",
    /overGlobalCeiling[\s\S]{0,400}stage: "code-sent"/.test(route), true);
  check("…rather than returning an error", /We are sending a lot of codes right now/.test(route), false);
  const otpRequest = stripComments(readFileSync("src/app/api/otp/request/route.ts", "utf8"));
  check("the player code endpoint has one too",
    /countAllRecentOtps\("player-email"/.test(otpRequest), true);
  const otp = readFileSync("src/lib/otp.ts", "utf8");
  check("the ceiling is a number, not a placeholder",
    /export async function otpGlobalMax\(\): Promise<number>/.test(otp), true);
  /* `OTP_GLOBAL_MAX` exists so an operator can tune it and so this suite can lower it to
     exercise the ceiling without minting three hundred codes. A value that is not a
     positive integer must be ignored — a typo cannot be allowed to disable the brake. */
  check("the ceiling can be configured", /getEnv\("OTP_GLOBAL_MAX"\)/.test(otp), true);
  check("a nonsense override is ignored rather than trusted",
    /Number\.isInteger\(parsed\) && parsed > 0 \? parsed : 300/.test(otp), true);
}

console.log("\n── Transport and response headers ──");
{
  const config = readFileSync("next.config.mjs", "utf8");
  check("HSTS is sent",
    /Strict-Transport-Security/.test(config), true);
  /* Not on a dev server: HSTS is per-host and would pin localhost to HTTPS for every other
     project on the machine. */
  check("HSTS is production-only", /max-age=63072000; includeSubDomains/.test(config), true);
  check("preload is left out of the header value",
    /max-age=63072000; includeSubDomains"/.test(config), true);
  check("the frame exception is still scoped to rulebooks",
    /X-Frame-Options", value: "SAMEORIGIN"/.test(config), true);
  /*
   * Every response class, not just the blanket one.
   *
   * The rulebook path is *excluded* from the blanket rule — that is how it gets
   * `SAMEORIGIN` — so anything the blanket rule sets was missing from it. Verified against a
   * production build: `/api/games/ea-fc-26/rulebook` carried no `Strict-Transport-Security`
   * at all. And a trailing-slash 308 is emitted by Next before middleware, with no headers
   * whatsoever; that one is documented as the edge's job rather than silently claimed.
   */
  const rulebookRule =
    config.slice(config.indexOf('source: "/api/games/:gameId/rulebook"'),
                 config.indexOf('source: "/:path(')) ?? "";
  check("the rulebook rule was found", rulebookRule.length > 0, true);
  check("the rulebook response carries HSTS", /Strict-Transport-Security/.test(rulebookRule), true);
  check("…and still allows framing by this site", /SAMEORIGIN/.test(rulebookRule), true);
  /* Middleware sets it too, so the CSP kill-switch branch is covered as well. */
  const middleware = readFileSync("src/middleware.ts", "utf8");
  check("middleware also sets HSTS", /Strict-Transport-Security/.test(middleware), true);
  check("…and records why redirects are the edge's job",
    /trailing-slash redirect[\s\S]{0,40}carries none/.test(middleware), true);
  /* A comment that overclaims is how a known gap gets mistaken for a closed one, so the
     limitation stays in a comment and never appears in the code as if it were handled. */
  check("…and no code claims to attach headers to that redirect",
    /skipTrailingSlashRedirect/.test(stripComments(middleware)), false);
}

console.log("\n── University email domains ──");
{
  /*
   * Each university accepts only its own domains.
   *
   * The rule was a **warning** before this: a team could enter any university's address
   * and still submit, with the mismatch printed as a note nobody had to act on. It is
   * now an error, checked in the browser, in the API, and in the admin console's edit
   * path — because an organiser editing a team is not a way to put another
   * institution's address on a roster either.
   *
   * King Saud is the case that needed the most care: its students hold
   * `@student.ksu.edu.sa`, so the institutional `@ksu.edu.sa` is **not** accepted. That
   * is deliberate, but it means a fixture on the parent domain is now a failure — which
   * is why several in this file were corrected when the rule landed.
   */
  const ksu = UNIVERSITIES.find((u) => u.id === "ksu")!;
  const kau = UNIVERSITIES.find((u) => u.id === "kau")!;
  const kfupm = UNIVERSITIES.find((u) => u.id === "kfupm")!;
  const alfaisal = UNIVERSITIES.find((u) => u.id === "alfaisal")!;

  check("KSU students use the student subdomain",
    acceptedEmailDomains(ksu), ["student.ksu.edu.sa"]);
  check("a KSU student address is accepted",
    emailMatchesUniversity("441313142@student.ksu.edu.sa", ksu), true);
  check("…and the institutional domain is not", emailMatchesUniversity("ali@ksu.edu.sa", ksu), false);
  check("…nor is another university's", emailMatchesUniversity("ali@kau.edu.sa", ksu), false);
  check("…nor a public mailbox", emailMatchesUniversity("ali@gmail.com", ksu), false);
  /* A lookalike that merely *contains* the domain must not pass. */
  check("…nor a lookalike domain",
    emailMatchesUniversity("ali@student.ksu.edu.sa.example.com", ksu), false);
  /* A real subdomain of an accepted domain still belongs to the university. */
  check("a deeper subdomain is still KSU",
    emailMatchesUniversity("ali@mail.student.ksu.edu.sa", ksu), true);

  check("KAU keeps its own student subdomain",
    acceptedEmailDomains(kau), ["stu.kau.edu.sa"]);
  check("KAU's institutional domain is refused too",
    emailMatchesUniversity("ali@kau.edu.sa", kau), false);

  /* Universities whose students use the main domain fall back to it — the strictness is
     per institution, not a demand that every one has a subdomain. */
  check("a university with no student subdomain accepts its own domain",
    emailMatchesUniversity("ali@kfupm.edu.sa", kfupm), true);
  check("…and rejects its neighbours'",
    emailMatchesUniversity("ali@ksu.edu.sa", kfupm), false);

  /* `.edu` rather than `.edu.sa` — the old pattern refused this outright, which made
     Alfaisal unregistrable no matter which domain was typed. */
  check("a university on .edu is accepted",
    emailMatchesUniversity("ali@alfaisal.edu", alfaisal), true);

  /* The form's live hint fires before the university is known, so it can only ask
     "does any university use this domain?". A public mailbox is wrong regardless. */
  check("a public mailbox is flagged as the address is typed",
    revealsImmediately("email", "ali@gmail.com"), true);
  check("a university address is not flagged",
    revealsImmediately("email", "441313142@student.ksu.edu.sa"), false);
  check("a half-typed address stays quiet", revealsImmediately("email", "ali@ksu"), false);

  /* The roster draft refuses a wrong-domain address, and says which domain was wanted —
     "wrong domain" alone leaves the reader guessing at a student subdomain they may not
     know exists. */
  const wrongDomain = validateDraft(
    {
      ...EMPTY_DRAFT,
      teamName: "Domain Probe",
      gender: "male",
      gameId: "ea-fc-26",
      leaderIndex: 0,
      members: [{
        fullName: "Ali Hassan", gameTag: "ALI", universityId: "ksu",
        email: "ali@ksu.edu.sa", verifiedEmail: "ali@ksu.edu.sa", emailProof: "",
        studentId: "441234567", discord: "ali", phone: "0501234567",
        role: "STARTER", requirements: {},
      }],
    },
    normaliseConfig({ ...DEFAULT_TOURNAMENT }),
  );
  check("the roster refuses an address from the parent domain",
    wrongDomain.errors["member.0.email"],
    "ali@ksu.edu.sa is not a King Saud University address (expected student.ksu.edu.sa)");
  check("…and it is an error, not a warning",
    wrongDomain.warnings.some((w) => /King Saud/.test(w)), false);

  /*
   * **No address without a university.**
   *
   * The address is checked against the chosen institution's own domain, so with nothing
   * chosen there is no rule to check it against and any address would pass. Requiring the
   * choice first is what makes the rule real; the form also disables the field, so this
   * ordering is enforced in two places.
   */
  const noUniversity = validateDraft(
    {
      ...EMPTY_DRAFT,
      teamName: "No University",
      gender: "male",
      gameId: "ea-fc-26",
      leaderIndex: 0,
      members: [{
        fullName: "Ali Hassan", gameTag: "ALI", universityId: "",
        email: "ali@student.ksu.edu.sa", verifiedEmail: "ali@student.ksu.edu.sa",
        emailProof: "", studentId: "441234567", discord: "ali",
        phone: "0501234567", role: "STARTER", requirements: {},
      }],
    },
    normaliseConfig({ ...DEFAULT_TOURNAMENT }),
  );
  check("an address with no university chosen is refused",
    noUniversity.errors["member.0.email"],
    "Choose this member's university first — the address must be its domain");
  check("…and the university itself is flagged too",
    typeof noUniversity.errors["member.0.university"], "string");

  /* The same rule on the server, because the browser can be bypassed. */
  const noUniversityPayload = validatePayload(
    {
      tournamentName: DEFAULT_TOURNAMENT.tournamentName,
      teamName: "Team No University",
      gender: "male",
      gameId: "ea-fc-26",
      gameName: "EA FC 27",
      members: [{
        fullName: "Ali Hassan", gameTag: "ALI", universityId: "",
        universityName: "", universityRegion: "Other",
        email: "ali@student.ksu.edu.sa", studentId: "441234567", discord: "ali",
        phone: "0501234567", role: "STARTER", emailProof: "x", requirements: [],
      }],
      leaderIndex: 0,
      consentGiven: true,
      rulesAccepted: true,
    },
    normaliseConfig({ ...DEFAULT_TOURNAMENT }),
    { verifyEmail: () => true },
  );
  check("the API refuses an address with no university",
    noUniversityPayload.ok ? null : noUniversityPayload.errors["member.0.email"],
    "Choose the member's university first — the address must be its domain");

  /* And the field is disabled in the form, so the order is obvious rather than explained
     after the fact. */
  const rosterSource = stripComments(readFileSync("src/components/form/step-roster.tsx", "utf8"));
  /* Coaches may use a personal address, so the lock applies to players only. */
  check("the email field is disabled until a university is chosen",
    /disabled=\{!isCoach && !member\.universityId\}/.test(rosterSource), true);

  /* The server's copy of the rule: the browser can be bypassed, so the API re-checks. */
  const payload = {
    tournamentName: DEFAULT_TOURNAMENT.tournamentName,
    teamName: "Team Domain Probe",
    gender: "male",
    gameId: "ea-fc-26",
    gameName: "EA FC 27",
    members: [{
      fullName: "Ali Hassan", gameTag: "ALI", universityId: "ksu",
      universityName: "King Saud University", universityRegion: "Riyadh",
      email: "ali@ksu.edu.sa", studentId: "441234567", discord: "ali_probe",
      phone: "0501234567", role: "STARTER", emailProof: "x", requirements: [],
    }],
    leaderIndex: 0,
    consentGiven: true,
    rulesAccepted: true,
  };
  const serverCheck = validatePayload(payload, normaliseConfig({ ...DEFAULT_TOURNAMENT }), {
    verifyEmail: () => true,
  });
  check("the API refuses the same address",
    serverCheck.ok ? null : serverCheck.errors["member.0.email"],
    "ali@ksu.edu.sa is not a King Saud University address (expected student.ksu.edu.sa)");
}

console.log("\n── Student numbers read out of the address ──");
{
  /*
   * The organisers' list of student domains, and the two institutions that wrap the
   * number in literal text. Each row is asserted individually because the failure mode is
   * per-institution: one wrong domain means every student at that university is locked
   * out, and it would not show up as a general breakage.
   */
  const byId = (id: string) => UNIVERSITIES.find((u) => u.id === id);
  const rows: [string, string][] = [
    ["imamu",    "441234567@sm.imamu.edu.sa"],
    ["ksu",      "441234567@student.ksu.edu.sa"],
    ["pnu",      "441234567@pnu.edu.sa"],
    ["seu",      "s441234567@seu.edu.sa"],
    ["psau",     "441234567@std.psau.edu.sa"],
    ["um",       "441234567@student.um.edu.sa"],
    ["tvtc",     "441234567@tvtc.edu.sa"],
    ["ksau-hs",  "441234567@ksau-hs.edu.sa"],
    ["mu",       "441234567@s.mu.edu.sa"],
    ["su",       "s441234567@std.su.edu.sa"],
    ["psu",      "441234567@psu.edu.sa"],
    ["alfaisal", "441234567@alfaisal.edu"],
    ["yu",       "441234567@yu.edu.sa"],
    ["dau",      "441234567@du.edu.sa"],
    ["aou",      "441234567KSA@aou.edu.sa"],
    ["riyadh",   "441234567@student.riyadh.edu.sa"],
  ];

  for (const [id, email] of rows) {
    const university = byId(id);
    check(`${id} exists in the list`, Boolean(university), true);
    /* The address must be accepted *and* yield the number — a domain that passes but
       strips nothing would fill the field with the wrong value. */
    check(`${id}: accepts its student address`, university ? emailMatchesUniversity(email, university) : false, true);
    check(`${id}: the number is read out`, university ? studentIdFromEmail(email, university) : null, "441234567");
    /* The live reader and the strict one must never disagree about a *finished* address:
       the field shows the preview, so a preview that differed would display one number and
       store another. */
    check(`${id}: …and it is already showing`, university ? studentIdPreviewFromEmail(email, university) : null, "441234567");
  }

  /* The affixes are the part that is easy to get wrong in both directions. */
  const seu = byId("seu")!;
  const su = byId("su")!;
  const aou = byId("aou")!;
  const ksu = byId("ksu")!;

  check("a missing prefix is not ignored",
    studentIdFromEmail("441234567@seu.edu.sa", seu), null);
  check("the prefix is matched case-insensitively",
    studentIdFromEmail("S441234567@seu.edu.sa", seu), "441234567");
  check("a second institution with the same prefix works too",
    studentIdFromEmail("s441234567@std.su.edu.sa", su), "441234567");
  check("a missing suffix is not ignored",
    studentIdFromEmail("441234567@aou.edu.sa", aou), null);
  check("the suffix is matched case-insensitively",
    studentIdFromEmail("441234567ksa@aou.edu.sa", aou), "441234567");

  /*
   * **Nothing is guessed.** These are the cases where a wrong value in the student-ID
   * field would be worse than an unfilled one: the organisers use it to identify a person.
   */
  check("a non-numeric local part yields nothing",
    studentIdFromEmail("ali@student.ksu.edu.sa", ksu), null);
  check("another institution's domain yields nothing",
    studentIdFromEmail("441234567@sm.imamu.edu.sa", ksu), null);
  check("a public mailbox yields nothing",
    studentIdFromEmail("441234567@gmail.com", ksu), null);
  check("too few digits yields nothing",
    studentIdFromEmail("123@student.ksu.edu.sa", ksu), null);
  check("too many digits yields nothing",
    studentIdFromEmail("4412345678901234567890@student.ksu.edu.sa", ksu), null);
  /* Arabic-Indic digits, because an Arabic keyboard produces them and the rest of the
     form already folds them. */
  check("Arabic-Indic digits are folded",
    studentIdFromEmail("\u0664\u0664\u0661\u0662\u0663\u0664\u0665\u0666\u0667@student.ksu.edu.sa", ksu),
    "441234567");

  /*
   * **An institution the organisers added must keep these fields too.**
   *
   * That is not a detail: the two entries on the live deployment are organiser-added ones
   * (the built-in Saudi Electronic University is hidden, replaced by "Prince Musaid bin
   * Abdulrahman University"), and they were stored with an empty domain list. An entry
   * with no domain cannot be chosen by anybody — the address rule has nothing to match.
   * `normaliseExtraUniversity` therefore has to carry the student domain and the number
   * format through, or the console can save them and they vanish on the next read.
   */
  {
    const config = normaliseConfig({
      ...DEFAULT_TOURNAMENT,
      extraUniversities: [
        {
          id: "custom-uni",
          name: "Custom University",
          city: "Riyadh",
          sector: "Government",
          region: "Riyadh",
          emailDomains: ["Custom.EDU.sa"],
          studentDomains: ["student.custom.edu.sa"],
          studentIdFormat: { prefix: " s ", suffix: "KSA" },
        },
      ],
    });
    const custom = config.extraUniversities.find((u) => u.id === "custom-uni")!;
    check("an added university keeps its student domain",
      custom.studentDomains, ["student.custom.edu.sa"]);
    check("…and its number format, trimmed", custom.studentIdFormat, { prefix: "s", suffix: "KSA" });
    check("…and the student address is read", studentIdFromEmail("s441234567KSA@student.custom.edu.sa", custom), "441234567");

    /* An entry with nothing declared behaves exactly as before. */
    const bare = normaliseConfig({
      ...DEFAULT_TOURNAMENT,
      extraUniversities: [{ id: "bare", name: "Bare University", city: "Riyadh", sector: "Government", region: "Riyadh", emailDomains: ["bare.edu.sa"] }],
    }).extraUniversities.find((u) => u.id === "bare")!;
    check("an entry without a format stays plain", bare.studentIdFormat, undefined);
    check("…and still reads a plain address", studentIdFromEmail("441234567@bare.edu.sa", bare), "441234567");
  }

  /* The form must not clobber a number typed by hand: the rule it uses is "only overwrite
     what the previous address implied". Asserted at the source, because the component is
     not rendered in this suite; the rule itself is tested directly further down. */
  const roster = stripComments(readFileSync("src/components/form/step-roster.tsx", "utf8"));
  check("the email field fills the student number",
    /studentIdAfterEdit\(/.test(roster), true);
  check("…from the email field",
    /studentId: studentIdAfterEdit\(/.test(roster), true);
  check("…with the fill explained to the reader",
    /field\.studentIdFromEmail/.test(roster), true);
  check("the explanation is translated",
    t("ar", "field.studentIdFromEmail") !== t("en", "field.studentIdFromEmail"), true);
}

console.log("\n── The number appears as it is typed ──");
{
  /*
   * Reported as "the student ID should be written number by number as they type it".
   *
   * It was not, and that was a fair complaint: the only reader was the strict one, which
   * cannot answer for an incomplete address, so the fill arrived in one jump on the final
   * keystroke. For the nine digits before it the field sat empty, which looks exactly like
   * a fill that does not work. The preview reader answers for a partial address; these
   * assertions walk one address a keystroke at a time, which is what was being looked at.
   */
  const ksu = UNIVERSITIES.find((u) => u.id === "ksu")!;
  const seu = UNIVERSITIES.find((u) => u.id === "seu")!;
  const aou = UNIVERSITIES.find((u) => u.id === "aou")!;

  check("nothing typed, nothing shown", studentIdPreviewFromEmail("", ksu), null);
  check("letters are not a number", studentIdPreviewFromEmail("ali", ksu), null);

  /* KSU has no affixes: each digit lands as it is pressed. */
  const typed = "441234567@student.ksu.edu.sa";
  check("every prefix of the address yields its digits so far",
    Array.from({ length: 9 }, (_, i) => studentIdPreviewFromEmail(typed.slice(0, i + 1), ksu)).join(","),
    "4,44,441,4412,44123,441234,4412345,44123456,441234567");
  check("…and a half-typed domain keeps them",
    studentIdPreviewFromEmail("441234567@stu", ksu), "441234567");
  check("…and a finished address agrees with the strict rule",
    studentIdPreviewFromEmail(typed, ksu) === studentIdFromEmail(typed, ksu), true);

  /* An address heading somewhere else must take the provisional number with it, or a gmail
     address would leave a student number behind it in the field organisers read. */
  check("a domain heading elsewhere withdraws the number",
    studentIdPreviewFromEmail("441234567@gma", ksu), null);
  check("…as does a finished one elsewhere",
    studentIdPreviewFromEmail("441234567@gmail.com", ksu), null);
  check("…and another institution's domain",
    studentIdPreviewFromEmail("441234567@sm.imamu.edu.sa", ksu), null);

  /* SEU's leading `s` is one keystroke and may arrive first or still be to come. */
  check("SEU shows the digits with the prefix present",
    studentIdPreviewFromEmail("s44", seu), "44");
  check("…and with it still to come",
    studentIdPreviewFromEmail("44", seu), "44");
  /* AOU's trailing `KSA` arrives last and is never shown as part of the number. */
  check("AOU shows the digits while the suffix is half-typed",
    studentIdPreviewFromEmail("441234567KS", aou), "441234567");
  check("…and once it is complete",
    studentIdPreviewFromEmail("441234567KSA@aou.edu.sa", aou), "441234567");
  check("…and a single letter of it is not mistaken for a digit",
    studentIdPreviewFromEmail("441234567K", aou), "441234567");

  /* Arabic-Indic, because the number is typed on an Arabic keyboard as often as not. */
  check("Arabic-Indic digits show as Western ones",
    studentIdPreviewFromEmail("\u0664\u0664\u0661", ksu), "441");

  /* Bounded like the field itself, so a paste cannot present a value the input would refuse. */
  check("the preview is capped at the field's maximum",
    studentIdPreviewFromEmail("123456789012345678901234", ksu), "12345678901234567890");

  /* The component has to use it, and only to *show* a value — the strict reader still
     decides whether the address is good. Asserted at the source: the component is not
     rendered in this suite. */
  const roster = stripComments(readFileSync("src/components/form/step-roster.tsx", "utf8"));
  check("the field fills while the address is still being typed",
    /studentIdAfterEdit\(/.test(roster), true);
  check("…from the email field",
    /email,\s*\n?\s*studentId: studentIdAfterEdit\(/.test(roster), true);
  check("…and from the institution field",
    /const nextUniversity = universities\.find/.test(roster), true);

  /*
   * **The rule both handlers share**, now that it is one function instead of two copies.
   * These are the cases that decide whether a student number is trusted: it must follow
   * the typing, follow a change of institution, and never touch what a person chose.
   */
  const both = (current: string, fromEmail: string, toEmail: string) =>
    studentIdAfterEdit(current, { email: fromEmail, university: ksu }, { email: toEmail, university: ksu });

  check("an empty field follows the address",
    both("", "", "441234567@student.ksu.edu.sa"), "441234567");
  check("…and keeps following it as more is typed",
    both("441", "441@student.ksu.edu.sa", "4412@student.ksu.edu.sa"), "4412");
  check("a number the form put there is replaced",
    both("441234567", "441234567@student.ksu.edu.sa", "441888888@student.ksu.edu.sa"), "441888888");
  check("a number typed by hand is kept",
    both("999999999", "441234567@student.ksu.edu.sa", "441888888@student.ksu.edu.sa"), "999999999");
  check("emptying the field hands it back",
    both("", "441234567@student.ksu.edu.sa", "441888888@student.ksu.edu.sa"), "441888888");
  check("an address heading elsewhere clears it",
    both("441234567", "441234567@student.ksu.edu.sa", "441234567@gmail.com"), "");
  check("a number the address never implied is kept",
    both("441234567", "441@student.ksu.edu.sa", "441@student.ksu.edu.sa"), "441234567");

  /* A change of institution is the other half of the same rule: the affixes belong to the
     institution, so a number read under one rule must be re-read under the other. */
  check("changing institution re-reads the number",
    studentIdAfterEdit("441234567",
      { email: "441234567@student.ksu.edu.sa", university: ksu },
      { email: "441234567@student.ksu.edu.sa", university: aou }), "");
  check("…and fills it when the new institution's rule does fit",
    studentIdAfterEdit("",
      { email: "441234567@aou.edu.sa", university: ksu },
      { email: "441234567KSA@aou.edu.sa", university: aou }), "441234567");
  check("…without disturbing a number typed by hand",
    studentIdAfterEdit("999999999",
      { email: "441234567@student.ksu.edu.sa", university: ksu },
      { email: "441234567@student.ksu.edu.sa", university: aou }), "999999999");
  check("with no institution chosen, nothing is read",
    studentIdAfterEdit("", { email: "441234567@student.ksu.edu.sa" }, { email: "441234567@student.ksu.edu.sa" }), "");
}

console.log("\n── Team leadership ──");{
  /*
   * A 1v1 title fields one player, so leadership is not a question.
   *
   * It used to be treated as one: choosing a 1v1 game rebuilt the roster to one row,
   * the stored `leaderIndex` was cleared because it pointed past the end of the new
   * roster, and validation then refused to submit with "Select a team leader" — on a
   * team with nobody else to nominate. The only escape was a checkbox on the same row
   * the captain had already filled in.
   */
  const solo = normaliseConfig({ ...DEFAULT_TOURNAMENT, maxRoster: 6 });
  const soloGame = { squadSize: 1, maxSubstitutes: 0, maxCoaches: 0 };
  const soloRules = rosterRulesFor(solo, soloGame);

  const onePlayer = (leaderIndex: number | null): RegistrationDraft => ({
    ...EMPTY_DRAFT,
    teamName: "Solo Cup",
    gender: "male",
    gameId: "ea-fc-26",
    members: [{ ...emptyMember("STARTER"), fullName: "Ali Hassan", requirements: {} }],
    leaderIndex,
  });

  check("a one-player roster has exactly one candidate", soloRules.starters, 1);
  check("…so leadership is automatic when the draft has no choice",
    effectiveLeaderIndex(onePlayer(null), soloRules), 0);
  check("…and a stale index cannot point outside the roster",
    effectiveLeaderIndex(onePlayer(5), soloRules), 0);
  check("…and the automatic leader passes validation", "leader" in validateDraft(
    { ...onePlayer(null),
      members: [{
        fullName: "Ali Hassan", gameTag: "ALI", universityId: "ksu",
        email: "ali@ksu.edu.sa", verifiedEmail: "ali@ksu.edu.sa", emailProof: "",
        studentId: "441234567", discord: "ali", phone: "0501234567",
        role: "STARTER", requirements: {},
      }],
    },
    solo,).errors, false);

  /* **The registrant is the leader**, so the form no longer asks and no manual
     choice can outrank the first row. A saved draft carrying an older `leaderIndex`
     must not move leadership to somebody the form never offered — the first
     playable row stands. */
  const pairRules = rosterRulesFor(solo, { squadSize: 3, maxSubstitutes: 2, maxCoaches: 1 });
  const pair = (leaderIndex: number | null): RegistrationDraft => ({
    ...EMPTY_DRAFT,
    gameId: "rocket-league",
    members: [
      { ...emptyMember("STARTER"), fullName: "A", requirements: {} },
      { ...emptyMember("STARTER"), fullName: "B", requirements: {} },
    ],
    leaderIndex,
  });
  check("the first row leads with nothing recorded",
    effectiveLeaderIndex(pair(null), pairRules), 0);
  check("an older stored choice cannot move leadership",
    effectiveLeaderIndex(pair(1), pairRules), 0);

  /* A coach cannot lead — `validateDraft` refuses that already, so the helper must not
     quietly promote one when the roster is one starter plus one coach. */
  const starterAndCoach = rosterRulesFor(solo, { squadSize: 1, maxSubstitutes: 0, maxCoaches: 1 });
  const withCoach: RegistrationDraft = {
    ...EMPTY_DRAFT,
    gameId: "ea-fc-26",
    members: [
      { ...emptyMember("STARTER"), fullName: "Player", requirements: {} },
      { ...emptyMember("COACH"), fullName: "Coach", requirements: {} },
    ],
    leaderIndex: 1,
  };
  check("a coach is never the sole leader",
    effectiveLeaderIndex(withCoach, starterAndCoach), 0);
  check("…and the player is nominated instead, not the coach",
    effectiveLeaderIndex(withCoach, starterAndCoach) === 1, false);

  /* What reaches the API. The browser's draft may hold null; the submission must not
     carry a leader index the server would read as "nobody". */
  const submitted = toPayload(
    { ...onePlayer(null),
      members: [{
        fullName: "Ali Hassan", gameTag: "ALI", universityId: "ksu",
        email: "ali@ksu.edu.sa", verifiedEmail: "ali@ksu.edu.sa", emailProof: "",
        studentId: "441234567", discord: "ali", phone: "0501234567",
        role: "STARTER", requirements: {},
      }],
    },
    solo,
  );
  check("a solo roster submits leader index 0", submitted.leaderIndex, 0);
}

console.log("\n── An unreachable database is named, not guessed at ──");
{
  /*
   * The report that started this: a malformed `DATABASE_URL` was exported in the shell,
   * every database call failed, and the organiser was told "Something went wrong. Try
   * again." — which points at their password rather than at the deployment.
   *
   * Two separate defects made that happen. `findLiveStaffAccess` was called outside every
   * `try`, so Next answered with its own HTML 500 and an empty body; and the catches that
   * did exist said nothing about reachability. `isDatabaseUnavailable` is what lets both
   * answer honestly, so it is worth pinning to Prisma's real error shapes.
   */
  check("P1001 is a reachability failure", isDatabaseUnavailable({ code: "P1001" }), true);
  check("P1013 (invalid URL) is too", isDatabaseUnavailable({ code: "P1013" }), true);
  check("P2024 (pool exhausted) is too", isDatabaseUnavailable({ code: "P2024" }), true);
  /* node's own parse error, seen when the URL is malformed beyond Prisma's reach. */
  check("a node Invalid URL message is recognised",
    isDatabaseUnavailable(new Error("Invalid URL")), true);
  check("a Prisma 'Can't reach' message is recognised",
    isDatabaseUnavailable(new Error("Can't reach database server at base")), true);

  /* It must not swallow unrelated failures, or every bug becomes "the database is down". */
  check("a duplicate-key error is not a reachability failure",
    isDatabaseUnavailable({ code: "P2002" }), false);
  check("an ordinary error is not a reachability failure",
    isDatabaseUnavailable(new Error("Cannot read properties of undefined")), false);
  check("null is not a reachability failure", isDatabaseUnavailable(null), false);

  /* The guard on the staff route: the lookup must be inside a try that answers in JSON,
     because a thrown error there produces an HTML body the client cannot read. */
  const staffRequest = stripComments(readFileSync("src/app/api/admin/staff/request/route.ts", "utf8"));
  check("the staff grant lookup is guarded",
    /try \{\s*grant = await findLiveStaffAccess\(email\);/.test(staffRequest), true);
  check("…and a database failure answers in JSON",
    /catch \(error\) \{[\s\S]*?isDatabaseUnavailable\(error\)[\s\S]*?status: 503/.test(staffRequest), true);
  check("the admin verify catch names a database failure too",
    /isDatabaseUnavailable\(error\)/.test(
      stripComments(readFileSync("src/app/api/admin/verify/route.ts", "utf8"))), true);
}

console.log("\n── Prisma 8 alongside Prisma 7 ──");{
  /*
   * Two Prisma versions run at once here, on purpose.
   *
   * Prisma 7 still owns `schema.prisma` and the migrations; Prisma 8 reads that same file
   * through `prisma7Schema()` as its contract source. That is Prisma's published path off
   * 7, and it means adopting 8 never requires a big-bang rewrite of the data layer. What
   * it *does* require is that the two never share a config file — v8 rejects `schema` and
   * `datasource` as unknown sections, and v7 cannot read `orm` — so each CLI is given its
   * own, and every command names the right one explicitly.
   */
  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  const v8 = read("prisma.config.ts");
  const v7 = read("prisma7.config.ts");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  check("the v8 config is a v8 config", /definePrismaConfig/.test(v8), true);
  check("…and reads the v7 schema as its contract source",
    /prisma7Schema\("prisma\/schema\.prisma"\)/.test(v8), true);
  /* The contract is emitted to a gitignored directory, not beside the source: it is a
     build artifact of the schema, regenerated by `contract emit` on every build. */
  check("…and emits to a generated directory", /output: "generated\/prisma8"/.test(v8), true);

  check("the v8 runtime is a production dependency",
    "@prisma/orm-postgres" in pkg.dependencies, true);
  /* CLIs are build-time only: they must not end up in the deployed bundle. */
  check("both CLIs are dev dependencies",
    "prisma" in pkg.devDependencies && "prisma7" in pkg.devDependencies, true);
  /* The v7 client is still what the app queries with, so it stays installed. */
  check("the v7 client is still what the app queries with",
    "@prisma/client" in pkg.dependencies, true);
  /* Every schema change must re-emit, or the runtime map and the types drift apart. */
  check("the build emits the contract", /contract emit/.test(pkg.scripts.build), true);

  /*
   * **One schema, two clients — and no way to ship the wrong one.**
   *
   * `runtime = "workerd"` makes Prisma import its query compiler as
   * `query_compiler_fast_bg.wasm?module`. The `?module` suffix is a Cloudflare convention
   * that only Wrangler resolves; under Node the client constructor throws "The loaded wasm
   * module was unexpectedly `undefined` or `null` once loaded" and **every** database call
   * fails. That is a misleading failure: it reads as "the database is unreachable", which
   * is why changing `DATABASE_URL` — locally and on Vercel — appeared to do nothing.
   *
   * So both flavours are generated, and each build copies the one its target needs into
   * the single path the app imports. These checks are what stop somebody "simplifying"
   * that back into one generator.
   */
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  check("the schema emits a Node client", /output\s*=\s*"\.\.\/generated\/prisma-client-node"/.test(schema), true);
  check("…and a Workers client", /output\s*=\s*"\.\.\/generated\/prisma-client-workers"/.test(schema), true);
  /* Counted inside the generator blocks only: the explanatory comment above them also
     names `workerd`, and counting raw matches would fail for the wrong reason. */
  const generatorBlocks = schema.match(/generator\s+\w+\s*\{[\s\S]*?\}/g) ?? [];
  const workersBlocks = generatorBlocks.filter((block) => /runtime\s*=\s*"workerd"/.test(block));
  check("exactly one generator uses the workerd runtime", workersBlocks.length, 1);
  check("…and it is the Workers client",
    /clientWorkers/.test(workersBlocks[0] ?? ""), true);
  check("the selector exists", existsSync("scripts/select-prisma-client.mjs"), true);
  /* The split is worthless if a build forgets to choose. */
  check("the Node build selects the Node client", /prisma:node/.test(pkg.scripts.build), true);
  check("…and the Cloudflare build selects the Workers client",
    /prisma:workers/.test(pkg.scripts["build:cloud"]), true);
  check("dev selects the Node client too", /prisma:node/.test(pkg.scripts.dev), true);
  /* Guard against the failure this replaced: the app must not import a flavour directly. */
  const dbSource = readFileSync("src/lib/db.ts", "utf8");
  check("the app imports the selected client, not a flavour",
    /generated\/prisma-client\/client/.test(dbSource) &&
      !/prisma-client-(node|workers)/.test(dbSource), true);

  /* Read whichever copy exists: the repo may carry a committed contract under src/prisma
     while the build emits to generated/prisma8. Both describe the same schema. */
  const contractPath = ["generated/prisma8/contract.json", "src/prisma/contract.json"]
    .find((path) => existsSync(path));
  check("a compiled contract is available", typeof contractPath, "string");
  const emitted = contractPath
    ? (JSON.parse(readFileSync(contractPath, "utf8")) as { roots?: Record<string, unknown> })
    : { roots: {} };
  /* Sorted, so the list is explicit: adding a model is meant to fail this check until
     somebody confirms it belongs in the emitted contract. `SponsorLogo` was added with
     the sponsor artwork. */
  check("…and every model reached it", Object.keys(emitted.roots ?? {}).sort(),
    ["AdminCredential", "Config", "GameLogo", "Member", "OtpCode", "Rulebook", "SponsorLogo", "StaffAccess", "Team"]);
}

console.log("\n── A phone is not a small desktop ──");
{
  /*
   * Reported from an actual phone: the university picker "glitched, because the
   * universities' bar looks like laptop resolution".
   *
   * That was accurate. Radix sizes the dropdown to its widest row, a row is
   * `Long University Name … City · Region`, and the result was measured at 513px on a
   * 390px screen — the list ran 130px off the right edge. Nothing was wrong with the
   * CSS as written; the popup simply had no ceiling.
   *
   * These are source assertions because the failure is visual and only appears at a
   * narrow width, which this suite cannot render. Each one pins the specific line that
   * prevents the regression, so a later "tidy up" of the class list fails loudly.
   */
  const select = stripComments(readFileSync("src/components/ui/select.tsx", "utf8"));
  check("the dropdown is capped to the viewport",
    /max-w-\[calc\(100vw-1rem\)\]/.test(select), true);
  check("…and keeps a gutter when it is shifted near an edge",
    /collisionPadding=\{8\}/.test(select), true);

  /*
   * The row that was widening the popup needs `min-w-0` to be allowed to shrink — and it
   * cannot be given it directly. `SelectPrimitive.ItemText` in Radix 2.4.1 destructures
   * `className` out of its props and never applies it (it forwards only the rest), so the
   * node holding the label ignored a `className` for two attempts at this fix. The item
   * has to reach in with a child selector instead.
   */
  check("the label is allowed to shrink inside its row",
    /\[&>span:first-of-type\]:min-w-0/.test(select), true);
  check("…and is truncated rather than wrapped",
    /\[&>span:first-of-type\]:truncate/.test(select), true);

  /* Physical padding, on a page that renders in Arabic. `ps`/`pe` and `end-3` follow the
     reading direction; `pl`/`pr` and `right-3` put the tick over the text in RTL. */
  check("the tick is placed logically, not physically",
    /absolute end-3/.test(select) && !/\bpr-9\b/.test(select), true);

  /*
   * **The second half of the same complaint.** iOS Safari zooms the viewport when a
   * control smaller than 16px takes focus, and does not zoom back out — which is what
   * makes a page look like it is being shown at the wrong resolution with fields running
   * off the screen. Every field here is 13–14px, so the threshold has to be raised on
   * phones. 16 is the number; a smaller one does not stop the zoom.
   */
  const css = readFileSync("src/app/globals.css", "utf8");
  /* Anchored to the start of a line, so a *comment* that mentions the query (the fluid
     root-size note above does exactly that) cannot be mistaken for the rule itself. */
  const phoneAt = css.search(/^@media \(max-width: 40rem\)/m);
  /* The comment explaining *why* sits above the rule, so the window starts before it —
     otherwise the test reads only the declaration and cannot see the reason. */
  const phoneBlock = css.slice(Math.max(0, phoneAt - 1400), phoneAt + 700);
  check("phones are given a 16px field font", /font-size:\s*16px/.test(phoneBlock), true);
  check("…because below 16px iOS zooms the page on focus", /zoom/i.test(phoneBlock), true);
  check("…and the rule covers the combobox as well as the inputs",
    /\[role="combobox"\]/.test(phoneBlock), true);

  /* The three mode tabs did not fit across a 360px phone either, and a flex child will
     not shrink below its text: the row pushed the document 13px wider than the screen, so
     the whole page scrolled sideways. They stack below `sm` and return to a row above it. */
  const wizard = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  check("the mode tabs stack on a phone", /flex-col/.test(wizard), true);
  check("…and go back to a row on a wider screen", /sm:flex-row/.test(wizard), true);
  check("…without exceeding the screen", /min-w-0 flex-1/.test(wizard), true);
}

console.log("\n── The Spam or Junk advice is read, not skimmed ──");
{
  /*
   * The organiser asked for the junk hint to "appear more than it is".
   *
   * It was there, in all three places — but at 11px in a thin amber line with a 30%
   * border it read as fine print beside the thing it was explaining, and was skimmed
   * past. The point of showing it at all is that the code is probably sitting in that
   * folder, so it now carries the weight that claim deserves: a solid border, a stronger
   * background, a bigger icon, and the instruction itself at 13px bold and near-white
   * rather than mixed into a paragraph.
   *
   * All three places, because a person meeting the hint in one and not the other would
   * conclude the site only warns sometimes.
   */
  const HINTS = [
    ["src/components/form/email-verification.tsx", "verify.checkSpam"],
    ["src/components/form/success-panel.tsx", "success.checkSpamTitle"],
    ["src/components/form/edit-flow.tsx", "edit.checkSpam"],
  ] as const;

  for (const [file, key] of HINTS) {
    const source = stripComments(readFileSync(file, "utf8"));
    const name = file.split("/").pop();
    /* The instruction must be the loudest thing in its own box.
       `0.8125rem` is 13px at a 16px root — written in rem so it scales with the rest of
       the interface on a large display (see the `html { font-size: … }` rule). */
    check(`${name}: the junk advice is set at 0.8125rem bold`,
      new RegExp(`text-\\[0\\.8125rem\\] font-bold[^"]*"[\\s\\S]{0,200}${key.replace(/\./g, "\\.")}`).test(source) ||
      new RegExp(`${key.replace(/\./g, "\\.")}[\\s\\S]{0,200}text-\\[0\\.8125rem\\] font-bold`).test(source), true);
    /* A 50% border and a 12% fill, not the 30%/8% it had. */
    check(`${name}: …inside a box that carries weight`,
      /border-amber-400\/50/.test(source) && /bg-amber-400\/12/.test(source), true);
    /* And it is a block, not a `p` of running text, so the instruction can break onto its
       own line instead of being buried mid-sentence. */
    check(`${name}: …as a callout rather than a footnote`,
      !new RegExp(`<p className="[^"]*amber[^"]*"[\\s\\S]{0,300}${key.replace(/\./g, "\\.")}`).test(source), true);
  }

  /* The words themselves are unchanged: this was a visibility problem, not a wording one,
     and the organiser approved the sentence that was already there. */
  for (const key of ["verify.checkSpam", "success.checkSpamTitle", "edit.checkSpam"]) {
    check(`${key} still says what it said`,
      /spam or junk/i.test(t("en", key as never)), true);
    check(`${key} is still Arabic in Arabic`,
      /[\u0600-\u06FF]/.test(t("ar", key as never)), true);
  }
}

console.log("\n── The landing page, and the red error that came too early ──");
{
  /*
   * Seven changes asked for in one message. Grouped because they were one review of one
   * screen, and because they interact: the sponsors section replaced the "How it works"
   * block, and the prize pool only has somewhere to live once the game cards are the
   * thing being read.
   */
  const landing = stripComments(readFileSync("src/components/form/landing.tsx", "utf8"));
  const wizard = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  const toggle = stripComments(readFileSync("src/components/form/language-toggle.tsx", "utf8"));
  const config = normaliseConfig({
    ...DEFAULT_TOURNAMENT,
    games: [
      { ...DEFAULT_TOURNAMENT.games[0], prizePool: "  10,000 SAR  " },
    ],
    sponsors: [
      { name: "Riyadh Bank", url: "https://example.com" },
      { name: "stc", url: "" },
      { name: "stc", url: "" },
      { name: "evil", url: "javascript:alert(1)" },
      ...Array.from({ length: 12 }, (_, i) => ({ name: `Sponsor ${i}` })),
    ],
  });

  /* --- 1. The logo is the way home ------------------------------------------------ */
  check("the header logo returns to the landing page", /onClick=\{\(\) => \{\s*setStarted\(false\)/.test(wizard), true);
  check("…and says so to a screen reader", /aria-label=\{t\("home\.back"\)\}/.test(wizard) || /aria-label=\{t\("home\.back"\)\}/.test(wizard.replace("'", '"')), true);

  /* --- 2. "How it works" is gone -------------------------------------------------- */
  check("the explainer is no longer rendered", /home\.stepsTitle/.test(landing), false);
  check("…and its step copy is gone from both dictionaries",
    !("home.step1" in EN) && !("home.step1Body" in AR), true);

  /* --- 3. Sponsors, capped at nine ------------------------------------------------ */
  check("the landing renders the sponsors", /home\.sponsorsTitle/.test(landing), true);
  check("a sponsor with no link is not a link", /sponsor\.url \?/.test(landing), true);
  check("the list is capped at nine", config.sponsors.length, 9);
  check("…counting de-duplicated names", config.sponsors[0]?.name, "Riyadh Bank");
  check("…and refusing a javascript: link", config.sponsors.some((s) => s.url.startsWith("javascript:")), false);
  /* The console has to be able to edit them, or the feature is read-only fiction. */
  const consoleSource = stripComments(readFileSync("src/components/admin/admin-console.tsx", "utf8"));
  check("the console can edit sponsors",
    /SponsorsSection/.test(consoleSource), true);
  check("…from its own tab",
    /id: "sponsors"/.test(consoleSource), true);

  /* --- The live notice ------------------------------------------------------------ */
  /* "Tournament is live — watch us on our official channels" is a second announcement
     beside the closed-registration one, and it belongs on the landing page: the form's
     steps are about answering questions, not following a stream. */
  const liveConfig = normaliseConfig({
    ...DEFAULT_TOURNAMENT,
    tournamentLive: true,
    liveMessage: "  Grand final is live  ",
    watchLinks: [
      { label: "Twitch", url: "https://twitch.tv/ksucrown" },
      { label: "YouTube", url: "" },
      { label: "Evil", url: "javascript:alert(1)" },
      { label: "Kick", url: "https://kick.com/ksucrown" },
      ...Array.from({ length: 10 }, (_, i) => ({
        label: `Channel ${i}`,
        url: "https://example.com",
      })),
    ],
  });
  check("live is off unless the organisers switch it on", DEFAULT_TOURNAMENT.tournamentLive, false);
  check("…and a config saved before it existed stays off", normaliseConfig({}).tournamentLive, false);
  check("a live message is trimmed", liveConfig.liveMessage, "Grand final is live");
  check("a watch link with no address is dropped",
    liveConfig.watchLinks.some((link) => link.label === "YouTube"), false);
  check("…and a javascript: link is refused",
    liveConfig.watchLinks.some((link) => link.url.startsWith("javascript:")), false);
  check("watch links are capped", liveConfig.watchLinks.length, MAX_WATCH_LINKS);
  check("the landing renders the live notice", /config\.tournamentLive/.test(landing), true);
  check("…with a button per channel", /config\.watchLinks\.map/.test(landing), true);
  check("…and an empty message falls back to the dictionary",
    /config\.liveMessage \|\| t\("home\.liveDefault"\)/.test(landing), true);
  /* The notice must not follow a captain into the form. */
  check("the registration form does not render the live notice",
    /tournamentLive/.test(
      stripComments(readFileSync("src/components/form/registration-form.tsx", "utf8")),
    ),
    false,
  );
  check("the console has a Live tab", /id: "live"/.test(consoleSource), true);
  check("…which edits the watch channels", /LiveSection/.test(consoleSource), true);

  /* Accessibility, and one operational trap. The notice is an announcement, and every
     watch button opens a new tab — both need saying rather than assuming. */
  check("the live notice is announced to a screen reader",
    /role="status"[\s\S]{0,120}aria-live="polite"/.test(landing), true);
  check("…and a watch button warns that it opens a new tab",
    /home\.liveOpensNewTab/.test(landing), true);
  check("…which is translated in both dictionaries",
    "home.liveOpensNewTab" in EN && "home.liveOpensNewTab" in AR, true);
  check("the console warns when live is on with no channels",
    /watchLinks\.length === 0/.test(
      stripComments(readFileSync("src/components/admin/live-section.tsx", "utf8")),
    ),
    true);

  /* --- 4 & 5. Centred cards, with a logo and a prize ------------------------------ */
  check("the game card is centred", /flex-col items-center/.test(landing), true);
  check("…shows the uploaded logo", /api\/games\/\$\{encodeURIComponent\(game\.id\)\}\/logo/.test(landing), true);
  check("…and the prize pool", /game\.prizePool/.test(landing), true);
  check("a blank prize is not printed", config.games[0]?.prizePool, "10,000 SAR");
  check("…and an absent one is empty, not a placeholder",
    normaliseConfig({ ...DEFAULT_TOURNAMENT, games: [{ ...DEFAULT_TOURNAMENT.games[0] }] }).games[0]?.prizePool,
    "");
  check("one player is not '1 players'",
    /game\.squadSize === 1\s*\n?\s*\?\s*t\("home\.playerOne"\)/.test(landing), true);

  /* --- 6. The language switch lives in the footer --------------------------------- */
  /* It used to be a corner icon in the hero. It now sits in the footer on every page,
     where a preference belongs and where it no longer competes with the call to action.
     `compact` is still a supported mode of the component — nothing else uses it today —
     so only its placement here is asserted. */
  check("the landing no longer carries a corner switch",
    /<LanguageToggle compact \/>/.test(landing), false);
  check("…the footer carries the labelled switch instead",
    /<LanguageToggle \/>/.test(readFileSync("src/components/form/site-footer.tsx", "utf8")), true);
  check("…which is one button, not a group", /if \(compact\)/.test(toggle), true);
  check("…naming the language it switches to", /title=\{other\.label\}/.test(toggle), true);

  /* --- 7. The crown was being cut off at the ceiling ------------------------------ */
  const css = readFileSync("src/app/globals.css", "utf8");
  const crownRule = css.slice(css.indexOf(".scroll-crown {"), css.indexOf("will-change: transform, opacity"));
  /* The box is centred on `top` with translateY(-50%), so the top edge is
     `top − halfItsHeight`. Height is width × 2/3, so half is width / 3 — the old value
     was 0.27 × width, which left the top edge above the viewport.

     The arithmetic now lives in `--crown-top` so the crown and the space reserved for it
     cannot disagree; this checks the rule consumes it rather than re-deriving it. */
  const crownTopVar = css.match(/--crown-top:\s*[^;]+;/)?.[0] ?? "";
  check("the crown's top edge is inside the viewport", /var\(--crown-w\) \/ 3/.test(crownTopVar), true);
  check("…and the rule consumes that one definition", /top:\s*var\(--crown-top\)/.test(crownRule), true);
  /* The old factor may still be named in the comment that explains the fix, so this
     reads the declaration itself, not the whole rule. */
  check("…with the old, too-small factor gone from the declaration",
    /\btop:[^;]*0\.27/.test(crownRule), false);

  /*
   * --- The red error no longer appears while the address is being typed -----------
   *
   * `revealsImmediately` decides whether an error may be shown before a blur. For an
   * address it used to answer for anything that merely looked finished, so
   * `4412@student.ksu` — three keystrokes short of a valid address — turned the field
   * red. Only a domain that has plainly gone elsewhere may be reported at once.
   */
  const ksu = UNIVERSITIES.find((u) => u.id === "ksu")!;
  check("no red on the way to a valid KSU address",
    revealsImmediately("email", "4412@student.ksu"), false);
  check("…nor for a half-typed domain",
    revealsImmediately("email", "4412@student."), false);
  check("…nor before the @ exists",
    revealsImmediately("email", "4412"), false);
  check("but a finished address is not flagged",
    revealsImmediately("email", "4412@student.ksu.edu.sa"), false);
  check("a foreign domain is still called out at once",
    revealsImmediately("email", "4412@gmail.com"), true);
  /* The per-university answer needs the selection, so it stays in `validateDraft` and
     appears on blur — asserted through the validator, not the reveal gate. */
  check("another university's domain is left to the check",
    revealsImmediately("email", "4412@sm.imamu.edu.sa"), false);
  check("…and is reported by the validator",
    validateDraft(
      { ...EMPTY_DRAFT, teamName: "Probe", gender: "male", gameId: "ea-fc-26",
        members: [{ ...emptyMember("STARTER"), universityId: ksu.id, email: "4412@sm.imamu.edu.sa" }] },
      config,
    ).errors["member.0.email"] !== undefined,
    true);
}

console.log("\n── Sponsor roles, the entry names, and the way back from a gate ──");
{
  /*
   * Seven more requests, grouped. Four are layout or copy, one is a second credential
   * affordance, one is a route, and one is a latency complaint — and the last is the
   * only one whose effect can be measured rather than asserted, so it is pinned by the
   * shape of the code that was making the page slow.
   */
  const landing = stripComments(readFileSync("src/components/form/landing.tsx", "utf8"));
  const gate = stripComments(readFileSync("src/components/admin/secret-gate.tsx", "utf8"));
  const staffSection = stripComments(readFileSync("src/components/admin/staff-section.tsx", "utf8"));
  const wizard = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  const passwordSection = stripComments(readFileSync("src/components/admin/password-section.tsx", "utf8"));

  /* --- The open/closed notice moved under the buttons ------------------------------ */
  const badgeAt = landing.indexOf("home.badgeOpen");
  const ctaAt = landing.indexOf("home.ctaRules");
  check("the registration notice comes after the buttons", ctaAt > 0 && badgeAt > ctaAt, true);

  /* --- Sponsors are logo tiles headed by their role -------------------------------- */
  const sponsorConfig = normaliseConfig({
    ...DEFAULT_TOURNAMENT,
    sponsors: [
      { name: "Riyadh Bank", role: "  Platinum Sponsor  ", url: "https://example.com" },
      { name: "stc", role: "", url: "" },
    ],
  });
  check("a sponsor keeps its role", sponsorConfig.sponsors[0]?.role, "Platinum Sponsor");
  check("…and a blank role stays blank rather than inventing a tier",
    sponsorConfig.sponsors[1]?.role, "");
  check("the tile is headed by the role", /sponsor\.role &&/.test(landing), true);
  check("…with the name standing in for the logo", /chrome-text block font-display/.test(landing), true);
  check("the editor can set the role",
    /label="Role"/.test(stripComments(readFileSync("src/components/admin/sponsors-section.tsx", "utf8"))), true);

  /* --- Both gates can show the secret --------------------------------------------- */
  check("the grand admin gate can reveal the secret", /revealed \? "text" : "password"/.test(gate), true);
  check("…and hides it by default", /useState\(false\)/.test(gate), true);
  check("the password console reveals the current credential too",
    /reveal \? "text" : "password"/.test(passwordSection), true);

  /* --- The gates send a stray visitor home ---------------------------------------- */
  check("the gate logo links back to the form", /href="\/"/.test(gate), true);
  check("…with a label that says where it goes", /Back to \$\{tournamentName\}|Back to/.test(gate), true);

  /* --- Staff form alignment -------------------------------------------------------- */
  /* The Note field's hint made its cell taller than the Email cell; the row was
     bottom-aligned, so the two inputs sat at different heights. Both must now carry the
     same structure. */
  check("the staff form aligns from the top", /sm:items-start/.test(staffSection), true);
  check("…and the note no longer carries a hint that changes its height",
    /hint="Optional — why they have access\."/.test(staffSection), false);

  /* --- A typed word opens a door --------------------------------------------------- */
  check("the wizard watches for an entry name", /useEntryNameShortcut\(config, adminHref, staffHref\)/.test(wizard), true);
  check("…and navigates to the resolved address, not a literal one",
    /window\.location\.assign\(destination\)/.test(wizard), true);
  check("…once, even if two keystrokes race the unload", /let leaving = false/.test(wizard), true);
  const entryConfig = normaliseConfig({});
  check("both entry names have a default", Boolean(entryConfig.adminEntryName && entryConfig.staffEntryName), true);
  check("…and are editable from the console",
    /patch\("adminEntryName"/.test(stripComments(readFileSync("src/components/admin/general-section.tsx", "utf8"))), true);

  /* --- The logos start sooner ------------------------------------------------------ */
  check("the logo URLs are preloaded during parsing", /rel="preload"/.test(landing), true);
  check("…matching the version the card uses", /logo\?v=\$\{logoVersions\[game\.id\]\}/.test(landing), true);
  check("…and the image is not lazy any more", /loading="eager"/.test(landing), true);
  check("the logo response may be served stale while revalidating",
    /stale-while-revalidate/.test(readFileSync("src/app/api/games/[gameId]/logo/route.ts", "utf8")), true);
}

console.log("\n── Sponsor logos are uploaded, stored and served like game logos ──");
{
  /*
   * The organisers asked for sponsors to carry real artwork "like the games".
   *
   * So this mirrors the game-logo pipeline rather than inventing a second one: same
   * table shape, same 512×512 server rule, same `?v=` cache-busting, same route pair. The
   * assertions below pin each of those, because a sponsor logo that quietly diverged
   * would be a second thing to debug with the same failure modes.
   */
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  check("the schema has a sponsor logo table", /model SponsorLogo \{/.test(schema), true);
  check("…with the same columns a game logo has",
    ["sponsorId", "mimeType", "width", "height", "size", "bytes", "updatedAt"]
      .every((column) => new RegExp(`\\b${column}\\b`).test(schema.slice(schema.indexOf("model SponsorLogo")))),
    true);
  check("…and a migration to create it",
    existsSync("prisma/migrations/20261031000000_sponsor_logos/migration.sql"), true);

  const store = stripComments(readFileSync("src/lib/store.ts", "utf8"));
  for (const fn of ["upsertSponsorLogo", "getSponsorLogo", "deleteSponsorLogo", "listSponsorLogoVersions", "pruneSponsorLogos"]) {
    check(`store exports ${fn}`, new RegExp(`export async function ${fn}`).test(store), true);
  }

  /* The public read and the guarded write, side by side with the game equivalents. */
  check("there is a public sponsor-logo route",
    existsSync("src/app/api/sponsors/[sponsorId]/logo/route.ts"), true);
  const publicRoute = stripComments(readFileSync("src/app/api/sponsors/[sponsorId]/logo/route.ts", "utf8"));
  check("…served with the same lockdown headers as a game logo",
    /X-Content-Type-Options/.test(publicRoute) && /default-src 'none'; sandbox/.test(publicRoute), true);
  check("…and the same long-lived, versioned cache",
    /immutable/.test(publicRoute) && /stale-while-revalidate/.test(publicRoute), true);

  const adminRoute = stripComments(readFileSync("src/app/api/admin/sponsors/[sponsorId]/logo/route.ts", "utf8"));
  check("the upload route is admin-gated", /isAdminRequest/.test(adminRoute), true);
  check("…enforces the same fixed square on the server",
    /size\.width !== LOGO_SIZE/.test(adminRoute), true);
  check("…and returns the version the URL must carry",
    /version: logo\.updatedAt\.getTime\(\)/.test(adminRoute), true);

  /*
   * A sponsor has no table row, so nothing cascades. Without the sweep, deleting a sponsor
   * — or renaming one, which re-slugs its id — leaves its bytes unreachable forever.
   */
  const configWrite = stripComments(readFileSync("src/app/api/config/route.ts", "utf8"));
  check("orphaned sponsor logos are swept on config save",
    /const liveLogoIds = \[[\s\S]*?config\.sponsors\.map\(\(sponsor\) => sponsor\.id\)[\s\S]*?\];[\s\S]*?pruneSponsorLogos\(liveLogoIds\)/.test(configWrite), true);
  check("…and a failed sweep never fails the save",
    /pruneSponsorLogos[\s\S]{0,120}\.catch\(/.test(stripComments(readFileSync("src/app/api/config/route.ts", "utf8"))), true);

  /* The console control, and the tile that uses what it uploads. */
  const sponsorsSection = stripComments(readFileSync("src/components/admin/sponsors-section.tsx", "utf8"));
  check("the console offers an upload per sponsor", /function SponsorLogo\(/.test(sponsorsSection), true);
  check("…preparing the image in the browser first", /prepareLogo\(/.test(sponsorsSection), true);
  check("…against the sponsor's own endpoint",
    /\/api\/admin\/sponsors\/\$\{encodeURIComponent\(sponsor\.id\)\}\/logo/.test(sponsorsSection), true);

  /*
   * **A sponsor's id must not be derived from its name.**
   *
   * It used to be, and it broke sponsor logos outright. The id was re-slugged from the
   * name while it still looked like `sponsor-N`, so typing the first letter of "TWISTED
   * MINDS" set it to `t` and froze it there. Because a logo's bytes are keyed by that id,
   * any id that changes under an uploaded logo orphans it — and `pruneSponsorLogos` then
   * deletes the bytes on the next save. The organiser saw a broken-image icon for a logo
   * the console had just reported as uploaded successfully.
   *
   * So: the id is opaque, generated once, and untouched by renaming.
   */
  check("a new sponsor gets a stable, opaque id",
    /id = `sponsor-\$\{Math\.random\(\)\.toString\(36\)/.test(sponsorsSection), true);
  check("…and renaming only changes the name",
    /const rename = \(index: number, name: string\) => update\(index, \{ name \}\)/.test(sponsorsSection), true);
  check("…with no name-derived id left anywhere",
    /isAutoId/.test(sponsorsSection) || /slugify\(name\)/.test(sponsorsSection), false);

  /*
   * A logo whose row is missing must settle on "no logo" — quietly.
   *
   * The first attempt at this reported it in red, as "The stored logo could not be loaded.
   * Upload it again." That was wrong twice over: it blamed the organiser for state the
   * console itself had let go stale (the version map is fixed when the page loads, so a
   * logo pruned in another tab 404s here), and a missing logo is not a fault — it is the
   * ordinary empty state, with the upload button already on screen.
   *
   * So a failed load now clears the stale version from the parent's map and shows the
   * default hint. These assertions pin that: the failure self-heals, and no red error.
   */
  check("a logo that will not load clears the stale version",
    /onError=\{\(\) => \{\s*setBroken\(true\);\s*onChange\(undefined\);/.test(sponsorsSection), true);
  check("…and the fallback also hides the Remove button",
    /const showImage = version !== undefined && !broken/.test(sponsorsSection), true);
  check("…without accusing the organiser of an error",
    /could not be loaded|Upload it again/.test(sponsorsSection), false);
  check("…and the empty state is the ordinary hint",
    /Any size — resized to \{LOGO_SIZE\}×\{LOGO_SIZE\}/.test(sponsorsSection), true);

  const landing = stripComments(readFileSync("src/components/form/landing.tsx", "utf8"));
  check("the tile shows the uploaded logo when there is one",
    /hasLogo \? \(/.test(landing) && /\/api\/sponsors\/\$\{encodeURIComponent\(sponsor\.id\)\}\/logo/.test(landing), true);
  check("…and falls back to the name when there is not", /chrome-text block font-display/.test(landing), true);
  check("the sponsor artwork is preloaded too", /sponsors\/\$\{encodeURIComponent\(sponsor\.id\)\}\/logo\?v=/.test(landing), true);

  /*
   * --- The landing fix round: Arabic gap, role translation, no stray navigation ------
   *
   * Four things the organiser asked for, and one of them was a real bug: at 768px wide the
   * fixed crown's lower edge fell at 446px while the heading started at 439px, so the
   * heading sat 7px *on* the artwork. The spacer had been a flat 288px, which cannot track
   * something whose size comes from the viewport.
   */
  const css = readFileSync("src/app/globals.css", "utf8");

  /* The spacer must mirror the crown's own `top` and half-height, not be a constant. */
  check("the crown's space tracks its geometry",
    /\.hero-crown-space\s*\{[\s\S]{0,300}var\(--crown-w\) \* 0\.2667/.test(css), true);
  check("…using the same vertical centre as the crown",
    /\.hero-crown-space\s*\{[\s\S]{0,300}var\(--crown-top\)/.test(css), true);
  check("…so the headline never sits on the artwork",
    /hero-crown-space/.test(landing) && /h-56 sm:h-72/.test(landing), false);

  /*
   * **A game card must not open the form.** Every card used to be a `<button onClick={onRegister}>`,
   * so a visitor reading the list of games was thrown into the registration form by a
   * stray tap. The cards are a list of what is on offer; the Register button is the way in.
   */
  const cardAt = landing.indexOf('className="panel group relative flex h-full w-full flex-col');
  check("a game card is a plain element", cardAt > -1, true);
  /* …and the tag that opens it is not a button. */
  const beforeCard = landing.slice(Math.max(0, cardAt - 120), cardAt);
  check("game cards are not buttons", /<button[^>]*$/.test(beforeCard), false);
  /* The card element itself must carry no handler at all. */
  check("…with no click handler of their own",
    cardAt > -1 && /onClick/.test(landing.slice(cardAt, cardAt + 400)), false);
  /* The hero and footer calls to action must still work — exactly two. */
  check("…and only the two real buttons register",
    (landing.match(/onClick=\{onRegister\}/g) ?? []).length, 2);

  /* Centred however many there are: flex with `justify-center`, not a grid pinned left. */
  check("the game strip centres its cards",
    /flex max-w-4xl flex-wrap justify-center/.test(landing), true);
  check("…and is not a fixed-column grid",
    /grid max-w-4xl grid-cols-2/.test(landing), false);

  /* Sponsors stay the larger element — but only a little, so they still read as a pair. */
  const remOf = (cls: string | undefined) => Number(cls?.match(/(\d+)/)?.[1] ?? 0) * 0.25;
  const sponsorShell = landing.match(/panel-inset flex h-full w-(\d+)/)?.[1];
  /* Tolerant of the wide-screen step (`3xl:w-72 3xl:max-w-none`) that follows the base
     width, so adding a breakpoint cannot silently break this. */
  const gameCard = landing.match(/max-w-(\d+)[^"]*sm:w-\d+/)?.[1];
  check("sponsors are wider than the game cards",
    remOf(`w-${sponsorShell}`) > remOf(`w-${gameCard}`), true);
  check("…by a little, not a lot",
    remOf(`w-${sponsorShell}`) - remOf(`w-${gameCard}`) <= 2.5, true);

  /*
   * --- A sponsor role is translated when it is a known tier -------------------------
   *
   * Roles are free text, so this cannot translate everything and must not pretend to.
   * The usual tiers are mapped; anything else is left exactly as the organiser wrote it,
   * which is the honest failure — better their words than a wrong translation or a blank.
   */
  check("a known role is translated",
    sponsorRoleLabel("Strategic Sponsor", "ar"), "راعٍ استراتيجي");
  check("…ignoring case and spacing",
    sponsorRoleLabel("  platinum   SPONSOR ", "ar"), "راعٍ بلاتيني");
  check("…and the official ones", sponsorRoleLabel("Official Telecom", "ar"), "الاتصالات الرسمية");
  check("an unknown role is left alone",
    sponsorRoleLabel("Regional Activation Partner", "ar"), "Regional Activation Partner");
  check("English is never touched",
    sponsorRoleLabel("Strategic Sponsor", "en"), "Strategic Sponsor");
  check("an empty role stays empty", sponsorRoleLabel("   ", "ar"), "   ");
  check("…and every mapped translation is actually Arabic",
    Object.entries({
      "Diamond Sponsor": sponsorRoleLabel("Diamond Sponsor", "ar"),
      "Gold Sponsor": sponsorRoleLabel("Gold Sponsor", "ar"),
      "Media Partner": sponsorRoleLabel("Media Partner", "ar"),
      "Title Sponsor": sponsorRoleLabel("Title Sponsor", "ar"),
      Partner: sponsorRoleLabel("Partner", "ar"),
    }).filter(([, arabic]) => !/[\u0600-\u06FF]/.test(arabic)),
    []);
  /* The tile has to use it, or the dictionary is decoration. */
  check("the tile renders the translated role",
    /sponsorRoleLabel\(sponsor\.role, language\)/.test(landing), true);

  /*
   * --- The crown gap is one small number, in one place -------------------------------
   *
   * It has been three things in its life: a flat 288px spacer that overlapped the
   * artwork, then `110px` while the landing was spaced by eye (which read as a void),
   * and now a 16px variable. What matters is not the value but that the spacer and the
   * crown cannot disagree — so the assertion is that the spacer *reads* the variable
   * rather than carrying a second copy of the arithmetic.
   */
  check("…and the spacer adds it rather than a literal",
    /\.hero-crown-space\s*\{[\s\S]{0,320}\+ var\(--crown-gap\)/.test(css), true);
  /* Neither of the two old constants may creep back in. */
  check("no stale 110px offset survives",
    /\.hero-crown-space\s*\{[^}]*\+\s*110px/.test(css), false);
  check("…and no stale 2rem offset either",
    /\.hero-crown-space\s*\{[^}]*\+\s*2rem/.test(css), false);

  /*
   * --- "Works on any screen", from a 360px phone to a 3840px monitor -----------------
   *
   * The gap and the crown's size used to be literals in two separate rules. They are now
   * variables in `:root`, so the spacer cannot drift from the artwork it is making room
   * for, and the crown can grow on a large display instead of sitting at 720px in the
   * middle of a 4K screen.
   */
  check("the crown's width is a variable", /--crown-w:\s*min\(110vw, 720px\)/.test(css), true);
  check("…with a wide-screen step", /@media \(min-width: 96rem\)[\s\S]{0,120}--crown-w/.test(css), true);
  check("…and another at 4K", /@media \(min-width: 160rem\)[\s\S]{0,120}--crown-w/.test(css), true);
  /* A *small* gap, as asked for: the heading clears the artwork without a band of nothing
     between them. 16px is also a whole rem, so it does not land on a sub-pixel. */
  check("the gap is a small variable", /--crown-gap:\s*16px/.test(css), true);
  /* One definition of `top`, consumed by both the crown and the spacer. Two copies are
     what let them disagree in the first place. */
  check("the crown's position is defined once",
    (css.match(/--crown-top:\s*max\(/g) ?? []).length, 1);
  check("…and both the crown and its space read it",
    (css.match(/var\(--crown-top\)/g) ?? []).length >= 2, true);

  /*
   * --- The interface scales with the display --------------------------------------
   *
   * **The bug this fixes.** The shell was capped at a fixed `96rem`, so on a 3840px
   * monitor the form occupied 40% of the width — measured 1536 of 3840 — centred, with
   * 14px body text. Nothing was broken; every size was simply frozen while the screen
   * grew around it.
   *
   * The fix is one clamp on the root font size. Everything in the app is expressed in
   * rem (Tailwind's spacing and type ramp, and its `max-w-*` containers), so raising the
   * root scales width *and* type together and the proportions survive.
   */
  const clamp = css.match(/html\s*\{[^}]*font-size:\s*clamp\(([^)]*)\)/);
  check("the root font size is fluid", Boolean(clamp), true);

  const parts = (clamp?.[1] ?? "").split(",").map((s) => s.trim());
  /* Flat below ~1536px: phones, tablets and laptops must not shift at all. */
  check("…pinned at 16px on small screens", parts[0], "16px");
  check("…on a viewport-relative curve above that", /vw/.test(parts[1] ?? ""), true);
  check("…and capped, so an 8K panel cannot explode the type", /^[\d.]+px$/.test(parts[2] ?? ""), true);

  /* Read the curve's own numbers back out, so the assertions below describe the real
     formula rather than a copy of it. */
  const vw = Number((parts[1] ?? "").match(/([\d.]+)vw/)?.[1] ?? 0);
  const base = Number((parts[1] ?? "").match(/([\d.]+)px/)?.[1] ?? 0);

  /*
   * The curve must not dip below 16px before the largest laptop width, or those screens
   * would shrink. It crosses at ~1538px and the `clamp()` floor holds everything below
   * that at exactly 16px — so the real requirement is that the crossing is at the very
   * top of the laptop range, not that it lands on 1536 exactly.
   */
  const crosses16At = vw > 0 ? ((16 - base) / vw) * 100 : Infinity;
  check("…flat across every laptop width", crosses16At > 1500 && crosses16At < 1560, true);
  /* …and reach ~28px by 3840, which is what fills a 4K screen sensibly. */
  const at4k = base + (vw * 3840) / 100;
  check("…reaching about 28px on a 4K display", Math.round(at4k), 28);

  /*
   * **No px font sizes may survive in the components.**
   *
   * A size written in px does not scale, so a label pinned at 11px beside body text that
   * had grown to 25px would invert the type hierarchy on a large display — which is
   * exactly what happened on the first attempt at this. Every small-print size is
   * therefore a rem value with a px name (`text-[0.6875rem]` is 11px at the default root).
   */
  const tsxFiles = (function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  })("src");

  const pxClasses = tsxFiles.flatMap((file) =>
    (readFileSync(file, "utf8").match(/[a-z-]+-\[[\d.]+px\]/g) ?? []).map(
      (hit) => `${file}: ${hit}`,
    ),
  );
  check("no component pins a size in px", pxClasses, []);
  check("…small print is written in rem", /\btext-\[0\.6875rem\]/.test(landing), true);

  /* Tailwind only generates `3xl:`/`4xl:` if the theme declares them. */
  check("the wide-screen breakpoints are declared",
    /--breakpoint-3xl:\s*120rem/.test(css) && /--breakpoint-4xl:\s*160rem/.test(css), true);
  /* The container has to use them, or the breakpoints are dead weight. */
  const shellSource = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  check("the page container widens past 1920px",
    /max-w-6xl[^"]*3xl:max-w-7xl/.test(shellSource), true);
  check("…and again past 2560px", /4xl:max-w-\[96rem\]/.test(shellSource), true);
  /* The headline was pinned at `sm:text-6xl` and never grew again. */
  check("the headline keeps scaling on a large display",
    /3xl:text-8xl/.test(landing) && /xl:text-7xl/.test(landing), true);
  /* The shell must not pad the top on the landing branch, or the gap grows by that much. */
  const wizardSource = stripComments(readFileSync("src/components/form/registration-wizard.tsx", "utf8"));
  check("the landing's wrapper has no top padding",
    /max-w-6xl px-4 pb-8 sm:px-6 lg:pb-12/.test(wizardSource), true);
  check("…no `py-8` left on that branch",
    /!started \? \([\s\S]{0,400}?py-8/.test(wizardSource), false);

  /*
   * --- One root font size drives the whole interface -------------------------------
   *
   * **This is the fix for "the form contracts in the centre on a big screen."** Every
   * size in the app — spacing, the type ramp, the `max-w-*` containers — is relative to
   * the root font size, so raising that one value scales the entire interface together
   * instead of leaving a laptop-sized card adrift on a 4K display. Measured before: a
   * 3840px screen showed a 1536px shell (40%) with 14px body text.
   */
  check("the root font size is fluid",
    /html\s*\{[\s\S]{0,200}font-size:\s*clamp\(/.test(css), true);
  /* Flat at the bottom: phones, tablets and laptops must keep exactly 16px, or every
     hand-tuned breakpoint in the app shifts underneath it. */
  check("…and is flat at 16px for ordinary screens",
    /font-size:\s*clamp\(16px,/.test(css), true);
  /* Capped, so an 8K panel cannot produce absurd type. */
  check("…growing with the viewport above that",
    /clamp\(16px,\s*0\.52vw\s*\+\s*8px,\s*30px\)/.test(css), true);

  /*
   * A size written in `px` does **not** scale with the root, so a label pinned at 11px
   * beside body text that had grown to 25px would wreck the type hierarchy on a large
   * display — which is exactly what the first attempt at this did. Everything is `rem`.
   *
   * Read from disk rather than from a captured string: the point is to sweep the whole
   * app, so a new component that reintroduces a px size is caught too.
   */
  function tsxSources(dir: string): string {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return tsxSources(path);
        return entry.name.endsWith(".tsx") ? readFileSync(path, "utf8") : "";
      })
      .join("\n");
  }
  const allTsx = tsxSources("src");
  check("no text size is pinned in px",
    /\btext-\[\d+(\.\d+)?px\]/.test(allTsx), false);

  /* The step rail's width is a column track, so it must scale too or it would stay 248px
     beside a panel that had doubled. */
  check("the step rail scales with the type",
    /grid-cols-\[15\.5rem_1fr\]/.test(readFileSync("src/components/form/registration-form.tsx", "utf8")), true);

  /*
   * --- The prize total ------------------------------------------------------------
   *
   * A game's prize is free text, so a total is a reading job. What matters is that it
   * only claims what it can read: the largest figure per game, no "Trophy only" counted
   * as zero, and no unit invented when the organisers used two different ones.
   */
  check("prizes are added up",
    totalPrizePool([
      { prizePool: "10,000 SAR" },
      { prizePool: "7,500 SAR" },
      { prizePool: "5,000 SAR" },
      { prizePool: "2,500 SAR" },
    ])?.display, "25,000 SAR");
  check("a game with no figure is skipped, not counted as zero",
    totalPrizePool([{ prizePool: "10,000 SAR" }, { prizePool: "Trophy only" }])?.games, 1);
  check("…and a tournament with no figures has no total at all",
    totalPrizePool([{ prizePool: "" }, { prizePool: "Trophy only" }]), null);
  check("the largest number is the prize, not the placement",
    totalPrizePool([{ prizePool: "1st: 5,000 SAR, 2nd: 2,000 SAR" }])?.amount, 5000);
  check("Arabic-Indic digits are read too",
    totalPrizePool([{ prizePool: "١٠٠٠٠ ريال" }])?.amount, 10000);
  check("two different units are not silently merged",
    totalPrizePool([{ prizePool: "10,000 SAR" }, { prizePool: "5,000 ريال" }])?.display, "15,000");
  check("a mixed cash-and-kit prize still counts its cash",
    totalPrizePool([{ prizePool: "Gaming PC + 5,000 SAR" }])?.amount, 5000);
  check("the total is printed with group separators",
    totalPrizePool([{ prizePool: "1000000 SAR" }])?.display, "1,000,000 SAR");

  /* The card only exists when there is a figure, and it says how many titles it covers. */
  check("the landing shows the total", /totalPrizePool\(config\.games\)/.test(landing), true);
  check("…guarded, so no figure means no card", /\{prize && \(/.test(landing), true);
  check("…with a count of the titles behind it",
    /home\.prizeTotalAcross/.test(landing) && "home.prizeTotal" in EN, true);

  /*
   * --- Both gate pages centre the logo ---------------------------------------------
   *
   * The link is `inline-block` so it wraps the mark tightly, and inside a plain block that
   * put it against the start edge — 115px left of the card's centre line at 1280px wide,
   * on both the grand admin page and the staff page. A flex wrapper centres it without
   * stretching the link to the full width, which would make the whole header clickable.
   */
  const gate = stripComments(readFileSync("src/components/admin/secret-gate.tsx", "utf8"));
  check("the gate's logo is centred",
    /mb-6 flex justify-center/.test(gate), true);

  /*
   * --- Switching language does not leave the form ----------------------------------
   *
   * `setLanguage` used to call `window.location.reload()`. The wizard's "has this visitor
   * started" flag is component state, so the reload threw a captain three steps into a
   * registration back onto the landing page — the draft survived, but the form was gone,
   * which reads as being kicked out. The direction change does not need a reload.
   */
  const provider = stripComments(readFileSync("src/components/form/language-provider.tsx", "utf8"));
  check("switching language does not reload the page",
    /location\.reload\(\)/.test(provider), false);
  check("…it updates state instead", /setLanguageState\(next\)/.test(provider), true);
  check("…and still records the choice in the URL",
    /searchParams\.set\("lang", next\)/.test(provider), true);
  check("…and in storage, for the next visit",
    /localStorage\.setItem\(STORAGE_KEY, next\)/.test(provider), true);

  /* Versions travel from the database to the landing page, or the image would be stale. */
  const homePage = stripComments(readFileSync("src/app/page.tsx", "utf8"));
  check("the home page reads the sponsor logo versions", /listSponsorLogoVersions\(\)/.test(homePage), true);
  check("…and passes them to the form", /sponsorLogoVersions=\{sponsorLogoVersions\}/.test(homePage), true);
  for (const page of ["src/app/admin/page.tsx", "src/app/admin/staff/page.tsx"]) {
    check(`${page.split("/").slice(-2, -1)[0]} console reads them`,
      /listSponsorLogoVersions\(\)/.test(stripComments(readFileSync(page, "utf8"))), true);
  }
}

console.log("\n── The form asks in the right order, and quickly ──");
{
  /*
   * Three complaints from the organiser, one at a time.
   *
   * 1. "While I was starting to write my email, it appeared to me that I should verify my
   *    email even if I haven't finished yet." True: the panel rendered from the moment the
   *    field had focus, so the first keystroke was met with a demand to verify an address
   *    that did not exist yet.
   *
   * 2. "It told me to verify my email before it checked if the email was registered." Also
   *    true, and worse than it sounds — the live check deliberately refuses to say whether
   *    an *unproven* address is registered (that would let a stranger sweep student-number
   *    ranges), so the answer could only arrive after the code. The student spent a mailbox
   *    round trip on an address that could never be used. The request endpoint now answers
   *    it, because that is the one place the caller has named the address they want mail at
   *    and is rate limited to a dozen tries per ten minutes.
   *
   * 3. "I want every operation be faster." The debounce, the queries and the entry
   *    animation were all slower than they needed to be.
   */
  const verify = stripComments(readFileSync("src/components/form/email-verification.tsx", "utf8"));

  /* (1) Nothing is asked of a half-typed address. The button is shown but disabled,
     so the order of work is visible without turning the field red or accepting a code
     for an address that is not finished yet. */
  check("the verify button stays disabled until the address is complete",
    /if \(!usable\) \{[\s\S]*?disabled[\s\S]*?\}/.test(verify), true);
  check("…and the 'enter a valid address first' line is gone for good",
    !/enterValidFirst/.test(verify), true);
  check("…including from both dictionaries",
    !("verify.enterValidFirst" in EN) && !("verify.enterValidFirst" in AR), true);

  /* (2) The registered check comes before the code. Order matters, so it is asserted by
     position in the file rather than by presence: the clash query must be above the row
     that issues a code, or the fix has silently reverted. */
  const otpRoute = stripComments(readFileSync("src/app/api/otp/request/route.ts", "utf8"));
  const clashAt = otpRoute.indexOf("findMemberClashes([{ email, studentId: \"\" }])");
  const issueAt = otpRoute.indexOf("await createOtp(");
  check("the address is checked for a clash before a code is made", clashAt > 0, true);
  check("…and that check runs first", clashAt > 0 && issueAt > clashAt, true);
  check("…refusing with a message the form can recognise",
    /alreadyRegistered: true/.test(otpRoute), true);
  check("…in a sentence that already has an Arabic translation",
    hasArabicMessage("That email address is already registered"), true);
  check("the form shows that as its own callout, not a red line",
    /alreadyRegistered \? \(/.test(verify), true);
  check("…and says it once, not twice",
    /setAlreadyRegistered\(registered\);\s*if \(!registered\) \{/.test(verify), true);

  /* (3a) The live check answers sooner. */
  const watch = stripComments(readFileSync("src/components/form/use-duplicate-watch.ts", "utf8"));
  const debounce = Number(/const DEBOUNCE_MS = (\d+);/.exec(watch)?.[1] ?? "9999");
  check("the duplicate check waits less than 150ms", debounce > 0 && debounce < 150, true);

  /* (3b) The two questions are asked together rather than one after the other. */
  const checkRoute = stripComments(readFileSync("src/app/api/registrations/check/route.ts", "utf8"));
  check("the name and member clashes are queried in parallel",
    /\[clash, clashes\] = await Promise\.all\(\[/.test(checkRoute), true);
  check("…and the OTP counters are too",
    /\[recent, allRecent, globalMax\] = await Promise\.all\(\[/.test(otpRoute), true);

  /* (3c) The entry animation was long enough to wait for. */
  const css = readFileSync("src/app/globals.css", "utf8");
  const rise = Number(/animation: rise ([\d.]+)s/.exec(css)?.[1] ?? "9");
  check("a panel is on screen in under a third of a second", rise > 0 && rise <= 0.3, true);

  /* The new hint has to exist in both languages — an empty string would pass the type. */
  check("the 'open Edit my registration' hint is written",
    t("en", "verify.alreadyRegisteredHint").length > 20, true);
  check("…and written in Arabic",
    /[\u0600-\u06FF]/.test(t("ar", "verify.alreadyRegisteredHint")), true);
}

console.log("\n── Organisers register through a closed window ──");
organiserPreviewChecks()
  .catch((error) => {
    failures += 1;
    console.error("✖ the organiser-preview checks threw", error);
  })
  .then(() => {
    console.log("\n── The derived console path ──");
    return derivedPathChecks();
  })
  .catch((error) => {
    failures += 1;
    console.error("✖ the derived-path checks threw", error);
  })
  .then(() => {
    console.log("\n── A hashed ADMIN_SECRET ──");
    return hashedSecretChecks().catch((error) => {
      failures += 1;
      console.error("✖ the hashed-secret checks threw", error);
    });
  })
  .then(() => {
    console.log("\n── The grand admin's stored password ──");
    return credentialChecks().catch((error) => {
      failures += 1;
      console.error("✖ the credential checks threw", error);
    });
  })
  .then(() => {
    console.log("\n── The secret is bootstrap only ──");
    return lockoutEscapeChecks().catch((error) => {
      failures += 1;
      console.error("✖ the lockout-escape checks threw", error);
    });
  })
  .then(() => {
    console.log(`\n${failures === 0 ? "✓ all checks passed" : `✖ ${failures} check(s) failed`}\n`);
    /* `process.exitCode`, not `process.exit()`. Exiting immediately truncates stdout:
       when the output is a pipe the writes are asynchronous, and the last few kilobytes
       — including this summary — were being dropped, so a passing run looked like a run
       that stopped half way. Setting the code lets Node drain its buffers and exit on
       its own with the right status. */
    process.exitCode = failures === 0 ? 0 : 1;
  });

}

/* One entry point, and a non-zero exit on any failure — including a throw, which would
   otherwise look like a pass to CI. */
runChecks().catch((error) => {
  console.error("✖ the checks threw", error);
  process.exitCode = 1;
});
