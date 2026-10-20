/**
 * The words that appear in emails, in both languages.
 *
 * Separate from `i18n.ts` because these are long-form documents, not interface
 * strings: a verification email has a subject, an intro, an expiry note and a
 * spam-folder hint, and a confirmation email has a dozen field labels plus two
 * paragraphs of prose. Keeping them together here means the translation of an email
 * can be read end to end, which is the only way to notice that a sentence sounds
 * wrong — the thing a per-string dictionary makes impossible.
 *
 * Every template takes `{placeholders}`. `fill()` substitutes them.
 */

import type { Language } from "./i18n";

export interface EmailCopy {
  /* ------------------------------- codes ------------------------------- */
  subjectPlayer: string;
  subjectEdit: string;
  subjectStaff: string;
  subjectAdmin: string;
  codeIntroPlayer: string;
  codeIntroEdit: string;
  codeIntroStaff: string;
  codeIntroAdmin: string;
  codeHeading: string;
  codeExpiry: string;
  codeTextTeam: string;
  codeTextCode: string;

  /* --------------------------- confirmation ---------------------------- */
  confirmed: string;
  confirmedLead: string;
  referenceLabel: string;
  referenceNote: string;
  fieldGame: string;
  fieldDivision: string;
  fieldRoster: string;
  fieldSubmitted: string;
  rosterHeading: string;
  membersOne: string;
  membersMany: string;
  startersOne: string;
  startersMany: string;
  subsOne: string;
  subsMany: string;
  coachesOne: string;
  coachesMany: string;
  teamLeader: string;
  memberUniversity: string;
  memberEmail: string;
  memberStudentId: string;
  memberDiscord: string;
  memberPhone: string;
  roleStarter: string;
  roleSubstitute: string;
  roleCoach: string;
  divisionMale: string;
  divisionFemale: string;
  universitiesOne: string;
  universitiesMany: string;
  gameTagLabel: string;
  textHeadingConfirmed: string;
  textRecord: string;
  textReferenceCode: string;
  textGame: string;
  textDivision: string;
  textRoster: string;
  textSubmitted: string;
  textRosterHeading: string;
  textLeaderSuffix: string;
  textUniversity: string;
  textEmail: string;
  textGameTag: string;
  textStudentId: string;
  textDiscord: string;
  textPhone: string;
  textUniversitiesOne: string;
  textUniversitiesMany: string;
  nextOne: string;
  nextTwo: string;
  nextThree: string;
  textEditLabel: string;
  textRemovalNote: string;
  nextHeading: string;
  nextBody: string;
  nextEdit: string;
  editCta: string;
  openFrom: string;
  footer: string;
  subjectTeam: string;
  subjectConfirmed: string;
}

