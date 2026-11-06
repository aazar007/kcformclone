/**
 * Arabic and English for the public registration form.
 *
 * ## Why the dictionary is flat, and why it is one file
 *
 * Keys are dotted strings in a single object rather than nested per screen. That
 * keeps `keyof typeof EN` as the key type, so a typo in a component is a compile
 * error rather than a blank label at runtime — which is the failure mode that
 * matters here, because a missing string on an Arabic form is invisible to whoever
 * writes the English one.
 *
 * ## What is translated, and what is not
 *
 * The **entrant-facing form** is translated: the wizard, all four steps, email
 * verification, the success panel and the edit flow, including every validation
 * message. Entrants are students and Arabic is the language they will read.
 *
 * The **admin console is not**. It has one audience of a handful of known
 * organisers, and keeping it single-language means one place to change rather than
 * two that can disagree.
 *
 * ## Validation messages
 *
 * `validation.ts` builds its messages as English strings, and it runs on the server
 * as well as in the browser — so it cannot simply read the current language. Rather
 * than change every message to a key, they are translated on the way to the screen
 * by `translateMessage`, which falls back to the English original. That fallback is
 * deliberate: an untranslated message is a small blemish, while a blank one leaves
 * someone unable to register with no idea why.
 */

export type Language = "en" | "ar";

export const LANGUAGES: { id: Language; label: string; english: string }[] = [
  { id: "ar", label: "العربية", english: "Arabic" },
  { id: "en", label: "English", english: "English" },
];

export const DEFAULT_LANGUAGE: Language = "ar";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ar";
}

/**
 * The language a request asked for, or the default.
 *
 * The server cannot know which language a student chose — that lives in their
 * browser — so every request that results in an email carries the choice. This
 * reads it and falls back rather than rejecting: an unrecognised value means "we
 * could not tell", and sending the default is better than sending nothing.
 */
