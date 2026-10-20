/**
 * Content moderation for user-submitted names.
 *
 * Three separate concerns live here:
 *
 * 1. **Character rules.** A team name must look like a name. Left unchecked, "9"
 *    or "!!!" or a wall of emoji is accepted, which makes a bracket unreadable.
 * 2. **Language rules.** Slurs and abuse in a team name appear on a public
 *    bracket and reflect on the competition, so they are refused at entry rather
 *    than discovered later.
 * 3. **Evasion.** People disguise words. A filter that only compares exact strings
 *    catches none of `sh1t`, `$hit`, `s.h.i.t`, `s h i t` or `shiiit`.
 *
 * ## Why matching is deliberately conservative
 *
 * Naive substring matching produces the *Scunthorpe problem*: a legitimate name
 * containing a blocked sequence is rejected, and the person affected cannot tell
 * why. So matching works on **whole words** after normalisation. This is not
 * theoretical — an earlier version squashed the whole string together and so
 * refused `Scunthorpe` and `Dickens`, which, since the same check runs against
 * every member's name, meant any student called Dickenson was turned away.
 *
 * Every rule here is tuned so a false negative (a rude name slips through) costs
 * less than a false positive (a real student is refused). A slipped name is caught
 * by an organiser, who can also add terms themselves. A refused student may never
 * come back.
 *
 * ## Severity, and what this application does with it
 *
 * Terms carry a category and a severity. `moderate()` maps severity onto the
 * standard three-way action — `ALLOW`, `MASK`, `BLOCK` — so the engine is
 * reusable. The registration form then refuses anything that is not `ALLOW`,
 * because there is no such thing as a partly-censored team name: `Team f***` is
 * not a name anyone can register. `MASK` still earns its place: it is the right
 * answer for free-text fields (an organiser's note, a requirement label) should any
 * be added, and it produces the sanitised rendering used in logs.
 */

export type ModerationCategory =
  | "PROFANITY"
  | "SEXUAL"
  | "HATE_SPEECH"
  | "INSULT"
  | "SELF_HARM"
  | "BLASPHEMY";

export type ModerationSeverity = "LOW" | "MEDIUM" | "HIGH";

export type ModerationAction = "ALLOW" | "MASK" | "BLOCK";

export interface Violation {
  /** The token as it appeared in the input, not the list entry. */
  word: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
}

export interface ModerationResult {
  is_flagged: boolean;
  action: ModerationAction;
  violations: Violation[];
  /** The input with detected terms replaced by asterisks. */
  sanitized_text: string;
}

/* ------------------------------------------------------------------ */
/* Term list                                                          */
/* ------------------------------------------------------------------ */

interface TermGroup {
  category: ModerationCategory;
  severity: ModerationSeverity;
  terms: readonly string[];
}

/**
 * The terms, grouped so each category's severity is stated once.
 *
 * Notes on what is deliberately *not* here:
 *
 * - Nothing that commonly appears inside a real word. Whole-word matching makes
 *   short words like `ass` safe, but `tit`, `nip` and `fag` are left out or scoped
 *   carefully for the same reason.
 * - Latin transliterations of Arabic abuse are kept to the handful that cannot be
 *   mistaken for a person's name. Transliteration has a far higher false-positive
 *   rate than script does, and refusing someone genuinely called Ghabi would be
 *   worse than missing a transliterated insult.
 * - **Arabic religious abuse is not enumerated.** Getting that list wrong is worse
 *   than not shipping it, and it is deeply context-dependent. The `BLASPHEMY`
 *   category exists and organisers can add terms from the console, which is the
 *   right place for that judgement.
 */