const EN: EmailCopy = {
  subjectPlayer: "Your KSU Crown verification code",
  subjectEdit: "Your KSU Crown edit code",
  subjectStaff: "Your KSU Crown organiser sign-in code",
  /* Worded so it stands apart from the staff code at a glance: this one is the second
     step of the grand admin's sign-in, and the wrong message being read in a hurry is
     how a code ends up typed into the wrong form. */
  subjectAdmin: "Your KSU Crown grand admin confirmation code",
  codeIntroPlayer:
    "Use this code to confirm this email address for your KSU Crown team registration.",
  codeIntroEdit: "Use this code to open your KSU Crown team registration for editing.",
  codeIntroStaff: "Use this code to sign in to the KSU Crown organiser console.",
  codeIntroAdmin:
    "Use this code to finish signing in as grand admin. Someone entered the grand admin secret, so this step confirms it was you.",
  codeHeading: "Verification code",
  codeExpiry:
    "The code expires in {minutes} minutes and can be used once. If you did not ask for it, you can ignore this email.",
  codeTextTeam: "Team: {team}",
  codeTextCode: "Code: {code}",

  confirmed: "Registration confirmed",
  confirmedLead:
    "Your entry for {tournament} has been received. Keep this email — it is your record of the squad you registered.",
  referenceLabel: "Your reference code",
  referenceNote:
    "Quote it in any message to the organisers, and use it to reopen your entry.",
  fieldGame: "Game",
  fieldDivision: "Division",
  fieldRoster: "Roster",
  fieldSubmitted: "Submitted",
  rosterHeading: "The roster",
  membersOne: "1 person",
  membersMany: "{count} people",
  startersOne: "1 starter",
  startersMany: "{count} starters",
  subsOne: "1 substitute",
  subsMany: "{count} substitutes",
  coachesOne: "1 coach",
  coachesMany: "{count} coaches",
  teamLeader: "Team leader",
  memberUniversity: "University",
  memberEmail: "Email",
  memberStudentId: "Student ID",
  memberDiscord: "Discord",
  memberPhone: "Phone",
  roleStarter: "Starter",
  roleSubstitute: "Substitute",
  roleCoach: "Coach",
  divisionMale: "Male",
  divisionFemale: "Female",
  universitiesOne: "University",
  universitiesMany: "Universities",
  gameTagLabel: "Game tag",
  textHeadingConfirmed: "REGISTRATION CONFIRMED",
  textRecord: "Your entry has been received. Keep this email as your record.",
  textReferenceCode: "REFERENCE CODE",
  textGame: "Game",
  textDivision: "Division",
  textRoster: "Roster",
  textSubmitted: "Submitted",
  textRosterHeading: "THE ROSTER",
  textLeaderSuffix: "(team leader)",
  textUniversity: "University",
  textEmail: "Email",
  textGameTag: "Game tag",
  textStudentId: "Student ID",
  textDiscord: "Discord",
  textPhone: "Phone",
  textUniversitiesOne: "UNIVERSITY",
  textUniversitiesMany: "UNIVERSITIES",
  nextOne: "We check every entry against the tournament rules and confirm your roster.",
  nextTwo:
    "Match schedules and lobby details go to the team leader, {leader}, and to every member's Discord.",
  nextThree: "Need a change? Reopen your entry with the reference code above.",
  textEditLabel: "Edit your registration",
  textRemovalNote:
    "If you did not submit this registration, reply to this email and we will remove it.",
  nextHeading: "What happens next",
  nextBody:
    "• We check every entry against the tournament rules and confirm your roster.\n• Match schedules and lobby details go to the team leader and to every member's Discord.\n• Need to change a name, swap a substitute or fix a contact detail? Reopen your entry with the reference code above.",
  nextEdit: "Reopen your entry with the reference code above.",
  editCta: "Edit your registration",
  openFrom: "Or open it from {host}",
  footer:
    "This message was sent because someone submitted a team registration with this address as the team leader's contact. If that was not you, reply to this email and we will remove it.",
  subjectTeam: "{team} — registration confirmed",
  subjectConfirmed: "Registration confirmed",
};