export function requestedLanguage(body: unknown): Language {
  if (typeof body !== "object" || body === null) return DEFAULT_LANGUAGE;
  const value = (body as { language?: unknown }).language;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/** Arabic reads right-to-left; English does not. */
export function isRtl(language: Language): boolean {
  return language === "ar";
}

/** The `dir` attribute for a language. */
export function direction(language: Language): "rtl" | "ltr" {
  return isRtl(language) ? "rtl" : "ltr";
}

/** Where the chosen language is remembered. */
export const LANGUAGE_STORAGE_KEY = "ksu-crown.language";

/**
 * Sets `lang` and `dir` before the first paint.
 *
 * The direction has to be right *before* anything is laid out. Setting it from a
 * React effect happens after hydration, which is late enough for the browser to
 * have already laid the page out left-to-right and then yank it — a visible jump
 * on every load, worst on a slow connection.
 *
 * Inlined into `<head>` as a plain script for that reason. It reads the same key
 * and understands the same `?lang=` override as `LanguageProvider`, so the two
 * cannot disagree about what the current language is.
 */
export const LANGUAGE_BOOTSTRAP_SCRIPT = `(function(){try{
var p=new URLSearchParams(location.search).get("lang");
var l=(p==="en"||p==="ar")?p:localStorage.getItem("${LANGUAGE_STORAGE_KEY}");
if(l!=="en"&&l!=="ar"){l="${DEFAULT_LANGUAGE}"}
var e=document.documentElement;
e.lang=l;e.dir=(l==="ar")?"rtl":"ltr";
}catch(e){}})();`;

/* ------------------------------------------------------------------ */
/* Digits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Western digits to Arabic-Indic.
 *
 * Used for *prose* — "٣ أعضاء", a date, a count in a sentence — where an Arabic
 * reader expects their own numerals. It is deliberately **not** used for a
 * one-time code or a reference: those are tokens to be transcribed exactly, and
 * see `toWesternDigits` for what happens when they are not.
 */
export function arabicDigits(value: string | number): string {
  const digits = "٠١٢٣٤٥٦٧٨٩";
  return String(value).replace(/\d/g, (d) => digits[Number(d)]);
}

/**
 * Arabic-Indic digits back to Western.
 *
 * **This exists because JavaScript's `\d` is ASCII-only.** `str.replace(/\D/g, "")`
 * — the obvious way to keep just the digits of a code — silently deletes every
 * Arabic-Indic numeral, turning `١٢٣٤٥٦` into an empty string. That shipped: an
 * Arabic verification email showed the code in Arabic-Indic digits and the API
 * stripped it to nothing, so the code was *always* wrong however carefully it was
 * typed. Anywhere a code or a number is read from a person, this runs first.
 */
export function toWesternDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Keep only digits, reading Arabic-Indic ones as Western.
 *
 * The filter behind every code and number field, so a person typing on an Arabic
 * keyboard produces the same digits the server is comparing against.
 */
export function digitsOnly(value: string): string {
  return toWesternDigits(value).replace(/[^0-9]/g, "");
}

/* ------------------------------------------------------------------ */
/* Form strings                                                        */
/* ------------------------------------------------------------------ */

export const EN = {
  /* -- shared -- */
  "common.back": "Back",
  "common.continue": "Continue",
  "common.submit": "Submit registration",
  "common.submitting": "Submitting…",
  "common.save": "Save changes",
  "common.saving": "Saving…",
  "common.optional": "Optional",
  "common.required": "Required",
  "common.dismiss": "Dismiss",
  "common.edit": "Edit",
  "common.startOver": "Start over",
  "common.done": "Done",
  "common.language": "Language",

  /* -- wizard shell -- */
  "wizard.newTab": "New registration",
  "wizard.editTab": "Edit my registration",
  "wizard.tabsLabel": "Registration mode",
  "wizard.intro":
    "You register as the team leader. Add each player's university and email — they fill in the rest.",
  "wizard.stepOf": "Step {step} of {total}",
  "wizard.fieldsToGo": "{count} fields to go",
  "wizard.ready": "Ready to submit",
  "wizard.railLabel": "Steps",
  "wizard.footerNote": "KSU Crown esports championship",

  /* -- footer -- */
  "footer.privacy": "Privacy Policy",
  "footer.contact": "Contact us",
  "footer.social": "Social media",
  "footer.community": "Community",
  "footer.rights": "Esports Student Club · King Saud University",
  "footer.opensNewTab": "Opens in a new tab",


  /* -- landing -- */
  "home.badgeOpen": "Registration is open",
  "home.badgeClosed": "Registration is closed",
  "home.liveBadge": "Live",
  "home.liveDefault": "Tournament is live — watch us on our official channels.",
  "home.liveOpensNewTab": "opens in a new tab",
  "home.headline": "Build your squad. Claim the crown.",
  "home.sub": "Register your team for {tournament} in four steps.",
  "home.cta": "Register your team",
  "home.leaderWarning":
    "Only the team leader may register the team. Duplicate registrations will result in a ban.",
  "home.ctaEdit": "Edit my registration",
  "home.ctaRules": "Read the rulebook",
  "home.gamesTitle": "Choose your battlefield",
  "home.sponsorsTitle": "Our sponsors",
  "home.prize": "Prize pool",
  "home.prizeTotal": "Total prize pool",
  "home.prizeTotalAcross": "across {count} titles",
  "home.prizeTotalAcrossOne": "one title, one crown",
  "home.players": "{count} players",
  "home.playerOne": "1 player",
  "home.back": "Back to start",
  "home.toTop": "Back to the top",

  /* -- steps -- */
  "step.team.title": "Team",
  "step.team.blurb": "Name your squad and pick your section",
  "step.game.title": "Game",
  "step.game.blurb": "Choose the title you are entering",
  "step.roster.title": "Roster",
  "step.roster.blurb": "Members, roles and email verification",
  "step.review.title": "Review",
  "step.review.blurb": "Check everything before submitting",

  /* -- team step -- */
  "team.nameLabel": "Team name",
  "team.nameHint": "3–{max} characters. We add “Team” for you.",
  "team.announcedAs": "Will be announced as",
  "team.divisionLabel": "Your section",
  "team.divisionHint": "Your section decides which games you can enter.",
  "division.male": "Male",
  "division.female": "Female",
  "team.male": "Male",
  "team.female": "Female",
  "team.gamesOpen": "",
  "team.gamesOpenOne": "1 game open",

  /* -- game step -- */
  "game.chooseLabel": "Choose the game",
  "game.openTo": "Open to",
  "game.onlyDivision": "{division} section",
  "game.openForDivision": "Games open to the {division} section.",
  "game.fieldsOne": "A squad fields 1 player at a time.",
  "game.fieldsMany": "A squad fields {count} players at a time.",
  "game.noGames": "No game is open to your section right now.",
  "game.divisionFirst": "Choose your section first.",
  "game.mayAdd": " You may also add {extras}.",
  "game.subsOne": "1 substitute",
  "game.subsMany": "{count} substitutes",
  "game.coachesOne": "1 coach",
  "game.coachesMany": "{count} coaches",
  "game.listJoin": "{first} and {second}",
  "game.onField": "{format} · {count} on field",

  /* -- roster step -- */
  "roster.label": "Roster",
  "roster.complete": "{done}/{total} complete",
  "roster.startersNeeded": "{have} starters · {want} needed",
  "roster.starterNeeded": "{have} starter · {want} needed",
  "roster.subs": "{have} subs · max {want}",
  "roster.coaches": "{have} coaches · max {want}",
  "roster.addStarter": "Add starter ({count} more needed)",
  "roster.addStarterOne": "Add starter (1 more needed)",
  "roster.startersComplete": "Starters complete",
  "roster.addSubstitute": "Add substitute",
  "roster.addCoach": "Add coach",
  "roster.fieldsExactly": "{game} fields exactly {count} starters — {state}",
  "roster.fieldsAtLeast": "{game} fields {count} starters — add {missing} more to complete the lineup.",
  "roster.needMore": "The roster is at its limit of {max}. The organisers set that cap.",
  "roster.startersOnly": "This tournament registers starters only.",
  "roster.gameFieldsPlayers": "{game} fields {count} players ({format}).",
  "roster.gameFieldsPlayerOne": "{game} fields 1 player ({format}).",
  "roster.chooseGameFirst": "Choose your game first — its squad size decides the roster.",
  "roster.universityMixed": "Each member picks their own university — a roster may mix institutions.",
  "roster.universitySame": "Every member must study at the same university.",
  "roster.onlyRegions": " Only universities in {regions} are listed.",
  "roster.universitiesCount": "{count} universities",
  "roster.playerN": "Player {n}",
  "roster.coachN": "Coach {n}",
  "roster.teamLeader": "Team leader",
  "roster.makeLeader": "Make member {n} the team leader",
  /* Shown instead of the checkbox when the roster has one eligible member — a 1v1
     title, where there is nobody else to nominate. */
  "roster.leaderAutomatic":
    "The only player on a 1v1 roster is the team leader automatically.",
  "roster.removePlayer": "Remove player {n}",
  "roster.removeCoach": "Remove coach {n}",
  "roster.needed": "{count} needed",
  "field.domainMismatch": "Not a {domain} address",
  "review.edit": "Edit",
  "review.email": "Email",
  "review.emailConfirmed": "Email confirmed",
  "review.emailNotConfirmed": "Email not confirmed",
  "review.emailPending": "Pending confirmation",
  "review.detailsPending":
    "Waiting for this player to add their details. They appear here automatically.",
  "edit.organiserHelp": "You can still open this registration without the email:",
  "edit.useOrganiserCode": "Use the organiser code",
  "edit.editInConsole": "Edit it in the console",
  "roster.starter": "Starter",
  "roster.substitute": "Substitute",
  "roster.coach": "Coach",
  "roster.roleFor": "Role for {role} {n}",
  "roster.notFinished": "This member is not finished — send the code above.",
  "roster.notFinishedLeader": "This team leader is not finished — send the code above.",
  "roster.notFinishedCoach": "This coach is not finished — check the details above.",
  "roster.mainPlayers": "Main players",
  "roster.mainPlayersFixed": "{game} fields this many. Pick who plays.",
  "roster.substitutesLabel": "Substitutes",
  "roster.noSubstitutes": "This game does not allow substitutes.",
  "roster.coachLabel": "The team has a coach",
  "roster.noCoach": "This game does not allow a coach.",
  "roster.leaderIsRegistrant": "You are the team leader — the first player is you.",
  "roster.selfComplete":
    "You enter this player's university and email. We email them a link to add the rest.",
  "roster.selfCompleteCoach":
    "You enter this coach's email. We email them a link to add the rest.",
  /* -- live roster: teammates completing their own details -- */
  "live.title": "Players completing their details",
  "live.sending": "Sending each player their link…",
  "live.waiting": "{pending} of {total} players have not added their details yet.",
  "live.waitingOne": "1 of {total} players has not added their details yet.",
  "live.done": "Every player has added their details.",
  "live.hint": "Details appear here as players submit them.",
  "live.refresh": "Refresh now",
  "live.error": "We could not send the players' links. You can still submit; the organisers can resend them.",
  "live.unreachable": "We could not reach the server to send the players' links.",
  "live.retry": "Try again",
  "live.submitWarning":
    "{pending} of {total} players have not added their details. Submit again to register anyway — their links stay valid.",
  "live.submitBlocked": "Players may need a moment to check their email.",
  "roster.pickGameFirst": "Pick a game first.",
  "roster.noUniversities":
    "No university is open to your section right now. Check back, or contact the organisers.",
  "roster.selectUniversity": "Select this member's university…",
  "roster.universityGone": "That university is no longer eligible — pick another.",
  "roster.thisGame": "This game",
  "requirement.choose": "Choose…",

  /* -- member fields -- */
  "field.fullName": "Full name",
  "field.fullNameHint": "As printed on your student ID.",
  "field.fullNamePlaceholder": "Full name as on your student ID",
  "field.gameTag": "Game tag",
  "field.gameTagHint": "Exactly as it appears in game.",
  "field.gameTagCoachHint": "Optional for coaching staff.",
  "field.gameTagPlaceholder": "e.g. Falcon#1234",
  "field.university": "University",
  "field.universityCoachLabel": "University (optional for coaches)",
  "field.universityCoachHint": "Optional for coaches — leave this blank if it does not apply.",
  "field.email": "University email",
  "field.emailHint":
    "The address your university issues, e.g. 441313142@student.ksu.edu.sa.",
  "field.emailCoachLabel": "Email",
  "field.emailCoachHint": "Any address we can reach you on.",
  "field.emailCoachPlaceholder": "you@example.com",
  "field.emailPlaceholder": "4XXXXXXX@student.ksu.edu.sa",
  /* Shown where the placeholder would be, and as the disabled "send code" tooltip,
     while no university is chosen. */
  "field.emailChooseUniversityFirst": "Choose a university first",
  "field.studentId": "Student ID",
  "field.studentIdHint": "4–20 numbers",
  /* Shown instead of the hint once the number has been read out of the member's email
     address, so a value that appeared on its own is explained rather than mysterious. */
  "field.studentIdFromEmail": "Filled in from your email — change it if wrong.",
  "field.studentIdCoachHint": "Optional for coaching staff.",
  "field.studentIdPlaceholder": "e.g. 445123456",
  "field.discord": "Discord ID",
  "field.discordHint": "2–32 characters — letters, numbers, dots or underscores.",
  "field.discordPlaceholder": "e.g. crown_player",
  "field.phone": "Phone number",
  "field.phoneHint": "Saudi mobile — 05X XXX XXXX or +9665XXXXXXXX.",
  "field.phonePlaceholder": "05X XXX XXXX",
  "field.phoneSaved": "Saved as {phone}",
  "field.phoneSavedPrefix": "Saved as",

  /* -- email verification -- */
  "verify.send": "Send verification code",
  "verify.finishEmailFirst": "Finish your full university email to send a code.",
  "verify.sendAgain": "Try sending it again",
  "verify.resend": "Resend",
  "verify.verify": "Verify",
  "verify.codePlaceholder": "6-digit code",
  "verify.codeLabel": "Verification code",
  "verify.confirmed": "Email confirmed",
  "verify.useDifferent": "Use a different address",
  "verify.sent": "We emailed a 6-digit code to {email}.",
  "verify.logged": "SMTP is not configured, so the code was written to the server log instead.",
  "verify.alreadyRegisteredHint":
    "If this team is yours, open “Edit my registration” instead of registering again.",
  "verify.notThere": "Not there?",
  "verify.checkSpam": "Check your Spam or Junk folder",
  "verify.spamBody":
    "— university filters often file them there. Mark it “not spam” so the next one arrives.",
  "verify.unreachable": "We could not reach the server. Check your connection and try again.",
  "verify.couldNotSend": "Could not send the code.",
  "verify.pendingAfterSubmit":
    "We email this player a link to add their details when you press Continue.",
  "verify.pendingCoachAfterSubmit":
    "We email this coach a link to add their details when you press Continue.",

  /* -- duplicate badge -- */
  "dup.checking": "Checking",
  "dup.free": "Free",
  "dup.nameTaken": "Name taken",
  "dup.alreadyUsed": "Already used",
  "dupError.teamName": "That team name is already registered. Please pick another.",
  "dupError.email": "This email is already registered with another team.",
  "dupError.studentId": "This student ID is already registered with another team.",
  "error.submitFailed": "Submission failed",
  "error.unreachable": "We could not reach the server. Check your connection and try again.",
  "roster.trimmed":
    "{game} fields {count} players, so the roster was trimmed from {from} to {to}.",
  "roster.trimmedOne":
    "{game} fields 1 player, so the roster was trimmed from {from} to {to}.",
  "conflict.row": "{value} — already on {team}",

  /* -- review step -- */
  "review.theUniversities": "the universities listed above",
  "review.institutions": "Institutions",
  "review.declarationFull":
    "By submitting you confirm every member is a currently enrolled student at {universities}, and that your roster is valid for {game}. {falseInfo}",
  "review.declarationNoGameFull":
    "By submitting you confirm every member is a currently enrolled student at {universities}. {falseInfo}",
  "review.team": "Team",
  "review.game": "Game",
  "review.roster": "Roster",
  "review.teamName": "Team name",
  "review.division": "Your section",
  "review.gameLabel": "Game",
  "review.format": "Format",
  "review.membersLabel": "Members",
  "review.leaderLabel": "Team leader",
  "review.university": "University",
  "review.universities": "Universities",
  "review.institution": "Institution",
  "review.leaderContact": "Team Leader Contact",
  "review.leader": "Leader",
  "review.playerNo": "Player {n}",
  "review.studentId": "Student ID",
  "review.universityEmail": "University email",
  "review.discord": "Discord ID",
  "review.phone": "Phone",
  "review.rosterSize": "Roster size",
  /* The review step's own breakdown. Deliberately not reused from `game.*`, which
     describes what the *format* allows rather than what this draft actually has. */
  "review.starterOne": "1 starter",
  "review.startersMany": "{count} starters",
  "review.subOne": "1 substitute",
  "review.subsMany": "{count} substitutes",
  "review.coachOne": "1 coach",
  "review.coachesMany": "{count} coaches",
  "review.rosterN": "Roster ({count})",
  "review.memberOne": "{count} member",
  "review.memberMany": "{count} members",
  "review.declaration":
    "By submitting you confirm these details are accurate, and that your roster is valid for {game}.",
  "review.declarationNoGame": "By submitting you confirm these details are accurate.",
  "review.falseInfo": "Providing false information leads to disqualification.",
  "review.consentLabel": "I accept the privacy notice and the tournament rules",
  "review.consentBody":
    "I have read the {link}, and I confirm that {members} with the organisers for this tournament.",
  "review.consentLink": "privacy notice",
  "review.consentMemberOne": "the member listed above knows that their details are being shared",
  "review.consentMemberMany":
    "all {count} members listed above know that their details are being shared",
  "review.needConsent": "Please confirm you have read and accept the notice",
  "review.summaryTitle": "Needs attention",
  "review.summaryAllGood": "Everything looks good",
  "review.warningsTitle": "Check these",

  /* -- validation summary -- */
  "summary.issueOne": "1 issue to fix",
  "summary.issues": "{count} issues to fix",
  "summary.form": "Form",
  "summary.more": "+{count} more",
  "summary.fix": "Fix",
  "summary.checkTitle": "Worth a double check",
  "summary.checkBody": "These will not block your entry.",

  /* -- success -- */
  "success.title": "You're in",
  "success.body": "{team} is registered for {tournament}. Keep your reference code safe.",
  "success.referenceLabel": "Registration reference",
  "success.copy": "Tap to copy",
  "success.copied": "Copied to your clipboard",
  "success.game": "Game",
  "success.roster": "Roster",
  "success.membersOne": "1 member",
  "success.membersMany": "{count} members",
  "success.university": "University",
  "success.universities": "Universities",
  "success.leader": "Team leader",
  "success.nextSteps":
    "We contact members by Discord or phone if anything needs confirming. The team leader gets the bracket, schedule and lobby details.",
  "success.shareTitle": "Team link",
  "success.shareBody":
    "Send this to your players. Each opens it, enters their email and fills in their own card.",
  "success.shareCopy": "Tap to copy the link",
  "success.shareCopied": "Link copied to your clipboard",
  "success.emailSent": "A confirmation with these details was emailed to your team leader.",
  "success.memberConfirmations":
    "Every other member was emailed a link to add their details. Anyone unfinished stays pending — the link still works.",
  "success.checkSpamTitle": "Not in the inbox? Check Spam or Junk.",
  "success.checkSpamBody":
    "University filters often file them there. If you find it, mark it “not spam”.",
  "success.emailFailed":
    "We could not email your confirmation — keep the reference code above.",
  "success.another": "Register another team",
  "success.draftRestored": "We restored your draft.",
  "success.discordTitle": "Join the tournament Discord",
  "success.discordBody":
    "Schedules, lobby codes and rulings are posted there. Every member should join.",
  "success.discordCta": "Open Discord",

  /* -- member email confirmation page -- */
  "confirm.invalidTitle": "This link is not valid",
  "confirm.invalidBody":
    "The confirmation link is incomplete or has been replaced. Ask your team leader to check the registration.",
  "confirm.home": "Back to the registration form",

  /* -- member details completion page -- */
  "complete.title": "Complete your details",
  "complete.intro":
    "The team leader of {team} entered your university and email. Fill in the rest.",
  "complete.teamLabel": "Team",
  "complete.emailLabel": "Email (entered by your team leader)",
  "complete.universityLabel": "University",
  "complete.gameLabel": "Game",
  "complete.roleLabel": "Role",
  "complete.pendingNote": "These details are yours to complete.",
  "complete.save": "Save my details",
  "complete.saving": "Saving…",
  "complete.savedTitle": "Your details are saved",
  "complete.savedBody":
    "Thanks, {name}. Your address is confirmed for {team}. You can update these details any time.",
  "complete.error": "We could not save your details just now. Please check the form and try again.",
  "complete.bannedTitle": "This place is not active",
  "complete.bannedBody":
    "This registration has been suspended by the organisers. If you think that is a mistake, contact them.",
  "complete.footnote": "This link belongs to your address only.",

  /* -- closed -- */
  "closed.title": "Registration is closed",
  "preview.title": "Registration is closed to the public",
  "preview.body": "You are signed in as an organiser, so the form stays open. Entries made here are real.",

  /* -- edit flow -- */
  "edit.introIdentify":
    "Enter the reference code and your email. We will send you a code to confirm it.",
  "edit.emailLabel": "Your email address",
  "edit.emailHint": "The address that was entered for you on the team.",
  "edit.emailPlaceholder": "you@student.ksu.edu.sa",
  "edit.emailNote": "We send a code to this address.",
  "edit.sendCode": "Email me a code",
  "edit.codeSentTo": "We sent a code to {email}.",
  "edit.adminOpen": "Open with the organiser code",
  "edit.adminToggle": "I am an organiser",
  "edit.startAgain": "Start again",
  "edit.roleLeader": "Team leader",
  "edit.rolePlayer": "Player",
  "edit.roleSubstitute": "Substitute",
  "edit.roleCoach": "Coach",
  "edit.roleOrganiser": "Organiser",
  "edit.rosterTitle": "Roster order",
  "edit.rosterHint": "Reorder the team here. You see names and positions only.",
  "edit.namePending": "Details not completed yet",
  "edit.moveUp": "Move up",
  "edit.moveDown": "Move down",
  "edit.saveOrder": "Save the order",
  "edit.orderSaved": "Roster order saved.",
  "edit.yourCard": "Your details",
  "edit.yourCardHint": "Your own card.",
  "edit.cardTitle": "Your player card",
  "edit.setupTitle": "Complete your details",
  "edit.setupIntro": "You are on {team}. Fill in your details.",
  "edit.cardIntro": "Your card for {team}.",
  "edit.saveProfile": "Save my details",
  "edit.profileSaved": "Your details are saved.",
  "edit.profileSavedBody": "The organisers can now see your details for {team}.",
  "edit.onlyYourCard": "Only your own card is shown.",
  "edit.title": "Edit my registration",
  "edit.intro": "Enter your reference code. We will email a code to confirm it is you.",
  "edit.hintReference": "Looks like ESC-26-4KQ7TNA.",
  "edit.adminLabel": "Organiser code",
  "edit.adminPlaceholder": "Admin code",
  "edit.introReference": "Enter your reference code and we will email a code to your team leader.",
  "edit.introOrganiser": "Enter the organiser code to open this registration without the leader's inbox.",
  "edit.useEmailCode": "Use the email code instead",
  "edit.organiserAsk": "Organiser? Don't have access to the leader's inbox?",
  "edit.checking": "Checking…",
  "edit.couldNotEmail": "We could not email the code to your team leader.",
  "edit.somethingWrong": "Something went wrong. Try again.",
  "edit.couldNotOpen": "We could not open that registration. Please start again.",
  "edit.referenceLabel": "Reference code",
  "edit.referencePlaceholder": "ESC-26-XXXXXXX",
  "edit.getCode": "Email me a code",
  "edit.sending": "Sending…",
  "edit.codeSent": "We emailed a code to {email}.",
  "edit.codeLabel": "Code from the email",
  "edit.open": "Open my registration",
  "edit.opening": "Opening…",
  "edit.changeReference": "Use a different reference",
  "edit.organiserLabel": "Organiser access code",
  "edit.organiserHint": "For organisers only.",
  "edit.organiserOpen": "Open as organiser",
  "edit.organiserBanner": "Opened as an organiser — no email was sent to the team.",
  "edit.bannerOrganiser": "Opened as an organiser. Saving changes what {team} sees.",
  "edit.bannerTeamFallback": "this team",
  "edit.introCode": "Enter the 6-digit code we sent to {email}.",
  "edit.emailFallback": "your team leader",
  "edit.leaderInboxNote": "Confirmed through the team leader's inbox.",
  "edit.checkSpam": "Not there? Check Spam or Junk.",
  "edit.checkSpamBody": "University filters often file these messages there.",
  "edit.saved": "Changes saved",
  "edit.savedBody":
    "{team} has been updated. Your reference code {reference} stays the same.",
  "rulebook.tab": "Rulebook",
  "rulebook.chooseGame": "Choose a game",
  "rulebook.none": "(no rules yet)",
  /* Plural: each title is published separately, so the heading covers a set. It also
     reads correctly over the empty state, which is the same panel. */
  "rulebook.title": "Tournament rulebooks",
  "rulebook.intro":
    "Read your game's rulebook before submitting. Scroll to the end to unlock the form.",
  "rulebook.open": "Open in a new tab",
  "rulebook.download": "Download",
  "rulebook.notPublished":
    "The rulebooks are not published yet. You must read your game's rules before submitting.",
  "rulebook.viewerLabel": "{game} rulebook, as a PDF",
  /* A way out, not a diagnosis: the frame usually renders, and telling a reader their
     browser "did not display" it when it plainly did makes the site look broken. */
  "rulebook.viewerFallback":
    "If it does not appear, open it in a new tab. You still need to read it.",
  "rulebook.loading": "Loading the rulebook…",
  /* The gate, said plainly. It follows the reader itself, which is where the scroll
     happens, so nobody has to wonder why the box on the next tab is still locked. */
  "rulebook.scrollHint": "Scroll to the end to unlock the submission page.",
  /*
   * The way back to the form.
   *
   * Reading the rules is something this page asks the captain to leave the form to do, so
   * it has to offer a way back. The tab bar technically does — but that tab is called "New
   * registration", which reads as *start over* to somebody who has already filled in a whole
   * form. A button that says what it does, sitting next to the document that was just read,
   * is the difference between a captain continuing and a captain abandoning.
   */
  "rulebook.continue": "Back to submission",
  "rulebook.continueHint":
    "Unlocks at the end. You still tick the box on the submission page.",
  "rules.acceptWithRulebook":
    "I have read the {game} rulebook and I agree to follow the tournament rules",
  "rules.acceptStandalone": "I agree to follow the tournament rules",
  "rules.consequence":
    "Breaking any rule may lead to disqualification and removal from the tournament.",
  "rules.mustOpen": "Open your game's rulebook first — scroll to the end to unlock this.",
  "rules.readIt": "Read the {game} rulebook",
} as const;

export type MessageKey = keyof typeof EN;

export const AR: Record<MessageKey, string> = {
  /* -- shared -- */
  "common.back": "السابق",
  "common.continue": "التالي",
  "common.submit": "إرسال التسجيل",
  "common.submitting": "جارٍ الإرسال…",
  "common.save": "حفظ التغييرات",
  "common.saving": "جارٍ الحفظ…",
  "common.optional": "اختياري",
  "common.required": "مطلوب",
  "common.dismiss": "إغلاق",
  "common.edit": "تعديل",
  "common.startOver": "البدء من جديد",
  "common.done": "تم",
  "common.language": "اللغة",

  /* -- wizard shell -- */
  "wizard.newTab": "تسجيل جديد",
  "wizard.editTab": "تعديل التسجيل",
  "wizard.tabsLabel": "طريقة التسجيل",
  "wizard.intro":
    "أنت تسجّل بوصفك قائد الفريق. أضف جامعة كل لاعب وبريده — وهو يكمل بقية بياناته.",
  "wizard.stepOf": "الخطوة {step} من {total}",
  "wizard.fieldsToGo": "بقيت {count} خانة",
  "wizard.ready": "جاهز للإرسال",
  "wizard.railLabel": "الخطوات",
  "wizard.footerNote": "بطولة KSU Crown للرياضات الإلكترونية",

  /* -- footer -- */
  "footer.privacy": "سياسة الخصوصية",
  "footer.contact": "تواصل معنا",
  "footer.social": "حسابات التواصل",
  "footer.community": "المجتمع",
  "footer.rights": "نادي الرياضات الإلكترونية · جامعة الملك سعود",
  "footer.opensNewTab": "يُفتح في تبويب جديد",

  /* -- landing -- */
  "home.badgeOpen": "التسجيل مفتوح",
  "home.badgeClosed": "التسجيل مغلق",
  "home.liveBadge": "مباشر",
  "home.liveDefault": "البطولة مباشرة الآن — تابعونا عبر قنواتنا الرسمية.",
  "home.liveOpensNewTab": "يُفتح في تبويب جديد",
  "home.headline": "كوّن فريقك. وانتزع التاج.",
  "home.sub": "سجّل فريقك في {tournament} في أربع خطوات.",
  "home.cta": "سجّل فريقك",
  "home.leaderWarning":
    "قائد الفريق فقط هو من يسجّل الفريق. والتسجيلات المكررة تؤدي إلى الإيقاف.",
  "home.ctaEdit": "تعديل التسجيل",
  "home.ctaRules": "اقرأ دليل القواعد",
  "home.gamesTitle": "ساحات المعركة",
  "home.sponsorsTitle": "رعاة البطولة",
  "home.prize": "الجائزة",
  "home.prizeTotal": "مجموع الجوائز",
  "home.prizeTotalAcross": "في {count} ألعاب",
  "home.prizeTotalAcrossOne": "في لعبة واحدة",
  "home.players": "{count} لاعبين",
  "home.playerOne": "لاعب واحد",
  "home.back": "العودة للرئيسية",
  "home.toTop": "العودة إلى الأعلى",

  /* -- steps -- */
  "step.team.title": "الفريق",
  "step.team.blurb": "",
  "step.game.title": "اللعبة",
  "step.game.blurb": "اختر اللعبة التي تشارك بها",
  "step.roster.title": "قائمة اللاعبين",
  "step.roster.blurb": "اللاعبين والأدوار وتأكيد البريد الإلكتروني",
  "step.review.title": "المراجعة",
  "step.review.blurb": "راجع كل شيء قبل الإرسال",

  /* -- team step -- */
  "team.nameLabel": "اسم الفريق",
  "team.nameHint":
    "من ٣ إلى {max} حرفًا. ونضيف «Team» تلقائيًا.",
  "team.announcedAs": "سيُعلن باسم",
  "team.divisionLabel": "قسمك",
  "team.divisionHint": "القسم الذي تختاره يحدّد الألعاب المتاحة لك.",
  "division.male": "طلاب",
  "division.female": "طالبات",
  "team.male": "طالب",
  "team.female": "طالبة",
  "team.gamesOpen": "",
  "team.gamesOpenOne": "",

  /* -- game step -- */
  "game.chooseLabel": "اختر اللعبة",
  "game.openTo": "متاحة لـ",
  "game.onlyDivision": "{division}",
  "game.openForDivision": "الألعاب المتاحة لقسم {division}.",
  "game.fieldsOne": "يُطلب لاعب واحد في هذه اللعبة.",
  "game.fieldsMany": "يلعب الفريق بـ{count} لاعبين.",
  "game.noGames": "لا توجد ألعاب متاحة لقسمك حاليًا.",
  "game.divisionFirst": "اختر قسمك أولًا.",
  "game.mayAdd": " ويمكنك كذلك إضافة {extras}.",
  "game.subsOne": "احتياطي واحد",
  "game.subsMany": "{count} احتياطيين",
  "game.coachesOne": "مدرّب واحد",
  "game.coachesMany": "{count} مدرّبين",
  "game.listJoin": "{first} و{second}",
  "game.onField": "{format} · {count} على الملعب",

  /* -- roster step -- */
  "roster.label": "قائمة اللاعبين",
  "roster.complete": "{done}/{total} مكتمل",
  "roster.startersNeeded": "{have} أساسي · المطلوب {want}",
  "roster.starterNeeded": "{have} أساسي · المطلوب {want}",
  "roster.subs": "{have} احتياط · الحد {want}",
  "roster.coaches": "{have} مدرّب · الحد {want}",
  "roster.addStarter": "إضافة أساسي (يتبقى {count})",
  "roster.addStarterOne": "إضافة أساسي (يتبقى ١)",
  "roster.startersComplete": "اكتمل عدد الأساسيين",
  "roster.addSubstitute": "إضافة احتياطي",
  "roster.addCoach": "إضافة مدرّب",
  "roster.fieldsExactly": "{game} يتطلب {count} أساسي بالضبط — {state}",
  "roster.fieldsAtLeast": "{game} يتطلب {count} أساسي — أضف {missing} لإكمال التشكيلة.",
  "roster.needMore": "بلغت القائمة حدّها الأقصى وهو {max}. الحد من تحديد المنظّمين.",
  "roster.startersOnly": "لا يوجد احتياطيين في هذه اللعبة.",
  "roster.gameFieldsPlayers": "{game} يتطلب {count} لاعبين ({format}).",
  "roster.gameFieldsPlayerOne": "{game} يتطلب لاعبًا واحدًا ({format}).",
  "roster.chooseGameFirst": "اختر اللعبة أولًا.",
  "roster.universityMixed": "اختر جامعة كل لاعب، ويجوز أن تكون مختلفة عن باقي الفريق.",
  "roster.universitySame": "يجب أن يدرس جميع الأعضاء في الجامعة نفسها.",
  "roster.onlyRegions": " تُعرض فقط جامعات {regions}.",
  "roster.universitiesCount": "{count} جامعات",
  "roster.playerN": "اللاعب {n}",
  "roster.coachN": "المدرّب {n}",
  "roster.teamLeader": "قائد الفريق",
  "roster.makeLeader": "تعيين اللاعب {n} قائدًا للفريق",
  "roster.leaderAutomatic":
    "اللاعب الوحيد في قائمة 1 ضد 1 هو قائد الفريق تلقائيًا.",
  "roster.removePlayer": "حذف اللاعب {n}",
  "roster.removeCoach": "حذف المدرّب {n}",
  "roster.needed": "المطلوب {count}",
  "field.domainMismatch": "ليس بريدًا لـ{domain}",
  "review.edit": "تعديل",
  "review.email": "البريد",
  "review.emailConfirmed": "البريد مؤكَّد",
  "review.emailNotConfirmed": "البريد غير مؤكَّد",
  "review.emailPending": "قيد التأكيد",
  "review.detailsPending":
    "بانتظار أن يضيف هذا اللاعب بياناته. وتظهر هنا تلقائيًا.",
  "edit.organiserHelp": "يمكنك فتح هذا التسجيل دون الحاجة إلى البريد:",
  "edit.useOrganiserCode": "استخدام رمز المنظّم",
  "edit.editInConsole": "عدّله في لوحة التحكم",
  "roster.starter": "أساسي",
  "roster.substitute": "احتياطي",
  "roster.coach": "مدرّب",
  "roster.roleFor": "دور {role} {n}",
  "roster.notFinished":
    "بيانات هذا اللاعب غير مكتملة — أرسل الرمز أعلاه.",
  "roster.notFinishedLeader":
    "بيانات قائد الفريق غير مكتملة — أرسل الرمز أعلاه.",
  "roster.notFinishedCoach":
    "بيانات المدرّب غير مكتملة — راجع البيانات أعلاه.",
  "roster.mainPlayers": "اللاعبون الأساسيون",
  "roster.mainPlayersFixed": "{game} يلعب بهذا العدد. اختر من يلعب.",
  "roster.substitutesLabel": "البدلاء",
  "roster.noSubstitutes": "هذه اللعبة لا تسمح ببدلاء.",
  "roster.coachLabel": "الفريق لديه مدرّب",
  "roster.noCoach": "هذه اللعبة لا تسمح بمدرّب.",
  "roster.leaderIsRegistrant":
    "أنت قائد الفريق — واللاعب الأول هو أنت.",
  "roster.selfComplete":
    "أنت تدخل جامعة هذا اللاعب وبريده. ونرسل له رابطًا لإكمال البقية.",
  "roster.selfCompleteCoach":
    "أنت تدخل بريد هذا المدرّب. ونرسل له رابطًا لإكمال البقية.",
  /* -- live roster: teammates completing their own details -- */
  "live.title": "اللاعبون يكملون بياناتهم",
  "live.sending": "جارٍ إرسال الرابط إلى كل لاعب…",
  "live.waiting": "{pending} من {total} لاعبين لم يضيفوا بياناتهم بعد.",
  "live.waitingOne": "لاعب واحد من {total} لم يضف بياناته بعد.",
  "live.done": "أضاف جميع اللاعبين بياناتهم.",
  "live.hint":
    "تظهر البيانات هنا عند إرسال اللاعبين لها.",
  "live.refresh": "تحديث الآن",
  "live.error": "تعذّر إرسال روابط اللاعبين. يمكنك الإرسال على أي حال، ويمكن للمنظّمين إعادة إرسالها.",
  "live.unreachable": "تعذّر الوصول إلى الخادم لإرسال روابط اللاعبين.",
  "live.retry": "إعادة المحاولة",
  "live.submitWarning":
    "{pending} من {total} لاعبين لم يضيفوا بياناتهم. أرسل مرة أخرى للتسجيل على أي حال — ستبقى روابطهم صالحة.",
  "live.submitBlocked":
    "قد يحتاج اللاعبون وقتًا لمراجعة بريدهم.",
  "roster.pickGameFirst":
    "اختر اللعبة أولًا.",
  "roster.noUniversities":
    "لا توجد جامعة متاحة لقسمك حاليًا. تحقّق لاحقًا أو تواصل مع المنظّمين.",
  "roster.selectUniversity": "اختر جامعة هذا اللاعب...",
  "roster.universityGone": "هذه الجامعة لم تعد متاحة — اختر غيرها.",
  "roster.thisGame": "هذه اللعبة",
  "requirement.choose": "اختر…",

  /* -- member fields -- */
  "field.fullName": "الاسم الكامل",
  "field.fullNameHint": "كما هو مكتوب في بطاقتك الجامعية.",
  "field.fullNamePlaceholder": "الاسم الثلاثي",
  "field.gameTag": "المعرّف في اللعبة",
  "field.gameTagHint": "كما يظهر في اللعبة تمامًا.",
  "field.gameTagCoachHint": "اختياري للمدرب.",
  "field.gameTagPlaceholder": "مثال: Falcon#1234",
  "field.university": "الجامعة",
  "field.universityCoachLabel": "الجامعة (اختياري للمدرّب)",
  "field.universityCoachHint": "اختياري للمدرّبين — اتركه فارغًا إن لم ينطبق.",
  "field.email": "البريد الجامعي",
  "field.emailHint":
    "البريد الذي تصدره جامعتك، مثل 441313142@student.ksu.edu.sa.",
  "field.emailCoachLabel": "البريد الإلكتروني",
  "field.emailCoachHint": "أي بريد يمكننا التواصل معك عليه.",
  "field.emailCoachPlaceholder": "you@example.com",
  "field.emailPlaceholder": "44XXXXXXX@student.ksu.edu.sa",
  "field.emailChooseUniversityFirst": "اختر الجامعة أولًا",
  "field.studentId": "الرقم الجامعي",
  "field.studentIdHint": "من ٤ إلى ٢٠ رقمًا فقط",
  "field.studentIdFromEmail": "تمت تعبئته من بريدك — عدّله إن كان غير صحيح.",
  "field.studentIdCoachHint": "اختياري للمدرب.",
  "field.studentIdPlaceholder": "مثال: 445123456",
  "field.discord": "معرّف ديسكورد",
  "field.discordHint": "من ٢ إلى ٣٢ خانة — حروف أو أرقام أو نقاط أو شرطات سفلية.",
  "field.discordPlaceholder": "مثال: esc.support",
  "field.phone": "رقم الجوال",
  "field.phoneHint": "جوال سعودي — 05X XXX XXXX أو +9665XXXXXXXX.",
  "field.phonePlaceholder": "05X XXX XXXX",
  "field.phoneSaved": "سيُحفظ بالشكل {phone}",
  "field.phoneSavedPrefix": "سيُحفظ بالشكل",

  /* -- email verification -- */
  "verify.send": "إرسال رمز التحقق",
  "verify.finishEmailFirst": "أكمل بريدك الجامعي لإرسال الرمز.",
  "verify.sendAgain": "إعادة محاولة الإرسال",
  "verify.resend": "إعادة الإرسال",
  "verify.verify": "تأكيد",
  "verify.codePlaceholder": "الرمز المكوّن من ٦ أرقام",
  "verify.codeLabel": "رمز التحقق",
  "verify.confirmed": "البريد مؤكَّد",
  "verify.useDifferent": "استخدام بريد آخر",
  "verify.sent": "أرسلنا رمزًا من ٦ أرقام إلى {email}.",
  "verify.logged": "لم يتم ضبط SMTP، فتم تسجيل الرمز في سجل الخادم بدلًا من إرساله.",
  "verify.alreadyRegisteredHint":
    "إن كان هذا الفريق فريقك، افتح «تعديل تسجيلي» بدلًا من التسجيل من جديد.",
  "verify.notThere": "لم تجده؟",
  "verify.checkSpam": "تحقّق من مجلد الرسائل غير المرغوب فيها",
  "verify.spamBody":
    "— فكثيرًا ما تضع الفلاتر الجامعية هذه الرسائل هناك. علّمها «ليست غير مرغوب فيها» ليصل ما بعدها.",
  "verify.unreachable": "تعذّر الوصول إلى الخادم. تحقّق من اتصالك وحاول مرة أخرى.",
  "verify.couldNotSend": "تعذّر إرسال الرمز.",
  "verify.pendingAfterSubmit":
    "نرسل لهذا اللاعب رابطًا لإكمال بياناته عند الضغط على «متابعة».",
  "verify.pendingCoachAfterSubmit":
    "نرسل لهذا المدرّب رابطًا لإكمال بياناته عند الضغط على «متابعة».",

  /* -- duplicate badge -- */
  "dup.checking": "جارٍ التحقّق",
  "dup.free": "متاح",
  "dup.nameTaken": "الاسم مستخدم",
  "dup.alreadyUsed": "مستخدم مسبقًا",
  "dupError.teamName": "اسم الفريق هذا مسجَّل مسبقًا. اختر غيره.",
  "dupError.email": "هذا البريد مسجَّل مسبقًا في فريق آخر.",
  "dupError.studentId": "هذا الرقم الجامعي مسجَّل مسبقًا في فريق آخر.",
  "error.submitFailed": "تعذّر الإرسال",
  "error.unreachable": "تعذّر الوصول إلى الخادم. تحقّق من اتصالك وحاول مرة أخرى.",
  "roster.trimmed":
    "{game} يتطلب {count} لاعبين، لذا تم تقليص القائمة من {from} إلى {to}.",
  "roster.trimmedOne":
    "{game} يتطلب لاعبًا واحدًا، لذا تم تقليص القائمة من {from} إلى {to}.",
  "conflict.row": "{value} — مسجَّل بالفعل في {team}",

  /* -- review step -- */
  "review.theUniversities": "الجامعات المذكورة أعلاه",
  "review.institutions": "الجهات",
  "review.declarationFull":
    "بالإرسال أنت تؤكّد أن كل لاعب طالب مسجَّل حاليًا في {universities}، وأن قائمتك مطابقة لمتطلبات {game}. {falseInfo}",
  "review.declarationNoGameFull":
    "بالإرسال أنت تؤكّد أن كل لاعب طالب مسجَّل حاليًا في {universities}. {falseInfo}",
  "review.team": "الفريق",
  "review.game": "اللعبة",
  "review.roster": "القائمة",
  "review.teamName": "اسم الفريق",
  "review.division": "قسمك",
  "review.gameLabel": "اللعبة",
  "review.format": "النظام",
  "review.membersLabel": "اللاعبين",
  "review.leaderLabel": "قائد الفريق",
  "review.university": "الجامعة",
  "review.universities": "الجامعات",
  "review.institution": "الجهة",
  "review.leaderContact": "بيانات قائد الفريق",
  "review.leader": "القائد",
  "review.playerNo": "اللاعب {n}",
  "review.studentId": "الرقم الجامعي",
  "review.universityEmail": "البريد الجامعي",
  "review.discord": "معرّف ديسكورد",
  "review.phone": "الجوال",
  "review.rosterSize": "حجم القائمة",
  "review.starterOne": "أساسي واحد",
  "review.startersMany": "{count} أساسي",
  "review.subOne": "احتياطي واحد",
  "review.subsMany": "{count} احتياطي",
  "review.coachOne": "مدرّب واحد",
  "review.coachesMany": "{count} مدرّب",
  "review.rosterN": "القائمة ({count})",
  "review.memberOne": "عضو واحد",
  "review.memberMany": "{count} لاعبين",
  "review.declaration":
    "بالإرسال أنت تؤكّد صحة هذه البيانات، وأن قائمتك مطابقة لمتطلبات {game}.",
  "review.declarationNoGame": "بالإرسال أنت تؤكّد صحة هذه البيانات.",
  "review.falseInfo": "تقديم معلومات غير صحيحة يؤدي إلى الاستبعاد.",
  "review.consentLabel": "أوافق على إشعار الخصوصية وعلى أنظمة البطولة",
  "review.consentBody": "قرأت {link}، وأؤكّد أن {members} مع المنظّمين لهذه البطولة.",
  "review.consentLink": "إشعار الخصوصية",
  "review.consentMemberOne": "اللاعب المذكور أعلاه يعلم بأن بياناته ستُشارَك",
  "review.consentMemberMany": "جميع اللاعبين المذكورين أعلاه ({count}) يعرفون أن بياناتهم ستُشارَك",
  "review.needConsent": "يرجى تأكيد قراءتك للإشعار وموافقتك عليه",
  "review.summaryTitle": "يحتاج إلى مراجعة",
  "review.summaryAllGood": "كل شيء يبدو صحيحًا",
  "review.warningsTitle": "تحقّق من التالي",

  /* -- validation summary -- */
  "summary.issueOne": "مشكلة واحدة تحتاج إلى إصلاح",
  "summary.issues": "{count} مشاكل تحتاج إلى إصلاح",
  "summary.form": "النموذج",
  "summary.more": "+{count} أخرى",
  "summary.fix": "إصلاح",
  "summary.checkTitle": "يستحق التحقق مرة أخرى",
  "summary.checkBody": "لن تمنع هذه إرسال تسجيلك.",

  /* -- success -- */
  "success.title": "تم التسجيل",
  "success.body": "{team} مسجَّل في {tournament}. احتفظ برمز التسجيل في مكان آمن.",
  "success.referenceLabel": "رقم التسجيل",
  "success.copy": "اضغط للنسخ",
  "success.copied": "تم النسخ",
  "success.game": "اللعبة",
  "success.roster": "القائمة",
  "success.membersOne": "لاعب واحد",
  "success.membersMany": "{count} لاعبين",
  "success.university": "الجامعة",
  "success.universities": "الجامعات",
  "success.leader": "قائد الفريق",
  "success.nextSteps":
    "نتواصل مع الأعضاء عبر ديسكورد أو الجوال عند الحاجة. وقائد الفريق يستلم الجدول ومواعيد المباريات وبيانات الغرفة.",
  "success.shareTitle": "رابط الفريق",
  "success.shareBody":
    "أرسل هذا الرابط إلى لاعبيك. يفتحه كل واحد منهم ويُدخل بريده ويكمل بطاقته.",
  "success.shareCopy": "اضغط لنسخ الرابط",
  "success.shareCopied": "تم نسخ الرابط",
  "success.emailSent": "أرسلنا رسالة تأكيد بهذه التفاصيل إلى بريد قائد الفريق.",
  "success.memberConfirmations":
    "أرسلنا إلى كل عضو آخر رابطًا لإضافة بياناته. ومن لم يكمل يبقى بحالة «قيد التأكيد» — والرابط لا يزال صالحًا.",
  "success.checkSpamTitle": "لم تجدها في صندوق الوارد؟ تحقّق من مجلد الرسائل غير المرغوب فيها.",
  "success.checkSpamBody":
    "فكثيرًا ما تضع الفلاتر الجامعية هذه الرسائل هناك. وإن وجدتها فعلّمها «ليست غير مرغوب فيها».",
  "success.emailFailed":
    "تعذّر إرسال رسالة التأكيد — احتفظ برقم التسجيل أعلاه.",
  "success.another": "تسجيل فريق آخر",
  "success.draftRestored": "استعدنا مسودتك.",
  "success.discordTitle": "انضم إلى ديسكورد البطولة",
  "success.discordBody":
    "تُنشر هناك الجداول ورموز الغرف والقرارات. يُفضّل أن ينضم كل عضو.",
  "success.discordCta": "فتح ديسكورد",

  /* -- member email confirmation page -- */
  "confirm.invalidTitle": "هذا الرابط غير صالح",
  "confirm.invalidBody":
    "رابط التأكيد غير مكتمل أو تم استبداله. اطلب من قائد فريقك مراجعة التسجيل.",
  "confirm.home": "العودة إلى نموذج التسجيل",

  /* -- member details completion page -- */
  "complete.title": "أكمل بياناتك",
  "complete.intro":
    "أدخل قائد فريق {team} جامعتك وبريدك. أكمل بقية البيانات.",
  "complete.teamLabel": "الفريق",
  "complete.emailLabel": "البريد الإلكتروني (أدخله قائد فريقك)",
  "complete.universityLabel": "الجامعة",
  "complete.gameLabel": "اللعبة",
  "complete.roleLabel": "الدور",
  "complete.pendingNote":
    "هذه البيانات عليك أنت.",
  "complete.save": "حفظ بياناتي",
  "complete.saving": "جارٍ الحفظ…",
  "complete.savedTitle": "تم حفظ بياناتك",
  "complete.savedBody":
    "شكرًا، {name}. تم تأكيد بريدك لفريق {team}. يمكنك تحديث بياناتك في أي وقت.",
  "complete.error": "تعذّر حفظ بياناتك الآن. يرجى مراجعة النموذج والمحاولة مرة أخرى.",
  "complete.bannedTitle": "هذا المركز غير مفعّل",
  "complete.bannedBody":
    "تم إيقاف هذا التسجيل من قبل المنظّمين. إن كنت ترى أن ذلك خطأ، فتواصل معهم.",
  "complete.footnote":
    "هذا الرابط يخصّ بريدك أنت فقط.",

  /* -- closed -- */
  "closed.title": "التسجيل مغلق",
  "preview.title": "التسجيل مغلق أمام العموم",
  "preview.body": "أنت مسجّل الدخول كمنظّم، لذلك يبقى النموذج متاحًا. والتسجيلات من هنا حقيقية.",

  /* -- edit flow -- */
  "edit.introIdentify":
    "أدخل رقم التسجيل وبريدك. وسنرسل إليك رمزًا لتأكيده.",
  "edit.emailLabel": "بريدك الإلكتروني",
  "edit.emailHint": "البريد الذي أُدخل لك في الفريق.",
  "edit.emailPlaceholder": "اسمك@student.ksu.edu.sa",
  "edit.emailNote":
    "نرسل رمزًا إلى هذا البريد.",
  "edit.sendCode": "أرسل لي رمزًا",
  "edit.codeSentTo": "أرسلنا رمزًا إلى {email}.",
  "edit.adminOpen": "فتح برمز المنظّم",
  "edit.adminToggle": "أنا منظّم",
  "edit.startAgain": "البدء من جديد",
  "edit.roleLeader": "قائد الفريق",
  "edit.rolePlayer": "لاعب",
  "edit.roleSubstitute": "بديل",
  "edit.roleCoach": "مدرّب",
  "edit.roleOrganiser": "منظّم",
  "edit.rosterTitle": "ترتيب القائمة",
  "edit.rosterHint":
    "أعد ترتيب الفريق هنا. ترى الأسماء والمراكز فقط.",
  "edit.namePending": "لم يكمل بياناته بعد",
  "edit.moveUp": "نقل لأعلى",
  "edit.moveDown": "نقل لأسفل",
  "edit.saveOrder": "حفظ الترتيب",
  "edit.orderSaved": "تم حفظ ترتيب القائمة.",
  "edit.yourCard": "بياناتك",
  "edit.yourCardHint": "بطاقتك أنت.",
  "edit.cardTitle": "بطاقتك كلاعب",
  "edit.setupTitle": "أكمل بياناتك",
  "edit.setupIntro": "أنت ضمن فريق {team}. أكمل بياناتك.",
  "edit.cardIntro": "بطاقتك في فريق {team}.",
  "edit.saveProfile": "حفظ بياناتي",
  "edit.profileSaved": "تم حفظ بياناتك.",
  "edit.profileSavedBody": "يمكن للمنظّمين الآن رؤية بياناتك في فريق {team}.",
  "edit.onlyYourCard": "تظهر بطاقتك وحدها.",
  "edit.title": "تعديل التسجيل",
  "edit.intro":
    "أدخل رقم التسجيل. وسنرسل رمزًا إلى بريد قائد الفريق للتأكد من هويتك.",
  "edit.hintReference": "يبدو بهذا الشكل ESC-26-4KQ7TNA.",
  "edit.adminLabel": "رمز المنظّم",
  "edit.adminPlaceholder": "رمز المنظّم",
  "edit.introReference": "أدخل رقم التسجيل وسنرسل رمزًا إلى بريد قائد الفريق.",
  "edit.introOrganiser": "أدخل رمز المنظّم لفتح هذا التسجيل دون الوصول إلى بريد القائد.",
  "edit.useEmailCode": "استخدام رمز البريد بدلًا من ذلك",
  "edit.organiserAsk": "منظّم؟ لا تستطيع الوصول إلى بريد القائد؟",
  "edit.checking": "جارٍ التحقّق…",
  "edit.couldNotEmail": "تعذّر إرسال الرمز إلى بريد قائد الفريق.",
  "edit.somethingWrong": "حدث خطأ ما. حاول مرة أخرى.",
  "edit.couldNotOpen": "تعذّر فتح هذا التسجيل. يرجى البدء من جديد.",
  "edit.referenceLabel": "رقم التسجيل",
  "edit.referencePlaceholder": "ESC-26-XXXXXXX",
  "edit.getCode": "أرسل لي رمزًا",
  "edit.sending": "جارٍ الإرسال…",
  "edit.codeSent": "أرسلنا رمزًا إلى {email}.",
  "edit.codeLabel": "الرمز الذي وصلك",
  "edit.open": "فتح التسجيل",
  "edit.opening": "جارٍ الفتح…",
  "edit.changeReference": "استخدام رقم آخر",
  "edit.organiserLabel": "رمز دخول المنظّمين",
  "edit.organiserHint": "للمنظّمين فقط.",
  "edit.organiserOpen": "فتح كمنظّم",
  "edit.organiserBanner": "تم الفتح كمنظّم — لم يُرسل أي بريد للفريق.",
  "edit.bannerOrganiser":
    "تم الفتح كمنظّم. الحفظ يغيّر ما يراه {team}.",
  "edit.bannerTeamFallback": "هذا الفريق",
  "edit.introCode": "أدخل الرمز المكوّن من ٦ أرقام الذي أرسلناه إلى {email}.",
  "edit.emailFallback": "قائد فريقك",
  "edit.leaderInboxNote": "يُؤكَّد عبر بريد قائد الفريق.",
  "edit.checkSpam": "لم تجده؟ تحقّق من مجلد الرسائل غير المرغوب فيها.",
  "edit.checkSpamBody": "فكثيرًا ما تضع الفلاتر الجامعية هذه الرسائل هناك.",
  "edit.saved": "تم حفظ التغييرات",
  "edit.savedBody": "تم تحديث {team}. ورقم التسجيل {reference} يبقى كما هو.",
  "rulebook.tab": "دفتر الأنظمة",
  "rulebook.chooseGame": "اختر لعبة",
  "rulebook.none": "(لا توجد أنظمة بعد)",
  "rulebook.title": "دفاتر أنظمة البطولة",
  "rulebook.intro":
    "اقرأ دفتر أنظمة لعبتك قبل الإرسال. مرّر إلى النهاية لفتح النموذج.",
  "rulebook.open": "افتح في صفحة جديد",
  "rulebook.download": "تنزيل",
  "rulebook.notPublished":
    "لم تُنشر دفاتر الأنظمة بعد. عليك قراءة أنظمة لعبتك قبل الإرسال.",
  "rulebook.viewerLabel": "دفتر أنظمة {game} بصيغة PDF",
  "rulebook.viewerFallback":
    "إن لم يظهر، افتحه في صفحة جديدة. وتبقى قراءته مطلوبة.",
  "rulebook.loading": "جارٍ تحميل دفتر الأنظمة…",
  "rulebook.scrollHint":
    "مرّر إلى النهاية لفتح صفحة الإرسال.",
  "rulebook.continue": "العودة إلى الإرسال",
  "rulebook.continueHint":
    "يُتاح عند النهاية. وستضع العلامة في صفحة الإرسال.",
  "rules.acceptWithRulebook": "قرأت دفتر أنظمة {game} وأوافق على الالتزام بأنظمة البطولة",
  "rules.acceptStandalone": "أوافق على الالتزام بأنظمة البطولة",
  "rules.consequence": "مخالفة أي نظام قد تؤدي إلى الاستبعاد وإخراج الفريق من البطولة.",
  "rules.mustOpen": "افتح دفتر أنظمة لعبتك أولًا — مرّر إلى النهاية لتفعيل الخيار.",
  "rules.readIt": "اقرأ دفتر أنظمة {game}",
};

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = {
  en: EN,
  ar: AR,
};

/**
 * Look up a message, substituting `{name}` placeholders.
 *
 * An unknown key returns the key itself rather than throwing: a missing translation
 * should be visible in the UI, not crash a registration form.
 */
export function t(language: Language, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[language][key] ?? EN[key] ?? key;
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] === undefined ? whole : String(vars[name]),
  );
}