const TERM_GROUPS: readonly TermGroup[] = [
  /* ---------------- PROFANITY ---------------- */
  {
    category: "PROFANITY",
    severity: "MEDIUM",
    terms: [
      "fuck", "fucking", "fucked", "fucker", "motherfucker", "motherfucking",
      "clusterfuck", "shit", "shitty", "bullshit", "horseshit",
      "bitch", "bitches", "bastard", "asshole", "arsehole", "dickhead",
      "dumbass", "jackass", "prick", "twat", "wanker", "bollocks",
      "gobshite", "cunt",
    ],
  },
  {
    category: "PROFANITY",
    severity: "LOW",
    terms: [
      "crap", "crappy", "damn", "damned", "goddammit", "piss", "pissed",
      "arse", "ass", "asses", "sod", "bugger", "bollock",
    ],
  },

  /* ---------------- SEXUAL ---------------- */
  {
    category: "SEXUAL",
    severity: "HIGH",
    terms: [
      "porn", "porno", "pornography", "rape", "rapist", "paedophile",
      "pedophile", "pedo", "bestiality",
    ],
  },
  {
    category: "SEXUAL",
    severity: "MEDIUM",
    terms: [
      "sex", "sexual", "sexy", "nude", "nudes", "naked", "blowjob",
      "handjob", "dildo", "penis", "vagina", "boobs", "tits", "orgasm",
      "masturbate", "masturbation", "horny", "cumshot", "hentai",
    ],
  },

  /* ---------------- HATE SPEECH ---------------- */
  /* Refused outright. There is no legitimate team name containing these, and the
     cost of a false positive here is far lower than the cost of appearing to
     tolerate them. */
  {
    category: "HATE_SPEECH",
    severity: "HIGH",
    terms: [
      "nigger", "nigga", "niggas", "niggaz",
      "fag", "fags", "faggot", "faggots",
      "kike", "spic", "spick", "chink", "wetback", "gook", "coon",
      "tranny", "shemale", "dyke", "paki", "raghead", "towelhead",
      "nazi", "neo-nazi", "skinhead", "white power",
    ],
  },

  /* ---------------- INSULT ---------------- */
  /* Targeted slurs are refused. Generic name-calling is a warning: it is rude but
     it is not hate, and refusing "Team Idiots" would be heavy-handed. */
  {
    category: "INSULT",
    severity: "HIGH",
    terms: ["retard", "retards", "retarded", "mongoloid", "whore", "slut", "sluts", "skank"],
  },
  {
    category: "INSULT",
    severity: "LOW",
    terms: [
      "idiot", "idiotic", "stupid", "moron", "moronic", "imbecile", "dumb",
      "loser", "losers", "pathetic", "worthless", "trash", "scum", "creep",
    ],
  },

  /* ---------------- SELF-HARM ---------------- */
  /* The one category where being wrong is genuinely harmful, so it blocks and the
     wording stays calm rather than accusatory. */
  {
    category: "SELF_HARM",
    severity: "HIGH",
    terms: [
      "kys", "kms", "kill yourself", "kill urself", "kill ur self",
      "kill myself", "kill himself", "kill herself", "end yourself",
      "hang yourself", "cut yourself", "self harm", "selfharm", "suicide",
      "suicidal", "go die", "die in a fire",
    ],
  },

  /* ---------------- BLASPHEMY ---------------- */
  {
    category: "BLASPHEMY",
    severity: "LOW",
    terms: ["goddamn", "goddamned", "god damn"],
  },

  /* ---------------- Arabic, in script ---------------- */
  /* Written the way people actually type them. Harakat and tatweel are stripped
     while folding, so padded spellings cannot evade these. */
  {
    category: "PROFANITY",
    severity: "HIGH",
    terms: ["كس", "طيز", "زب", "نيك", "منيوك", "قحبة", "شرموط", "شرموطة", "عرص", "خول", "ديوث"],
  },
  {
    category: "INSULT",
    severity: "MEDIUM",
    terms: [
      "كلب", "كلبة", "خنزير", "حقير", "حمار", "غبي", "غبية", "تافه",
      "زبالة", "قذر", "وسخ", "حثالة",
    ],
  },

  /* ---------------- Franco-Arab ---------------- */
  {
    category: "PROFANITY",
    severity: "HIGH",
    terms: ["kosomak", "kussomak", "sharmouta", "sharmota", "zebi", "teez", "manyak", "manyouk"],
  },
];

interface TermEntry {
  term: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
}

/** Every term, flattened, with the category and severity that apply to it. */
const TERMS: readonly TermEntry[] = TERM_GROUPS.flatMap((group) =>
  group.terms.map((term) => ({ term, category: group.category, severity: group.severity })),
);

/**
 * The plain list of refused terms, for callers that only need the words.
 *
 * Derived rather than maintained separately, so the console's help text and this
 * engine can never disagree about what is already covered.
 */
export const DEFAULT_BLOCKED_TERMS: readonly string[] = TERMS.map((entry) => entry.term);

