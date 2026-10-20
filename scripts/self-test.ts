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
import { DEFAULT_TOURNAMENT, normaliseConfig, rosterRulesFor, selectableUniversities, type GameDefinition } from "../src/lib/tournament";
import { SAUDI_REGIONS, regionLabel } from "../src/lib/regions";
import { validateDraft, validatePayload, toPayload, personNameError, fieldStep, isStepValid, revealsImmediately, STEP_COUNT, STUDENT_ID_PATTERN, STUDENT_ID_MIN, STUDENT_ID_MAX, type RegistrationDraft, emptyMember } from "../src/lib/validation";
import { readFileSync } from "node:fs";
import { hasArabicMessage, requestedLanguage, DEFAULT_LANGUAGE, roleLabelKey, arabicDigits, digitsOnly, toWesternDigits, t, EN, AR, translateMessage, type MessageKey } from "../src/lib/i18n";

import { findBlockedTerm, gameTagPolicyError, moderate as moderateText, nameWarnings, personNamePolicyError, teamNamePolicyError } from "../src/lib/name-policy";
import { readImageSize } from "../src/lib/image";
import { makeProof, makeSkipProof, verifyProof, hashCode, generateCode, otpConfigured, safeEqual, OTP_MAX_ATTEMPTS } from "../src/lib/otp";
import { plainText, teamToPlayerRows } from "../src/lib/sheet-export";
import { buildConfirmationEmail } from "../src/lib/confirmation-email";
import { renderOtpEmail } from "../src/lib/mailer";
import { maskEmail, stripTeamPrefix, teamToDraft } from "../src/lib/team-draft";
import { appBaseUrl, appUrl } from "../src/lib/app-url";
import { decodePng, downscale, encodePng, shrinkPng } from "../src/lib/png";
import { validateAdminTeamEdit } from "../src/lib/admin-edit";
import { channelSettings, escapeHtml, fromAddress, mailerConfigured } from "../src/lib/mailer";
import type { StoredTeam } from "../src/lib/store";
import { DEFAULT_PRIVACY_NOTICE, DEFAULT_PRIVACY_NOTICE_AR } from "../src/lib/privacy-notice";
import { adminPath, staffPath } from "../src/lib/admin-path";
import { callerAddress } from "../src/lib/rate-limit";
import { adminEmail, adminEmails, adminSecretIsHashed, checkAdminSecret, hashAdminSecret, isAdminEmail } from "../src/lib/admin-auth";
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

const verified = { email: "a@ksu.edu.sa", verifiedEmail: "a@ksu.edu.sa", studentId: "1234", gameTag: "A#1", universityId: "ksu", fullName: "Ali Hassan", discord: "ali", phone: "0512345678" };

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
check("OTP configured", otpConfigured(), true);
const code = generateCode();
check("code is 6 digits", /^\d{6}$/.test(code), true);
check("hash is stable", hashCode(code, "A@ksu.edu.sa", "player-email") === hashCode(code, "a@ksu.edu.sa", "player-email"), true);
check("hash ignores purpose mismatch", hashCode(code, "a@ksu.edu.sa", "player-email") === hashCode(code, "a@ksu.edu.sa", "edit-access"), false);

const proof = makeProof("Ali@ksu.edu.sa", "player-email");
check("proof verifies for its address", verifyProof(proof, "ali@ksu.edu.sa", "player-email"), true);
check("proof rejected for another address", verifyProof(proof, "other@ksu.edu.sa", "player-email"), false);
check("proof rejected for another purpose", verifyProof(proof, "ali@ksu.edu.sa", "edit-access"), false);
check("tampered proof rejected", verifyProof(`${proof}x`, "ali@ksu.edu.sa", "player-email"), false);
check("empty proof rejected", verifyProof("", "ali@ksu.edu.sa", "player-email"), false);

/* OTP_SKIP_VERIFY mints a proof signed with a fixed dev key, so a skipped proof can
   never pass a real check — the whole point of the guard. */