/* ------------------------------------------------------------------ */
/* Validation messages                                                 */
/* ------------------------------------------------------------------ */

/**
 * Arabic for the fixed messages `validation.ts` produces.
 *
 * Keyed by the exact English string. The self-test enumerates the messages that
 * validation can actually emit and asserts each one has an entry here, so a new
 * rule added without a translation fails the build rather than appearing in English
 * on an Arabic form.
 */
const MESSAGE_AR: Record<string, string> = {
  /* person names */
  Required: "مطلوب",
  "Too short": "قصير جدًا",
  "Too long": "طويل جدًا",
  "Enter a name, not numbers or symbols": "أدخل اسمًا، لا أرقامًا أو رموزًا",
  "Use letters only — no numbers or special characters": "حروف فقط — بدون أرقام أو رموز",
  "Enter the full name — given name and family name": "أدخل اسمك الثلاثي",
  "This name contains language that is not allowed. Please choose another.":
    "هذا الاسم يحتوي على لغة غير مسموح بها. يرجى اختيار اسم آخر.",
  "This game tag contains language that is not allowed. Please choose another.":
    "هذا المعرّف يحتوي على لغة غير مسموح بها. يرجى اختيار غيره.",

  /* team name */
  "Enter your team name": "أدخل اسم الفريق",
  "Team name is required": "اسم الفريق مطلوب",
  "Invalid team name": "اسم الفريق غير صالح",
  "Team name contains language that is not allowed. Please choose another.":
    "اسم الفريق يحتوي على لغة غير مسموح بها. يرجى اختيار اسم آخر.",
  "Team name contains language that attacks people for who they are. Please choose another.":
    "اسم الفريق يحتوي على لغة غير مسموح بها. يرجى اختيار اسم آخر.",
  "Team name contains a threat or a reference to self-harm, which we cannot accept. If you are struggling, please talk to somebody you trust.":
    "اسم الفريق يحتوي على تهديد أو إشارة إلى إيذاء النفس، ولا يمكننا قبول ذلك.",
  "Team name cannot contain brackets, slashes, @ or emoji — letters, numbers, spaces, and . ' & - , only":
    "لا يمكن أن يحتوي اسم الفريق على أقواس أو شرطات مائلة أو @ أو رموز تعبيرية — الحروف والأرقام والمسافات و . ' & - , فقط",
  "Team name must contain letters, not only numbers or symbols":
    "يجب أن يحتوي اسم الفريق على حروف، لا أرقامًا أو رموزًا فقط",

  /* division and game */
  "Choose your section": "اختر قسمك",
  "Invalid section": "قسم غير صالح",
  "Choose a game": "اختر لعبة",
  "Choose a game from the list": "اختر لعبة من القائمة",
  "Invalid game": "لعبة غير متاحة",
  "Game is not offered in this section": "هذه اللعبة غير متاحة للقسم المُختار",

  /* consent */
  "Please confirm you have read and accept the notice":
    "يرجى تأكيد قراءتك للإشعار وموافقتك عليه",
  "Consent is required": "الموافقة مطلوبة",
  "Please confirm you have read the rulebook and agree to the rules":
    "يرجى تأكيد قراءتك لدفتر الأنظمة وموافقتك على الأنظمة",

  /* roster */
  "A roster needs at least one member": "يجب أن تضم القائمة لاعبًا واحدًا على الأقل",
  "Invalid member": "لاعب غير صالح",
  "The team leader must be a starter, not a coach":
    "يجب أن يكون قائد الفريق لاعبًا أساسيًا، لا مدرّبًا",
  "Invalid team leader": "قائد فريق غير صالح",
  "Add your members' names first": "أضف أسماء اللاعبين أولًا",
  "This tournament does not accept substitutes": "هذه البطولة لا تقبل احتياطيين",

  /* member fields */
  "2–32 characters — letters, numbers, dots, dashes or #":
    "من ٢ إلى ٣٢ خانة — حروف أو أرقام أو نقاط أو شرطات أو #",
  "2–32 characters — letters, numbers, dots or underscores":
    "من ٢ إلى ٣٢ خانة — حروف أو أرقام أو نقاط أو شرطات سفلية",
  "Invalid game tag": "معرّف لعبة غير صالح",
  "Duplicate game tag": "معرّف اللعبة مكرر",
  "Select this member's university": "اختر جامعة هذا اللاعب",
  "Select a university from the list": "اختر جامعة من القائمة",
  "Choose this member's university first — the address must be its domain":
    "اختر جامعة هذا اللاعب أولًا — يجب أن يكون البريد على نطاقها",
  "Choose the member's university first — the address must be its domain":
    "اختر جامعة اللاعب أولًا — يجب أن يكون البريد على نطاقها",
  "Invalid university": "جامعة غير صالحة",
  "University is outside the allowed provinces": "الجامعة خارج المناطق المسموح بها",
  "This university is not available for this section": "هذه الجامعة غير متاحة في هذا القسم",
  "Enter a valid email address": "أدخل بريدًا إلكترونيًا صحيحًا",
  "Must be a university email ending in .edu.sa": "يجب أن يكون بريدًا جامعيًا ينتهي بـ .edu.sa",
  "Email must end in .edu.sa": "يجب أن ينتهي البريد بـ .edu.sa",
  "Verify this address with the code we email you":
    "أكّد هذا البريد بالرمز الذي أرسلناه لك",
  "This email address has not been verified": "لم يتم تأكيد هذا البريد",
  "Duplicate email": "البريد مكرر",
  "Invalid student ID": "رقم جامعي غير صالح",
  "Duplicate student ID": "الرقم الجامعي مكرر",
  "4–20 numbers": "من ٤ إلى ٢٠ رقمًا فقط",
  "Invalid Discord ID": "معرّف ديسكورد غير صالح",
  "Invalid phone number": "رقم جوال غير صالح",
  "Enter a Saudi mobile, e.g. 05X XXX XXXX": "أدخل رقم جوال سعودي، مثال: 05X XXX XXXX",

  /* server-side */
  "Registration is closed.": "التسجيل مغلق.",
  "Registration is closed, so registrations can no longer be edited.":
    "التسجيل مغلق، لذا لم يعد بالإمكان تعديل التسجيلات.",
  "That request is too large.": "حجم الطلب كبير جدًا.",
  "That code has already been used. Ask for a new code.": "تم استخدام هذا الرمز مسبقًا. اطلب رمزًا جديدًا.",
  "That code has already been used. Start again to get a new code.":
    "تم استخدام هذا الرمز مسبقًا. ابدأ من جديد للحصول على رمز جديد.",
  "Consent is required to register": "الموافقة مطلوبة للتسجيل",
  "That email address is already registered": "هذا البريد مسجَّل مسبقًا",
  "A member with that student ID is already registered": "يوجد اللاعب مسجَّل بهذا الرقم الجامعي",
  "That value is already registered": "هذه القيمة مسجَّلة مسبقًا",
  "That email address is already used by another member": "هذا البريد مستخدم من لاعب آخر",
  "That student ID is already used by another member": "هذا الرقم الجامعي مستخدم من لاعب آخر",

  /* API errors the form displays verbatim. */
  "Enter a university email address ending in .edu.sa":
    "أدخل بريدًا جامعيًا صحيحًا",
  "Enter the reference code from your confirmation": "أدخل رقم التسجيل من رسالة التأكيد",
  "No registration matches that reference code": "لا يوجد تسجيل مطابق لرقم التسجيل هذا",
  "That registration has no contact address on file. Contact the organisers.":
    "لا يوجد بريد تواصل محفوظ لهذا التسجيل. تواصل مع المنظّمين.",
  "That admin code is not correct.": "رمز المنظّم غير صحيح.",
  "Some details are invalid": "بعض البيانات غير صحيحة",
  "We could not send the code.": "تعذّر إرسال الرمز.",
  "Could not send the code.": "تعذّر إرسال الرمز.",
  "That code is not correct.": "الرمز غير صحيح.",
  "That code has expired. Start again to get a new one.":
    "انتهت صلاحية الرمز. ابدأ من جديد للحصول على رمز آخر.",
  "Verification is not configured on this deployment.": "التحقق غير مهيّأ في هذا الموقع.",
  "Email verification is temporarily unavailable. Please contact the organisers.":
    "التحقق بالبريد غير متاح مؤقتًا. يرجى التواصل مع المنظّمين.",
  "Too many requests. Please wait a moment and try again.":
    "طلبات كثيرة جدًا. انتظر قليلًا ثم حاول مرة أخرى.",
  "Too many attempts. Please wait a moment and try again.":
    "محاولات كثيرة جدًا. انتظر قليلًا ثم حاول مرة أخرى.",
  "One of your members is already registered with another team":
    "أحد اللاعبين مسجَّل مسبقًا في فريق آخر",
  "The team name is already taken": "اسم الفريق مستخدم مسبقًا",
};