const AR: EmailCopy = {
  subjectPlayer: "رمز التحقق الخاص بك في KSU Crown",
  subjectEdit: "رمز تعديل التسجيل في KSU Crown",
  subjectStaff: "رمز دخول المنظّمين في KSU Crown",
  subjectAdmin: "رمز تأكيد دخول المدير العام في KSU Crown",
  codeIntroPlayer: "استخدم هذا الرمز لتأكيد هذا البريد الإلكتروني في تسجيل فريقك في KSU Crown.",
  codeIntroEdit: "استخدم هذا الرمز لفتح تسجيل فريقك في KSU Crown للتعديل.",
  codeIntroStaff: "استخدم هذا الرمز للدخول إلى لوحة المنظّمين في KSU Crown.",
  codeIntroAdmin:
    "استخدم هذا الرمز لإكمال الدخول كمدير عام. أدخل أحدهم رمز المدير العام، وهذه الخطوة تؤكّد أنك أنت من فعل ذلك.",
  codeHeading: "رمز التحقق",
  codeExpiry:
    "تنتهي صلاحية الرمز خلال {minutes} دقيقة، ويُستخدم مرة واحدة. وإن لم تطلب هذا الرمز فيمكنك تجاهل هذه الرسالة.",
  codeTextTeam: "الفريق: {team}",
  codeTextCode: "الرمز: {code}",

  confirmed: "تم تأكيد التسجيل",
  confirmedLead:
    "استلمنا تسجيلك في {tournament}. احتفظ بهذه الرسالة — فهي سجلك للقائمة التي سجّلتها.",
  referenceLabel: "رقم التسجيل الخاص بك",
  referenceNote: "اذكره في أي رسالة إلى المنظّمين، واستخدمه لإعادة فتح تسجيلك.",
  fieldGame: "اللعبة",
  fieldDivision: "الجنس",
  fieldRoster: "القائمة",
  fieldSubmitted: "وقت الإرسال",
  rosterHeading: "قائمة اللاعبين",
  membersOne: "شخص واحد",
  membersMany: "{count} أشخاص",
  startersOne: "أساسي واحد",
  startersMany: "{count} أساسيين",
  subsOne: "احتياطي واحد",
  subsMany: "{count} احتياطيين",
  coachesOne: "مدرّب واحد",
  coachesMany: "{count} مدرّبين",
  teamLeader: "قائد الفريق",
  memberUniversity: "الجامعة",
  memberEmail: "البريد",
  memberStudentId: "الرقم الجامعي",
  memberDiscord: "ديسكورد",
  memberPhone: "الجوال",
  roleStarter: "أساسي",
  roleSubstitute: "احتياطي",
  roleCoach: "مدرّب",
  divisionMale: "ذكور",
  divisionFemale: "إناث",
  universitiesOne: "الجامعة",
  universitiesMany: "الجامعات",
  gameTagLabel: "المعرّف في اللعبة",
  textHeadingConfirmed: "تم تأكيد التسجيل",
  textRecord: "استلمنا تسجيلك. احتفظ بهذه الرسالة كسجل لك.",
  textReferenceCode: "رقم التسجيل",
  textGame: "اللعبة",
  textDivision: "الجنس",
  textRoster: "القائمة",
  textSubmitted: "وقت الإرسال",
  textRosterHeading: "قائمة اللاعبين",
  textLeaderSuffix: "(قائد الفريق)",
  textUniversity: "الجامعة",
  textEmail: "البريد",
  textGameTag: "المعرّف في اللعبة",
  textStudentId: "الرقم الجامعي",
  textDiscord: "ديسكورد",
  textPhone: "الجوال",
  textUniversitiesOne: "الجامعة",
  textUniversitiesMany: "الجامعات",
  nextOne: "نراجع كل تسجيل وفق أنظمة البطولة ونؤكّد قائمتك.",
  nextTwo:
    "تُرسل مواعيد المباريات وبيانات الغرف إلى قائد الفريق {leader} وإلى حساب ديسكورد لكل لاعب.",
  nextThree: "هل تحتاج إلى تغيير؟ أعد فتح تسجيلك برقم التسجيل أعلاه.",
  textEditLabel: "تعديل تسجيلي",
  textRemovalNote: "إن لم تكن أنت من أرسل هذا التسجيل، فردّ على هذه الرسالة.",
  nextHeading: "ما الخطوة التالية",
  nextBody:
    "• نراجع كل تسجيل وفق أنظمة البطولة ونؤكّد قائمتك.\n• تُرسل مواعيد المباريات وبيانات الغرف إلى قائد الفريق وإلى حساب ديسكورد لكل لاعب.\n• هل تحتاج إلى تغيير اسم أو تبديل احتياطي أو تصحيح بيانات تواصل؟ أعد فتح تسجيلك برقم التسجيل أعلاه.",
  nextEdit: "أعد فتح تسجيلك برقم التسجيل أعلاه.",
  editCta: "تعديل تسجيلي",
  openFrom: "أو افتحه من {host}",
  footer:
    "وصلتك هذه الرسالة لأن شخصًا أرسل تسجيل فريق بهذا البريد كبيان تواصل لقائد الفريق. وإن لم تكن أنت، فردّ على هذه الرسالة.",
  subjectTeam: "{team} — تم تأكيد التسجيل",
  subjectConfirmed: "تم تأكيد التسجيل",
};

const COPY: Record<Language, EmailCopy> = { en: EN, ar: AR };

/** The copy for one language. */
export function emailCopy(language: Language): EmailCopy {
  return COPY[language] ?? EN;
}

/** Substitute `{name}` placeholders, leaving unknown ones visible rather than blank. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] === undefined ? whole : String(vars[name]),
  );
}

/**
 * The `dir` and alignment for a language, for the email's own body.
 *
 * Mail clients do not inherit the page's direction, so each message states it. The
 * classes that matter are the ones a client honours without a stylesheet — `dir` and
 * `align` — which is why the templates carry both.
 */
export function emailDirection(language: Language): "rtl" | "ltr" {
  return language === "ar" ? "rtl" : "ltr";
}