/** Severities that refuse a value. `LOW` only warns — see the header. */
const BLOCKING: readonly ModerationSeverity[] = ["MEDIUM", "HIGH"];

/**
 * The shortest folded needle that may be matched.
 *
 * Three. A term that folds shorter than this can only be a letter or two, and
 * matching one is guaranteed to misfire on real names — `xxx` used to be on the
 * list and folded to `x`, so a team called "X-Force" was refused as sexual
 * content. The guard is a backstop against that class of mistake returning with a
 * future addition, not just a fix for that one entry.
 */
const MIN_NEEDLE = 3;

/* ------------------------------------------------------------------ */
/* Normalisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Substitutions used to disguise a word, mapped back to the intended letter.
 *
 * Includes the Arabic-Indic digits, because `ف٤ك` is the same trick in another
 * script and would otherwise sail past a Latin-only map.
 */
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s",
  "6": "g", "7": "t", "8": "b", "9": "g",
  "٠": "o", "١": "i", "٢": "z", "٣": "e", "٤": "a", "٥": "s",
  "٦": "g", "٧": "t", "٨": "b", "٩": "g",
  "£": "l", "€": "e",
};

/**
 * Symbols that could be a substituted letter **or** just punctuation.
 *
 * `!` in `sh!t` stands for an `i`. `!` in `SHIT!!!` is decoration. The two are
 * indistinguishable from the character alone, so the text is folded **twice** —
 * once reading these as letters, once reading them as separators — and a term
 * matches if it appears in either. That union is what lets both spellings be
 * caught without a single rule having to be clever enough to tell them apart.
 */
const AMBIGUOUS: Record<string, string> = {
  "!": "i", "|": "i", "@": "a", "$": "s", "+": "t",
};

/**
 * A letter that was replaced by a placeholder — `f*ck`, `sh*t`.
 *
 * Kept as a distinct marker inside the token rather than turned into a space, so
 * the token stays one word and the missing letter can be accounted for when
 * matching. Collapsing it to a separator would lose the fact that a letter was
 * removed at all.
 */
const ELISION = "\u0001";

/** Characters people use to stand in for a letter they are avoiding. */
const ELISION_CHARS = /[*^~°•·]/g;

/**
 * Characters from other scripts that render identically to Latin ones.
 *
 * Swapping a Cyrillic `а` for a Latin `a` is a well-known bypass: different code
 * points, identical on screen. Only genuine lookalikes are listed — mapping a
 * letter onto something it does not resemble would corrupt real text and invent
 * false positives.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  "а": "a", "е": "e", "о": "o", "с": "c", "р": "p", "х": "x", "у": "y",
  "ѕ": "s", "і": "i", "ј": "j", "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  // Greek
  "α": "a", "ε": "e", "ο": "o", "ρ": "p", "ν": "v", "τ": "t", "κ": "k",
  "χ": "x", "ι": "i", "ϲ": "c", "ϳ": "j",
};

/** Invisible characters, used to split a word without changing how it reads. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g;

/** Arabic diacritics and the stretching mark, which pad a word invisibly. */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/**
 * Fold a string down to the form abuse is actually compared in.
 *
 * In order: strip invisible characters, mark elisions, lower-case, strip accents,
 * unify Arabic letter variants and remove its diacritics, map lookalike scripts,
 * map substitutions, then keep only letters — everything else becoming a space, so
 * `s.h.i.t` separates into four tokens. Runs of three or more identical letters
 * collapse (`shiiit` → `shit`) while ordinary doubles are left alone, so `sheet`
 * does not become `shit`.
 *
 * `ambiguousAsLetters` picks the reading for symbols that could be either, which
 * is why this is called twice per string — see `AMBIGUOUS`.
 */