/** Messages assembled from a template, matched by shape. */
const MESSAGE_PATTERNS_AR: { pattern: RegExp; build: (match: RegExpMatchArray) => string }[] = [
  {
    pattern: /^A roster may have at most (\d+) members$/,
    build: (m) => `يمكن أن تضم القائمة ${arabicNumber(m[1])} أعضاء كحد أقصى`,
  },
  {
    pattern: /^We have already sent several codes for this registration\. Please wait (\d+) minutes, then try again\.$/,
    build: (m) =>
      `أرسلنا عدة رموز لهذا التسجيل. يُرجى الانتظار ${arabicNumber(m[1])} دقيقة ثم المحاولة مرة أخرى.`,
  },
  {
    pattern: /^Team name must be at least (\d+) characters$/,
    build: (m) => `يجب ألا يقل اسم الفريق عن ${arabicNumber(m[1])} حروف`,
  },
  {
    pattern: /^Team name must be (\d+) characters or fewer$/,
    build: (m) => `يجب ألا يزيد اسم الفريق عن ${arabicNumber(m[1])} حرفًا`,
  },
  {
    pattern: /^Team name needs at least (\d+) letters$/,
    build: (m) => `يجب أن يحتوي اسم الفريق على ${arabicNumber(m[1])} حروف على الأقل`,
  },
  {
    pattern: /^(.+) is not offered in the (male|female) section$/,
    build: (m) => `${m[1]} غير متاحة في ${m[2] === "female" ? "قسم الطالبات" : "قسم الطلاب"}`,
  },
  {
    pattern: /^A roster can hold at most (\d+) people$/,
    build: (m) => `يمكن أن تضم القائمة ${arabicNumber(m[1])} أشخاص كحد أقصى`,
  },
  {
    pattern: /^Roster may hold at most (\d+) people$/,
    build: (m) => `يمكن أن تضم القائمة ${arabicNumber(m[1])} أشخاص كحد أقصى`,
  },
  {
    pattern: /^(.+) fields exactly (\d+) starters — (\d+) are marked as starters$/,
    build: (m) =>
      `${m[1]} يتطلب ${arabicNumber(m[2])} أساسي بالضبط — والمعلَّم كأساسي ${arabicNumber(m[3])}`,
  },
  {
    pattern: /^(.+) fields (\d+) starters — add (\d+) more$/,
    build: (m) =>
      `${m[1]} يتطلب ${arabicNumber(m[2])} أساسي — أضف ${arabicNumber(m[3])} أخرى`,
  },
  {
    pattern: /^At most (\d+) substitutes? allowed$/,
    build: (m) => `يُسمح بـ${arabicNumber(m[1])} احتياطي كحد أقصى`,
  },
  {
    pattern: /^At most (\d+) coaches? allowed$/,
    build: (m) => `يُسمح بـ${arabicNumber(m[1])} مدرّب كحد أقصى`,
  },
  {
    pattern: /^Already used by member (\d+)$/,
    build: (m) => `مستخدم مسبقًا من اللاعب ${arabicNumber(m[1])}`,
  },
  {
    pattern: /^Member (\d+) and member (\d+) have the same name — check you have not listed the same person twice$/,
    build: (m) =>
      `اللاعب ${arabicNumber(m[1])} واللاعب ${arabicNumber(m[2])} بالاسم نفسه — تأكّد أنك لم تدرج الشخص نفسه مرتين`,
  },
  {
    pattern: /^Universities in (.+) are not open for this tournament $/,
    build: (m) => `جامعات ${m[1]} غير متاحة لهذه البطولة`,
  },
  {
    pattern: /^(.+) is not a (.+) address \(expected (.+)\)$/,
    build: (m) => `${m[1]} ليس بريدًا لـ${m[2]} (المتوقع ${m[3]})`,
  },
  {
    pattern: /^Member (\d+)'s name contains mild .+ \((\d+) words?\)\. It will be registered as typed — please review it before the bracket is published\.$/,
    build: (m) =>
      `اسم اللاعب ${arabicNumber(m[1])} يحتوي على ألفاظ خفيفة (${arabicNumber(m[2])}). سيُسجَّل كما هو — يرجى مراجعته قبل نشر الجدول.`,
  },
  {
    pattern: /^The team name contains mild .+ \(\d+ words?\)\. It will be registered as typed — please review it before the bracket is published\.$/,
    build: () =>
      "اسم الفريق يحتوي على ألفاظ خفيفة. سيُسجَّل كما هو — يرجى مراجعته قبل نشر الجدول.",
  },
  {
    pattern:
      /^We have already sent several codes to (.+)\. Please wait (\d+) minutes, then try again\.$/,
    build: (m) =>
      `أرسلنا عدة رموز بالفعل إلى ${m[1]}. انتظر ${arabicNumber(m[2])} دقيقة ثم حاول مرة أخرى.`,
  },
  {
    pattern: /^That code is not correct\. (\d+) attempts? left\.$/,
    build: (m) => `الرمز غير صحيح. تبقّت ${arabicNumber(m[1])} محاولات.`,
  },
  {
    pattern:
      /^We found (.+), but our email provider refused to send the code to (.+)\. This is a problem with our sending account, not with your reference code\.$/,
    build: (m) =>
      `وجدنا ${m[1] === "your registration" ? "تسجيلك" : m[1]}، لكن مزوّد البريد رفض إرسال الرمز إلى ${m[2]}. المشكلة في حساب الإرسال لدينا، لا في رقم التسجيل.`,
  },
  {
    pattern: /^We found (.+), but could not reach the email service to send the code to (.+)\.$/,
    build: (m) =>
      `وجدنا ${m[1] === "your registration" ? "تسجيلك" : m[1]}، لكن تعذّر الوصول إلى خدمة البريد لإرسال الرمز إلى ${m[2]}.`,
  },
  {
    pattern: /^The team name “(.+)” is already taken$/,
    build: (m) => `اسم الفريق «${m[1]}» مستخدم مسبقًا`,
  },
];