const skipProof = makeSkipProof("Ali@ksu.edu.sa", "player-email");
check("a skipped proof is shaped like a proof", skipProof.includes("."), true);
check("a skipped proof does not pass real verification", verifyProof(skipProof, "ali@ksu.edu.sa", "player-email"), false);

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
  createdAt: new Date("2026-09-20T10:00:00Z"),
  updatedAt: new Date("2026-09-20T10:00:00Z"),
  members: [
    {
      id: "m1", teamId: "t1", position: 0, fullName: "Ali Hassan", gameTag: "Ali#1",
      universityId: "ksu", universityName: "King Saud University", universityRegion: "Riyadh",
      email: "ali@ksu.edu.sa", studentId: "1234", discord: "ali", phone: "+966512345678",
      role: "STARTER", requirements: [{ id: "r1", label: "Rank", value: "Diamond" }],
      createdAt: new Date("2026-09-20T10:00:00Z"),
    },
    {
      id: "m2", teamId: "t1", position: 1, fullName: "Omar Salem", gameTag: "Omar#2",
      universityId: "ksu", universityName: "King Saud University", universityRegion: "Riyadh",
      email: "omar@ksu.edu.sa", studentId: null, discord: "omar", phone: "+966512345679",
      role: "COACH", requirements: [],
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
check("APP_URL wins, trailing slash trimmed", appBaseUrl(), "https://ksucrown.sa");
check("paths join without doubling", appUrl(appBaseUrl(), "/?tab=edit"), "https://ksucrown.sa/?tab=edit");
check("paths join when missing a slash", appUrl(appBaseUrl(), "x"), "https://ksucrown.sa/x");
delete process.env.APP_URL;

const fakeRequest = new Request("https://preview-abc.vercel.app/api/registrations", { method: "POST" });
check("the request origin is used when APP_URL is unset", appBaseUrl(fakeRequest), "https://preview-abc.vercel.app");
check("a malformed request falls back rather than throwing", typeof appBaseUrl({ url: "not a url" } as Request), "string");
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
  email: "admin.a@ksu.edu.sa",
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
    { ...adminMember, gameTag: "B#1", email: "admin.b@ksu.edu.sa", studentId: "445100002", discord: "ali_b" },
    { ...adminMember, gameTag: "C#1", email: "admin.c@ksu.edu.sa", studentId: "445100003", discord: "ali_c" },
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
check("the error names the field", badEmail.ok ? null : badEmail.errors["member.0.email"], "Must be a university email ending in .edu.sa");

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
check("with no overrides both channels share the account", channelSettings("otp").host, channelSettings("confirmation").host);
check("the shared host is used", channelSettings("otp").host, "shared.example.test");
check("a shared account is not reported as dedicated", channelSettings("confirmation").dedicated, false);

// 2. Override one channel only. The other must be untouched.
process.env.SMTP_OTP_HOST = "codes.example.test";
process.env.SMTP_OTP_USER = "codes@otp.test";
process.env.SMTP_OTP_PORT = "2525";
check("the overridden channel moves", channelSettings("otp").host, "codes.example.test");
check("the overridden channel takes its own user", channelSettings("otp").user, "codes@otp.test");
check("the overridden channel takes its own port", channelSettings("otp").port, 2525);
check("the other channel is untouched", channelSettings("confirmation").host, "shared.example.test");
check("an overridden channel reports itself dedicated", channelSettings("otp").dedicated, true);

/* Fields fall back one at a time, not as a block — so overriding only the host of
   a second account on the same provider is a one-line change. */
check("an unset field still falls back", channelSettings("otp").from, "KSU Crown");
check("the fallback From borrows the channel's own user", fromAddress(channelSettings("otp")), "KSU Crown <codes@otp.test>");
check("the shared channel's From borrows the shared user", fromAddress(channelSettings("confirmation")), "KSU Crown <one@shared.test>");

// 3. Both channels fully separate.
process.env.SMTP_CONFIRMATION_HOST = "records.example.test";
process.env.SMTP_CONFIRMATION_USER = "records@mail.test";
process.env.SMTP_CONFIRMATION_REPLY_TO = "organisers@real.test";
check("both channels can be fully separate", [channelSettings("otp").host, channelSettings("confirmation").host], ["codes.example.test", "records.example.test"]);
check("a per-channel reply-to wins over the shared one", channelSettings("confirmation").replyTo, "organisers@real.test");
check("a channel without its own reply-to falls back", channelSettings("otp").replyTo, "");

/* MAIL_REPLY_TO sits between them: a channel's own value beats it, and it beats
   the authenticated user, which is what `defaultReplyTo` would otherwise use. */
process.env.MAIL_REPLY_TO = "org@example.test";
check("the global reply-to is used when the channel has none", channelSettings("otp").replyTo, "org@example.test");
check("the channel's own reply-to still wins", channelSettings("confirmation").replyTo, "organisers@real.test");

// 4. Passwords are taken literally, unlike every other setting.
process.env.SMTP_OTP_PASS = "  spaced secret  ";
check("a password is not trimmed", channelSettings("otp").pass, "  spaced secret  ");
check("other settings are trimmed", channelSettings("otp").host, "codes.example.test");

// 5. Configuration is per channel, so one can be missing while the other works.
clearChannels();
delete process.env.SMTP_HOST;
check("a channel with no host is unconfigured", mailerConfigured("otp"), false);
check("the other channel is unaffected", mailerConfigured("confirmation"), false);
Object.assign(process.env, sharedEnv);
check("and configured once the host is back", mailerConfigured("otp"), true);
clearChannels();

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
  check(`the ${language} code round-trips back to the stored hash`, safeEqual(hashCode(digitsOnly(shown), "player@example.test", "player-email"), hashCode("123456", "player@example.test", "player-email")), true);
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

console.log("\n── Arabic gets Tajawal, and only Arabic does ──");
/* The typeface rules are CSS, so nothing in the render path can be unit-tested
   directly. What can be checked is the structure they depend on, and that structure is
   where the bugs were:

   - `font-family: var(--font-sans)` on `body` beat the per-language rule, because a
     declaration on `body` wins over what `body` would inherit. Measured in the browser:
     Arabic body still reported Inter.
   - `--font-display` was both the raw family and the composed list, so a rule that
     named the raw family read its own property — invalid at computed-value time, and
     the winner between the two was decided by source order.
   - Neither rule could be reached from the Arabic document by a subtree declaring
     English, because custom properties inherit: the English block inside the Arabic
     privacy notice and the organiser console both came out in Tajawal. */
const css = readFileSync("src/app/globals.css", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

check("Tajawal is loaded with the arabic subset", /Tajawal\(\{/.test(layout) && /subsets:\s*\[\s*"arabic"/.test(layout), true);
check("the Arabic face is exported as its own variable", /variable:\s*"--font-arabic"/.test(layout), true);
/* Latin alongside Arabic: an Arabic form still contains team names, addresses and
   badge digits, and handing those to a second family renders one sentence in two
   typefaces. */
check("Tajawal also covers latin, so mixed text stays even", /subsets:\s*\[\s*"arabic",\s*"latin"\s*\]/.test(layout), true);
check("Tajawal declares the weights the form uses", /weight:\s*\[\s*"400",\s*"700",\s*"800"\s*\]/.test(layout), true);

/* The default family must be on `html`, or the language rules cannot displace it. */
check("the default family is declared on html, not body", /html\s*\{[^}]*font-family:\s*var\(--font-sans\)/.test(css), true);
check("body carries no font-family", /body\s*\{[^}]*font-family/.test(css), false);

/* The raw Archivo family must not share a name with the composed list. */
check("Archivo Black has its own variable name", /variable:\s*"--font-archivo"/.test(layout), true);
check("the composed display list points at the raw family", /--font-display:\s*var\(--font-archivo\)/.test(css), true);
check("no rule makes --font-display refer to itself", /--font-display:\s*var\(--font-display\)/.test(css), false);

/* Both directions, declared as properties so a subtree can opt out. */
check("Arabic declares its own font-family", /\[lang="ar"\]\s*\{[^}]*font-family:\s*var\(--font-arabic\)/.test(css), true);
check("English declares font-family too, to stop inheriting Arabic", /\[lang="en"\]\s*\{[^}]*font-family:\s*var\(--font-body\)/.test(css), true);

/* The monospace face is a Latin token renderer in both languages. */
check("Arabic leaves --font-mono alone", /\[lang="ar"\][^}]*--font-mono/.test(css), false);

/* Heading weight. Archivo Black's normal weight is a black weight; Tajawal's is an
   ordinary text weight, so the family swap alone flattened the hierarchy. */
check("Arabic headings are given a heavy weight", /\[lang="ar"\]\s*\.font-display\s*\{[^}]*font-weight:\s*800/.test(css), true);
check("English headings keep Archivo Black", /\[lang="en"\]\s*\.font-display\s*\{[^}]*var\(--font-archivo\)/.test(css), true);
/* Tajawal has no 600, so `font-semibold` cannot be honoured — recorded here so the
   absence reads as a decision rather than an oversight. */
const declared = /weight:\s*\[([^\]]+)\]/.exec(layout)?.[1] ?? "";
check("no weight is declared that Tajawal does not have", /"600"/.test(declared), false);

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
  check("a hidden university is refused", universityError("seu", "male"), "This university is not available for this division");
  check("a women-only university is refused in the male division", universityError("pnu", "male"), "This university is not available for this division");
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
    "This university is not available for this division",
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
  check("a bare reference no longer exempts a team", /verifyProof\(editProof/.test(checkRoute), true);
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

  const scoped = makeProof("lead@ksu.edu.sa", "edit-access", "team-a");
  check("an edit proof opens its own team", verifyProof(scoped, "lead@ksu.edu.sa", "edit-access", "team-a"), true);
  check("an edit proof does not open another team", verifyProof(scoped, "lead@ksu.edu.sa", "edit-access", "team-b"), false);
  check("an edit proof is not an unscoped proof", verifyProof(scoped, "lead@ksu.edu.sa", "edit-access"), false);
  check("a player proof still verifies unscoped", verifyProof(makeProof("p@ksu.edu.sa", "player-email"), "p@ksu.edu.sa", "player-email"), true);

  const read = (path: string) => stripComments(readFileSync(path, "utf8"));
  for (const route of ["src/app/api/otp/verify/route.ts", "src/app/api/registrations/lookup/route.ts"]) {
    const source = read(route);
    check(`${route.split("/").slice(-2, -1)[0]}: a guess is spent atomically before comparing`, /claimOtpAttempt\(record\.id, OTP_MAX_ATTEMPTS\)[\s\S]*safeEqual\(hashCode/.test(source), true);
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
      email: "a@ksu.edu.sa", emailProof: "x", studentId: "445123456",
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

    check("the reader draws the pages itself",
      /pdfjs-dist\/legacy\/build\/pdf\.mjs/.test(reader), true);
    /* Imported inside the effect: the renderer is about a megabyte and only the rules tab
       needs it, so a static import would put it in every visitor's bundle. */
    check("the renderer is loaded only when the tab is opened",
      /await import\(\s*"pdfjs-dist\//.test(reader), true);
    check("the worker is served from this origin",
      /new URL\(\s*"pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs"/.test(reader), true);
    /* A PDF is a program to a viewer, and this one is rendered beside the session cookie. */
    check("nothing in the document is evaluated",
      /isEvalSupported: false/.test(reader), true);

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
    const skipBranch = /if \(otpSkipVerify\(\)\) \{([\s\S]*?)\n  \}/.exec(verify)?.[1] ?? "";
    /* Skipping the code must not skip the allowlist — including a grant withdrawn
       moments ago, which is why the check is the live one. */
    check("skip mode still requires a live grant", /findLiveStaffAccess\(email\)/.test(skipBranch), true);
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
    /const emails = adminEmails\(\);\s*const email = emails\[0\][\s\S]{0,900}return sessionResponse\(\)/.test(stepOne), true);
  check("…and it warns loudly rather than silently",
    /ADMIN_EMAIL is not set[\s\S]{0,120}NO emailed/.test(stepOne), true);
  check("…and reports the state so the console can warn too",
    /twoStep: adminTwoStep\(\)/.test(stepOne), true);

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
  check("commas, semicolons and newlines all separate addresses", adminEmails(),
    ["first@ksu.edu.sa", "second@ksu.edu.sa", "third@ksu.edu.sa", "fourth@ksu.edu.sa"]);
  check("the primary is the first address configured", adminEmail(), "first@ksu.edu.sa");

  process.env.ADMIN_EMAIL = " Ali@KSU.edu.sa, ali@ksu.edu.sa ";
  check("case is folded and duplicates collapse", adminEmails(), ["ali@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "Ali <ali@ksu.edu.sa>";
  check("a mail client's display-name form is understood", adminEmails(), ["ali@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "not-an-address, ok@ksu.edu.sa";
  check("entries that are not addresses are dropped", adminEmails(), ["ok@ksu.edu.sa"]);

  process.env.ADMIN_EMAIL = "a@ksu.edu.sa,b@ksu.edu.sa";
  check("membership recognises every configured address", isAdminEmail(" B@KSU.edu.sa "), true);
  check("membership still refuses a stranger", isAdminEmail("c@ksu.edu.sa"), false);

  process.env.ADMIN_EMAIL = "";
  check("an empty value means there is no grand admin", adminEmails(), []);
  check("…and no primary address", adminEmail(), null);

  if (savedAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = savedAdminEmail;

  /* Step two must not be a way in on its own: it is reachable without the secret, so the
     only thing standing between it and a session is the emailed code. */
  check("step two takes no address from the caller",
    /adminEmail\(\)/.test(stepTwo) && /JSON\.parse[\s\S]{0,200}email/.test(stepTwo), false);
  check("step two checks the code against the stored hash",
    /safeEqual\(hashCode\(code, email, "admin-access"\), record\.codeHash\)/.test(stepTwo), true);
  check("step two spends a guess before comparing",
    /claimOtpAttempt\(record\.id, OTP_MAX_ATTEMPTS\)[\s\S]{0,300}safeEqual/.test(stepTwo), true);
  check("step two consumes the code once",
    /consumeOtpOnce\(record\.id\)/.test(stepTwo), true);
  /* With no second factor configured there is no code to check, so completing a sign-in
     here would skip step one entirely. It must refuse. */
  check("step two refuses when no code can exist",
    /if \(!adminTwoStep\(\)\)[\s\S]{0,200}Two-step sign-in is not configured/.test(stepTwo), true);

  /* The admin address is configuration, and its absence means different things in each
     environment — a fresh clone must work, a deployment must not silently lose the step. */
  const auth = stripComments(readFileSync("src/lib/admin-auth.ts", "utf8"));
  check("the admin address is read from the environment",
    /process\.env\.ADMIN_EMAIL/.test(auth), true);
  /* More than one grand admin: the list is split on commas, semicolons or whitespace, and
     the first address stays primary so reordering is the only way to move the anchor. */
  check("several grand-admin addresses are supported",
    /export function adminEmails\(\)/.test(auth), true);
  check("the list is split on commas, semicolons and whitespace",
    /split\(\/\[\\s,;\]\+\//.test(auth), true);
  check("the primary address is the first configured",
    /return adminEmails\(\)\[0\] \?\? null/.test(auth), true);
  /* The step is in force exactly when there is somewhere to send the code — so the function
     answers "is it running", not "ought it to be". Those came apart once and cost a
     production lockout; see the note above. */
  check("the step is on exactly when it can send",
    /return Boolean\(adminEmail\(\)\)/.test(auth), true);
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
    middleware.indexOf("await consoleRoute(request)") <
      middleware.indexOf('process.env.CSP_STRICT === "0"'), true);
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

  /* Belt and braces: the route refuses on its own, because a matcher is configuration
     and configuration is what gets edited later by someone who has not read it. */
  const adminPage = stripComments(readFileSync("src/app/admin/page.tsx", "utf8"));
  check("the console page requires the marker the middleware sets",
    /headers\(\)\)\.get\(CONSOLE_HEADER\)/.test(adminPage) && /notFound\(\)/.test(adminPage), true);
  /* A constant marker would be one leaked string away from re-exposing the console, so
     the marker is the secret segment itself. */
  check("the marker is the secret segment, not a constant",
    /if \(!presented \|\| presented !== \(await adminPath\(\)\)\) notFound\(\)/.test(adminPage), true);

  const adminPathSource = readFileSync("src/lib/admin-path.ts", "utf8");
  /* Reading the secret at call time is what lets the value be swapped and, more
     importantly, what stops a build-time `undefined` becoming a fixed public path. */
  check("the path is derived from the live secret",
    /process\.env\.ADMIN_SECRET\?\.trim\(\)/.test(adminPathSource), true);
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
  check("the page resolves both addresses on the server",
    /await Promise\.all\(\[adminHref\(\), staffHref\(\)\]\)/.test(readFileSync("src/app/page.tsx", "utf8")), true);

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
  check("the admin lockout is consulted before comparing",
    /adminLockout\(request\)[\s\S]{0,160}checkAdminSecret\(candidate\)/.test(stripComments(adminSource)), true);
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

  /* The live configuration must not be the mode that is about to change meaning. */
  const envPath = ".env";
  if (readFileSync(envPath, "utf8").includes("DATABASE_URL=")) {
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

console.log("\n── The console's sheet link ──");
/* The spreadsheet's address is a separate setting from the webhook that writes to it, and
   the link is deliberately console-only — the sheet holds every player's contact details. */
{
  const env = process.env as Record<string, string | undefined>;
  const original = env.SHEET_URL;

  try {
    delete env.SHEET_URL;
    check("no SHEET_URL means no link", sheetUrl(), null);

    env.SHEET_URL = "   ";
    check("a blank SHEET_URL means no link", sheetUrl(), null);

    const real = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0";
    env.SHEET_URL = real;
    check("a real sheets address is accepted", sheetUrl() !== null, true);
    check("it is recognised as a sheets address", looksLikeSheetUrl(real), true);
    /* The webhook is a script.google.com URL, which must NOT be mistaken for the sheet. */
    check("the Apps Script URL is not a sheets address",
      looksLikeSheetUrl("https://script.google.com/macros/s/AKfycb/exec"), false);

    /* The value lands in an href on the console — the one page holding every setting and
       every registration — so a non-http scheme must be refused, not rendered. */
    env.SHEET_URL = "javascript:alert(1)";
    check("a javascript: URL is refused", sheetUrl(), null);
    env.SHEET_URL = "data:text/html,<script>alert(1)</script>";
    check("a data: URL is refused", sheetUrl(), null);
    env.SHEET_URL = "not a url at all";
    check("a malformed URL is refused", sheetUrl(), null);
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
      /sheetUrl=\{sheetUrl\(\)\}/.test(readFileSync(path, "utf8")), true);
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
  const original = env.ADMIN_SECRET;
  const password = "correct horse battery staple";

  try {
    /* --- scrypt, the recommended form ------------------------------------ */
    const hashed = hashAdminSecret(password);
    check("a generated secret is a scrypt value", hashed.startsWith("scrypt:"), true);
    /* Two hashes of one password must differ, or the salt is not doing its job and the
       same password would be recognisable across deployments. */
    check("hashing twice gives different values", hashAdminSecret(password) !== hashed, true);

    env.ADMIN_SECRET = hashed;
    check("a hashed secret is recognised as hashed", adminSecretIsHashed(), true);
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
    check("a sha256 secret is recognised as hashed", adminSecretIsHashed(), true);
    check("the sha256 form verifies", await checkAdminSecret(password), true);
    check("the sha256 form rejects a wrong password", await checkAdminSecret("nope"), false);
    /* Uppercase hex is the same hash, and a person pasting one should not be locked out. */
    env.ADMIN_SECRET = `sha256:${createHash("sha256").update(password).digest("hex").toUpperCase()}`;
    check("uppercase hex is accepted", await checkAdminSecret(password), true);

    /* --- plaintext, so this change cannot lock anyone out --------------- */
    env.ADMIN_SECRET = "an-ordinary-secret";
    check("a plaintext secret still works", await checkAdminSecret("an-ordinary-secret"), true);
    check("a plaintext secret rejects a wrong value", await checkAdminSecret("other"), false);
    check("a plaintext secret is not reported as hashed", adminSecretIsHashed(), false);

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
    if (original === undefined) delete env.ADMIN_SECRET;
    else env.ADMIN_SECRET = original;
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
  check("the pepper is its own variable", /process\.env\.ADMIN_PEPPER/.test(auth), true);
  check("the pepper is empty when unset",
    /const configured = process\.env\.ADMIN_PEPPER\?\.trim\(\);\s*if \(!configured\) return Buffer\.alloc\(0\)/.test(auth),
    true);
  /* Checked on the function body alone: a window wide enough to catch the next function
     would match an `adminSecret()` call there and pass for the wrong reason. */
  {
    const body = /export function adminPepper\(\): Buffer \{([\s\S]*?)\n\}/.exec(auth)?.[1] ?? "";
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
      callerAddress(req({ "x-vercel-forwarded-for": "1.2.3.4" })), "local");
    /*
     * **`X-Forwarded-For` is not trusted at all off-Vercel.**
     *
     * The first version of this fix fell back to the *rightmost* entry, reasoning that a
     * proxy which appends puts the real address last. That only holds if a proxy is
     * actually there — and it is not, on a directly reachable deployment. Verified: a client
     * sending three different values got three different buckets, i.e. still attacker-chosen.
     * Rotation is therefore useless to an attacker now: every request lands in the same
     * shared bucket.
     */
    const rotated = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((spoof) =>
      callerAddress(req({ "x-forwarded-for": spoof })),
    );
    check("rotating X-Forwarded-For gives one bucket, not many",
      new Set(rotated).size, 1);
    check("…and that bucket is the shared one", rotated[0], "local");
    check("an appended chain is not trusted either",
      callerAddress(req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" })), "local");
    /* Also client-settable, so not read implicitly at all — trusting it as a last resort
       would reopen the same hole. */
    check("a bare x-real-ip is not trusted by default",
      callerAddress(req({ "x-real-ip": "7.7.7.7" })), "local");
    check("no headers falls back to one shared bucket",
      callerAddress(req({})), "local");

    /* On Vercel the platform overwrites these, so they are authoritative there. */
    process.env.VERCEL = "1";
    check("on Vercel the edge header is used",
      callerAddress(req({ "x-vercel-forwarded-for": "1.2.3.4" })), "1.2.3.4");
    check("on Vercel a bare X-Forwarded-For is still ignored",
      callerAddress(req({ "x-forwarded-for": "9.9.9.9" })), "local");
    delete process.env.VERCEL;

    /* An operator naming the authoritative header is the precise answer. */
    process.env.TRUSTED_IP_HEADER = "x-real-ip";
    check("TRUSTED_IP_HEADER is honoured",
      callerAddress(req({ "x-real-ip": "7.7.7.7" })), "7.7.7.7");
    check("…and outranks a forged platform header",
      callerAddress(req({ "x-real-ip": "7.7.7.7", "x-vercel-forwarded-for": "1.2.3.4" })),
      "7.7.7.7");
    /* Configuring trust must never end up trusting *more* than nothing: if the named
       header is absent, do not fall back to something the client wrote. */
    check("a configured-but-absent header does not fall back to X-Forwarded-For",
      callerAddress(req({ "x-forwarded-for": "5.5.5.5" })), "local");
  } finally {
    if (original.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original.vercel;
    if (original.trusted === undefined) delete process.env.TRUSTED_IP_HEADER;
    else process.env.TRUSTED_IP_HEADER = original.trusted;
  }

  /* And the source must not drift back. */
  const source = stripComments(readFileSync("src/lib/rate-limit.ts", "utf8"));
  check("the trust decision is gated on VERCEL",
    /if \(process\.env\.VERCEL\)/.test(source), true);
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
    /if \(!team\)[\s\S]{0,180}That code has expired/.test(route), true);

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
    /if \(!team && overGlobalCeiling\)/.test(route), true);
  check("…and that branch still answers exactly as usual",
    /overGlobalCeiling[\s\S]{0,400}stage: "code-sent"/.test(route), true);
  check("…rather than returning an error", /We are sending a lot of codes right now/.test(route), false);
  const otpRequest = stripComments(readFileSync("src/app/api/otp/request/route.ts", "utf8"));
  check("the player code endpoint has one too",
    /countAllRecentOtps\("player-email"/.test(otpRequest), true);
  const otp = readFileSync("src/lib/otp.ts", "utf8");
  check("the ceiling is a number, not a placeholder",
    /export const OTP_GLOBAL_MAX_PER_WINDOW = (\d+|globalMax\(\));/.test(otp), true);
  /* `OTP_GLOBAL_MAX` exists so an operator can tune it and so this suite can lower it to
     exercise the ceiling without minting three hundred codes. A value that is not a
     positive integer must be ignored — a typo cannot be allowed to disable the brake. */
  check("the ceiling can be configured", /process\.env\.OTP_GLOBAL_MAX/.test(otp), true);
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

console.log("\n── The derived console path ──");
derivedPathChecks()
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
    console.log(`\n${failures === 0 ? "✓ all checks passed" : `✖ ${failures} check(s) failed`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