function foldWith(raw: string, ambiguousAsLetters: boolean): string {
  let value = raw
    .replace(INVISIBLE, "")
    .replace(ELISION_CHARS, ELISION)
    .toLowerCase();

  try {
    // "fück" → "fuck".
    value = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // Older engines: carry on with the un-normalised form.
  }

  /* Arabic padding. The stretching mark and the vowel marks are invisible in
     intent — كـس reads as كس — so removing them is what stops that evasion. The
     letter variants are the same idea: أ إ آ ا are one letter to a reader, and so
     are ة/ه and ى/ي. */
  value = value
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/[\u0624\u0626]/g, "\u0648");

  let mapped = "";
  for (const character of value) {
    if (character === ELISION) {
      mapped += ELISION;
      continue;
    }

    const confusable = CONFUSABLES[character];
    if (confusable !== undefined) {
      mapped += confusable;
      continue;
    }

    const leet = LEET[character];
    if (leet !== undefined) {
      mapped += leet;
      continue;
    }

    const ambiguous = AMBIGUOUS[character];
    if (ambiguous !== undefined) {
      mapped += ambiguousAsLetters ? ambiguous : " ";
      continue;
    }

    mapped += /\p{L}/u.test(character) ? character : " ";
  }

  return mapped
    .replace(/(.)\1{2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The folded form, with ambiguous symbols read as letters.
 *
 * Exported because it is the single definition of "the same word" for the filter,
 * its tests, and the admin console's explanations — two implementations would
 * drift apart.
 */
export function foldForMatching(raw: string): string {
  return foldWith(raw, true);
}

/** Fold a list entry. Terms are plain words, so both readings agree. */
function foldPhrase(term: string): string {
  return foldWith(term, true);
}

/**
 * Remove every elision marker from a token, and say how many were removed.
 *
 * The count is the number of letters the writer dropped, which is how much
 * latitude the comparison is allowed: `f*ck` lost one letter, `f**k` lost two.
 */
function withoutElisions(token: string): { text: string; dropped: number } {
  let dropped = 0;
  let text = "";
  for (const character of token) {
    if (character === ELISION) dropped += 1;
    else text += character;
  }
  return { text, dropped };
}

/**
 * Whether `candidate` is `needle` with exactly `dropped` characters removed.
 *
 * This is what recovers `f*ck`. It is deliberately not a general fuzzy match:
 * allowing one arbitrary deletion everywhere would make `sit` a match for `shit`,
 * and `Team Sit` would be refused. It only ever runs for a token that actually
 * contained a placeholder, so the writing has announced that a letter is missing.
 */
function matchesWithGaps(candidate: string, needle: string, dropped: number): boolean {
  if (candidate === needle) return true;
  if (dropped <= 0 || candidate.length >= needle.length) return false;
  if (needle.length - candidate.length !== dropped) return false;

  /* Walk both strings; every mismatch consumes one omission. */
  let omissions = 0;
  let i = 0;
  let j = 0;
  while (i < needle.length && j < candidate.length) {
    if (needle[i] === candidate[j]) {
      i += 1;
      j += 1;
      continue;
    }
    omissions += 1;
    if (omissions > dropped) return false;
    i += 1;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* Matching                                                           */
/* ------------------------------------------------------------------ */

/**
 * Join back any run of single-character tokens.
 *
 * This catches a word spaced or dotted out to dodge the filter: "s h i t" and
 * "s.h.i.t" both fold to four one-letter tokens, and rejoining gives "shit".
 *
 * Only runs of *single* characters are joined, and that restriction is the whole
 * point. Squashing the entire folded string finds blocked words buried inside
 * innocent ones — the bug that refused `Scunthorpe` and `Dickens`.
 */
function rejoinedLetterRuns(tokens: string[]): string[] {
  const runs: string[] = [];
  let run = "";

  for (const token of tokens) {
    if (token.length === 1) {
      run += token;
    } else {
      if (run) runs.push(run);
      run = "";
    }
  }
  if (run) runs.push(run);

  return runs;
}

/**
 * The word forms a single-word term should match.
 *
 * Plurals matter more than they look: without this, `Team Nazis` was accepted
 * because the list holds `nazi` and the token was `nazis` — whole-word matching is
 * strict, so a trailing `s` was enough to slip a slur past. Only the simplest
 * English forms are handled; anything more clever starts inventing false positives,
 * and an organiser can add exact spellings from the console.
 */
function wordForms(needle: string): string[] {
  const forms = [needle, `${needle}s`];
  /* A term listed in the plural should also match the singular. */
  if (needle.endsWith("s") && needle.length > 3) forms.push(needle.slice(0, -1));
  return forms;
}

interface Match {
  entry: TermEntry;
  /** The folded text the match came from — a token, a run, or a phrase. */
  folded: string;
}

/** One reading of the text, ready to be searched. */
interface Reading {
  tokens: string[];
  tokenSet: Set<string>;
  runs: string[];
}

function readTokens(folded: string): Reading {
  const tokens = folded.split(" ").filter(Boolean);
  return {
    tokens,
    tokenSet: new Set(tokens),
    runs: rejoinedLetterRuns(tokens),
  };
}

/** Every term the text contains, with where each was found. */
function findMatches(raw: string, extraTerms: readonly string[]): Match[] {
  /* Both readings of the same text: symbols as letters (`sh!t`), and symbols as
     punctuation (`SHIT!!!`). A term matching in either counts, which is what lets
     both spellings be caught without one rule having to guess which was meant. */
  const readings = [readTokens(foldWith(raw, true)), readTokens(foldWith(raw, false))];

  const extra: TermEntry[] = extraTerms.map((term) => ({
    term,
    category: "PROFANITY",
    /* Organiser-added terms are theirs to judge, so they block rather than warn. */
    severity: "MEDIUM",
  }));

  const found: Match[] = [];

  for (const entry of [...TERMS, ...extra]) {
    const needle = foldPhrase(entry.term);
    /* A needle this short cannot be matched safely — see MIN_NEEDLE. Checked here
       rather than at the point of use so every path is covered by one guard. */
    if (needle.replace(/\s+/g, "").length < MIN_NEEDLE) continue;

    const isPhrase = needle.includes(" ");
    const parts = isPhrase ? needle.split(" ") : [];
    let matched = false;

    for (const reading of readings) {
      if (matched) break;

      /* A phrase — "kill yourself" — matches a contiguous window of tokens. */
      if (isPhrase) {
        for (let i = 0; i + parts.length <= reading.tokens.length; i += 1) {
          if (parts.every((part, offset) => reading.tokens[i + offset] === part)) {
            found.push({ entry, folded: parts.join(" ") });
            matched = true;
            break;
          }
        }
        continue;
      }

      /* A single word, as itself or as its plural. */
      const form = wordForms(needle).find((candidate) => reading.tokenSet.has(candidate));
      if (form) {
        found.push({ entry, folded: form });
        matched = true;
        continue;
      }

      /* A word with a letter cut out of it — `f*ck`, `sh*t`. Only ever considered
         for a token that actually carried a placeholder, and only for terms long
         enough that a missing letter is still unambiguous. */
      if (needle.length >= 4) {
        for (const token of reading.tokens) {
          if (!token.includes(ELISION)) continue;
          const { text, dropped } = withoutElisions(token);
          if (matchesWithGaps(text, needle, dropped)) {
            found.push({ entry, folded: text });
            matched = true;
            break;
          }
        }
      }

      /* Or spelled out one letter at a time: "s h i t", "k m s". Three characters
         is the floor — a two-letter run is as likely to be initials, and `kys` is
         itself only three. */
      if (!matched && needle.length >= 3) {
        const run = reading.runs.find((candidate) => candidate.includes(needle));
        if (run) {
          found.push({ entry, folded: run });
          matched = true;
        }
      }
    }
  }

  return found;
}

/**
 * The blocked term a string contains, or `null`.
 *
 * Retained for callers and tests that only need a yes/no. `moderate()` gives the
 * full picture.
 */
export function findBlockedTerm(raw: string, extraTerms: readonly string[] = []): string | null {
  const matches = findMatches(raw, extraTerms);
  return matches.length === 0 ? null : matches[0].entry.term;
}

/**
 * Recover the original spelling of a matched token.
 *
 * A violation should name what the person actually typed — `Sh1t`, not the list's
 * `shit` — because that is what an organiser reads in a log.
 */
function originalTokenFor(raw: string, folded: string): string {
  const target = folded.replace(/\s+/g, "");
  for (const token of raw.split(/[\s._\-|!@#$*]+/)) {
    if (!token) continue;
    if (foldForMatching(token).replace(/\s+/g, "") === target) return token;
  }
  return folded;
}

/** Escape a string for use inside a regular expression. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every character that folds to a given letter — the letter and its disguises. */
function disguisesFor(letter: string): string[] {
  const found = [letter];
  for (const [character, mapped] of Object.entries(LEET)) if (mapped === letter) found.push(character);
  for (const [character, mapped] of Object.entries(AMBIGUOUS)) if (mapped === letter) found.push(character);
  for (const [character, mapped] of Object.entries(CONFUSABLES)) if (mapped === letter) found.push(character);
  return found;
}

/**
 * Replace occurrences of one term with asterisks.
 *
 * The pattern tolerates the same evasions the matcher does — substituted letters
 * (`sh1t`, `$hit`) and separators between them (`s.h.i.t`) — so a masked result
 * stays masked whatever trick was used. Building it from the plain term instead
 * was the bug that left `sh1t` unmasked while flagging it.
 *
 * The first character is kept, so the text stays readable and the length is
 * preserved.
 */
function maskTerm(text: string, term: string): string {
  const letters = [...term];
  const body = letters
    .map((letter, index) => {
      const class_ = disguisesFor(letter).map(escapeRegex).join("");
      /* Separators are allowed *between* letters — that is what catches `s.h.i.t`
         and `s h i t`. After the final letter only non-space separators may be
         swallowed, or the mask eats the space that belongs to the next word and
         turns "Team sh1t crows" into "Team s****crows". */
      const gap = index === letters.length - 1 ? "[._\\-|@#$*]*" : "[\\s._\\-|@#$*]*";
      return `[${class_}]+${gap}`;
    })
    .join("");

  return text.replace(new RegExp(body, "giu"), (match) =>
    `${match[0]}${"*".repeat(Math.max(0, match.length - 1))}`,
  );
}

/**
 * Inspect text and classify it.
 *
 * The full engine, returning the standard three-way action. `sanitized_text` is
 * always present, so a caller can record what was refused without reproducing it.
 */
export function moderate(raw: string, extraTerms: readonly string[] = []): ModerationResult {
  const matches = findMatches(raw, extraTerms);

  const violations: Violation[] = matches.map((match) => ({
    word: originalTokenFor(raw, match.folded),
    category: match.entry.category,
    severity: match.entry.severity,
  }));

  if (violations.length === 0) {
    return { is_flagged: false, action: "ALLOW", violations: [], sanitized_text: raw };
  }

  let sanitized = raw;
  for (const match of matches) sanitized = maskTerm(sanitized, match.entry.term);

  const blocking = violations.some((violation) => BLOCKING.includes(violation.severity));

  return {
    is_flagged: true,
    action: blocking ? "BLOCK" : "MASK",
    violations,
    sanitized_text: sanitized,
  };
}

/* ------------------------------------------------------------------ */
/* Wording                                                            */
/* ------------------------------------------------------------------ */

/**
 * How to describe a violation without repeating it.
 *
 * The message never echoes the term: the captain knows what they typed, and
 * putting a slur in an error on a public form just publishes it. Categories that
 * deserve a firmer sentence get one, and the self-harm case is phrased as concern
 * rather than accusation, because it may not be a joke.
 */
function describeViolation(
  value: string,
  extraTerms: readonly string[],
  label: string,
): string | null {
  const match = findMatches(value, extraTerms).find((candidate) =>
    BLOCKING.includes(candidate.entry.severity),
  );
  if (!match) return null;

  switch (match.entry.category) {
    case "HATE_SPEECH":
      return `${label} contains language that attacks people for who they are. Please choose another.`;
    case "SELF_HARM":
      return `${label} contains a threat or a reference to self-harm, which we cannot accept. If you are struggling, please talk to somebody you trust.`;
    default:
      return `${label} contains language that is not allowed. Please choose another.`;
  }
}

/* ------------------------------------------------------------------ */
/* Team names                                                         */
/* ------------------------------------------------------------------ */

/** Longest run of letters a team name must contain to be pronounceable. */
export const MIN_TEAM_NAME_LETTERS = 2;

/**
 * Characters a team name may use.
 *
 * Generous enough for real esports names — digits (`Team 7`, `Level99`), spaces,
 * and the punctuation that appears in names (`X-Force`, `Rock & Roll`, `O'Neil`,
 * `Team 3.0`) — while refusing the symbols people use to make a name unreadable
 * or to impersonate: brackets, slashes, `@`, `#`, emoji.
 *
 * A name does not have to contain digits, but it must contain letters; `12345` is
 * not a team name.
 */
const TEAM_NAME_ALLOWED = /^[\p{L}\p{M}\p{N} .,'’&\-]+$/u;

export interface NameCheckOptions {
  /** Tournament-specific terms the organisers added. */
  blockedTerms?: readonly string[];
  /** What the value is called, so the message reads naturally. */
  label?: string;
}

/**
 * The part of a team-name problem that more typing cannot fix.
 *
 * Split out from `teamNamePolicyError` because the form reveals the two at
 * different moments. A name is "too short" or "not a full name yet" while it is
 * being typed, and complaining then is noise. Illegal characters or refused
 * language are not — no amount of further typing removes them, so the captain
 * should be told at once rather than after they have looked away.
 *
 * Returns `null` for a name that is merely unfinished.
 */
export function teamNameContentError(
  normalisedName: string,
  options: NameCheckOptions = {},
): string | null {
  const { blockedTerms = [], label = "Team name" } = options;
  const value = normalisedName.trim();
  if (!value) return null;

  /* No letters at all. Only reported when there is something else in the field,
     so an empty-ish value stays quiet. */
  if (!/\p{L}/u.test(value)) {
    return /\p{N}|\p{S}/u.test(value)
      ? `${label} must contain letters, not only numbers or symbols`
      : null;
  }

  if (!TEAM_NAME_ALLOWED.test(value)) {
    return `${label} cannot contain brackets, slashes, @ or emoji — letters, numbers, spaces, and . ' & - , only`;
  }

  return describeViolation(value, blockedTerms, label);
}

/**
 * Why a team name is unacceptable, or `null` when it is fine.
 *
 * Runs on the *normalised* name (the one with "Team" applied), so the rules
 * describe what will actually appear on the bracket.
 */
export function teamNamePolicyError(
  normalisedName: string,
  options: NameCheckOptions = {},
): string | null {
  const { label = "Team name" } = options;
  const value = normalisedName.trim();

  if (!value) return `${label} is required`;

  /* A single letter is a name still being typed ("Team X" on the way to "Team
     X-Force"), so the count is only enforced once there is at least one letter —
     and a value with none falls through to the content check, which says the
     sharper thing. */
  const letters = (value.match(/\p{L}/gu) ?? []).length;
  if (letters >= 1 && letters < MIN_TEAM_NAME_LETTERS) {
    return `${label} needs at least ${MIN_TEAM_NAME_LETTERS} letters`;
  }

  return teamNameContentError(value, options);
}

/* ------------------------------------------------------------------ */
/* Person names and game tags                                         */
/* ------------------------------------------------------------------ */

/**
 * Why a person's name is unacceptable, or `null`.
 *
 * The character rules stay in `validation.ts` (`personNameError`); this only adds
 * the abuse check, so the two concerns can be tested and changed separately.
 */
export function personNamePolicyError(
  fullName: string,
  options: NameCheckOptions = {},
): string | null {
  const { blockedTerms = [] } = options;
  return describeViolation(fullName, blockedTerms, "This name");
}

/**
 * Why an in-game handle is unacceptable, or `null`.
 *
 * Handles are the most likely place for abuse — they are chosen for effect and
 * appear on every scoreboard — so the same terms apply.
 */
export function gameTagPolicyError(gameTag: string, options: NameCheckOptions = {}): string | null {
  const { blockedTerms = [] } = options;
  return describeViolation(gameTag, blockedTerms, "This game tag");
}

/* ------------------------------------------------------------------ */
/* Warnings                                                           */
/* ------------------------------------------------------------------ */

/**
 * Terms that are rude but not refused, so an organiser can still see them.
 *
 * This is the `MASK` action expressed for a form that cannot censor a name: the
 * value is accepted and the console shows a note. Refusing "Team Idiots" would be
 * heavy-handed; silently accepting it would leave the organisers unaware of what
 * is about to appear on their bracket.
 */
export function nameWarnings(raw: string, options: NameCheckOptions = {}): string[] {
  const { blockedTerms = [], label = "Name" } = options;
  const soft = findMatches(raw, blockedTerms).filter((match) => match.entry.severity === "LOW");
  if (soft.length === 0) return [];

  const categories = Array.from(new Set(soft.map((match) => match.entry.category)));
  const summary =
    categories.length === 1 ? categories[0].toLowerCase().replace("_", " ") : "language";

  return [
    `${label} contains mild ${summary} (${soft.length} word${
      soft.length === 1 ? "" : "s"
    }). It will be registered as typed — please review it before the bracket is published.`,
  ];
}