/** Western digits to Arabic-Indic, so numbers read naturally in Arabic text. */
function arabicNumber(value: string): string {
  const digits = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/\d/g, (d) => digits[Number(d)]);
}

/**
 * Translate a validation message produced in English.
 *
 * Falls back to the original when there is no translation. That is intentional:
 * an English sentence is a blemish, whereas an empty error leaves someone unable to
 * register with no idea why, and no way to find out.
 */
export function translateMessage(message: string, language: Language): string {
  if (language === "en" || !message) return message;

  const exact = MESSAGE_AR[message];
  if (exact) return exact;

  for (const { pattern, build } of MESSAGE_PATTERNS_AR) {
    const match = message.match(pattern);
    if (match) return build(match);
  }

  return message;
}

/** Translate a whole error map. */
export function translateErrors(
  errors: Record<string, string>,
  language: Language,
): Record<string, string> {
  if (language === "en") return errors;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) out[key] = translateMessage(value, language);
  return out;
}

/** Translate a list of messages, de-duplicated. */
export function translateList(messages: string[], language: Language): string[] {
  if (language === "en") return messages;
  return Array.from(new Set(messages.map((message) => translateMessage(message, language))));
}

/** Exposed for the test that checks every emitted message has a translation. */
export function hasArabicMessage(message: string): boolean {
  if (MESSAGE_AR[message]) return true;
  return MESSAGE_PATTERNS_AR.some(({ pattern }) => pattern.test(message));
}

/* ------------------------------------------------------------------ */
/* Step headings                                                       */
/* ------------------------------------------------------------------ */

/**
 * The wizard's step headings, in order.
 *
 * Exported as arrays rather than derived from `STEPS` so the titles and blurbs are
 * type-checked message keys. `STEPS` still owns the *order* and the field-to-step
 * mapping, which is validation's business; this only supplies the words.
 */
export const STEP_TITLE_KEYS = [
  "step.team.title",
  "step.game.title",
  "step.roster.title",
  "step.review.title",
] as const;

/** The message key for a roster role, so a role is never rendered untranslated. */
export function roleLabelKey(role: string): MessageKey {
  if (role === "SUBSTITUTE") return "roster.substitute";
  if (role === "COACH") return "roster.coach";
  return "roster.starter";
}

/**
 * The Arabic for a sponsor's role line, when the role is one of the usual tiers.
 *
 * Sponsor roles are free text — the organisers type whatever their agreement calls the
 * tier — so this cannot translate everything, and it should not pretend to. It maps the
 * tiers that actually appear on Saudi sponsorship boards, and **returns the English
 * unchanged for anything it does not recognise**, which is the honest failure: an
 * organiser who invents "Regional Activation Partner" sees their own words rather than a
 * wrong translation or a blank.
 *
 * Matching ignores case, surrounding space and repeated spaces, so "Platinum  sponsor"
 * still translates. Both the English and the Arabic of each entry are keys, so a role
 * already written in Arabic round-trips unchanged.
 */
const SPONSOR_ROLE_AR: Record<string, string> = {
  "diamond sponsor": "راعٍ ماسي",
  "platinum sponsor": "راعٍ بلاتيني",
  "gold sponsor": "راعٍ ذهبي",
  "silver sponsor": "راعٍ فضي",
  "bronze sponsor": "راعٍ برونزي",
  "strategic sponsor": "راعٍ استراتيجي",
  "strategic partner": "شريك استراتيجي",
  "official sponsor": "الراعي الرسمي",
  "official partner": "الشريك الرسمي",
  "official bank": "البنك الرسمي",
  "official telecom": "الاتصالات الرسمية",
  "official payment partner": "شريك الدفع الرسمي",
  "official airline": "الناقل الرسمي",
  "official beverage": "المشروب الرسمي",
  "technology partner": "شريك تقني",
  "technical partner": "شريك تقني",
  "media partner": "شريك إعلامي",
  "community partner": "شريك مجتمعي",
  "education partner": "شريك تعليمي",
  "title sponsor": "الراعي الرئيسي",
  "main sponsor": "الراعي الرئيسي",
  "principal sponsor": "الراعي الرئيسي",
  "host sponsor": "الراعي المستضيف",
  "media sponsor": "راعٍ إعلامي",
  "supporting sponsor": "راعٍ داعم",
  "partner": "شريك",
  "sponsor": "راعٍ",
};

export function sponsorRoleLabel(role: string, language: Language): string {
  if (language === "en" || !role.trim()) return role;
  const key = role.trim().toLowerCase().replace(/\s+/g, " ");
  return SPONSOR_ROLE_AR[key] ?? role;
}

export const STEP_BLURB_KEYS = [
  "step.team.blurb",
  "step.game.blurb",
  "step.roster.blurb",
  "step.review.blurb",
] as const;
