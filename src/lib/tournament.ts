/**
 * Tournament configuration — everything the organisers can change without a
 * deployment.
 *
 * The config is the single source of truth for both the public registration
 * form and the admin console. It is stored in the database (see `store.ts`) so
 * every visitor sees the same tournament, and it degrades to `DEFAULT_TOURNAMENT`
 * whenever the database is unreachable — a broken backend must never take the
 * form down.
 */

import type { Gender } from "./games";
import { DEFAULT_PRIVACY_NOTICE, DEFAULT_PRIVACY_NOTICE_AR } from "./privacy-notice";
import { SAUDI_REGIONS, type SaudiRegion } from "./regions";
import { UNIVERSITIES, type University, type UniversitySector } from "./universities";

/* ------------------------------------------------------------------ */
/* Games                                                               */
/* ------------------------------------------------------------------ */

export interface GameDefinition {
  id: string;
  name: string;
  /** Competitive format, e.g. "5v5" */
  format: string;
  /** Players on the field for one match — anything beyond this is an alternate. */
  squadSize: number;
  /**
   * How many substitutes a team may add for this game. `0` means the game does
   * not accept any.
   *
   * Per game rather than per tournament because the right number genuinely
   * differs: a 1v1 title has no bench to speak of, while a 5v5 title may want a
   * full second line.
   */
  maxSubstitutes: number;
  /** How many coaches a team may add for this game. `0` means none. */
  maxCoaches: number;
  /** Two-stop gradient used for the card accent. */
  accent: [string, string];
  /** Divisions that may enter this game. */
  divisions: Gender[];
}

/** Accent presets offered when an organiser creates a game. */
export const ACCENT_PRESETS: { id: string; label: string; accent: [string, string] }[] = [
  { id: "cyan", label: "Cyan", accent: ["#5cf0f7", "#23b5c6"] },
  { id: "amber", label: "Amber", accent: ["#ffb457", "#f97316"] },
  { id: "lime", label: "Lime", accent: ["#8de08d", "#22a06b"] },
  { id: "rose", label: "Rose", accent: ["#ff8497", "#e63950"] },
  { id: "violet", label: "Violet", accent: ["#b79cff", "#6d47d9"] },
  { id: "gold", label: "Gold", accent: ["#ffd97a", "#d99a1f"] },
  { id: "steel", label: "Steel", accent: ["#c3cfda", "#7e8b99"] },
  { id: "coral", label: "Coral", accent: ["#ff9d7a", "#e2543a"] },
];

/* ------------------------------------------------------------------ */
/* Roster requirements                                                 */
/* ------------------------------------------------------------------ */

export type RequirementType = "text" | "number" | "select" | "checkbox";

export interface RequirementDefinition {
  id: string;
  label: string;
  type: RequirementType;
  required: boolean;
  hint?: string;
  placeholder?: string;
  /** Choices for `select`; ignored by every other type. */
  options?: string[];
  /** Text length bounds; ignored by every other type. */
  minLength?: number;
  maxLength?: number;
}

export const REQUIREMENT_TYPE_LABEL: Record<RequirementType, string> = {
  text: "Short text",
  number: "Number",
  select: "Choose from a list",
  checkbox: "Confirmation (checkbox)",
};

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface TournamentConfig {
  /** ISO timestamp of the last admin save — lets a client notice a version bump. */
  updatedAt: string;

  tournamentName: string;
  tagline: string;

  /** When false the form is replaced by `closedMessage`. */
  registrationOpen: boolean;
  closedMessage: string;

  /** Most players (starters + substitutes) one roster may hold. */
  maxRoster: number;

  /** The in-game handle every member must provide. */
  gameTagLabel: string;
  gameTagHint: string;

  games: GameDefinition[];

  /** Extra per-member fields the organisers added on top of the built-ins. */
  requirements: RequirementDefinition[];

  /** Provinces allowed to enter. Empty means every province. */
  allowedRegions: SaudiRegion[];

  /** Built-in university ids the organisers closed. */
  hiddenUniversities: string[];

  /** Universities the organisers added. */
  extraUniversities: University[];

  /** Whether one roster may mix members from different universities. */
  allowMixedUniversities: boolean;

  /**
   * Extra words the organisers refuse in team names, member names and game tags,
   * on top of the built-in list in `name-policy.ts`.
   *
   * Terms specific to a community are worth more than a generic list, and only
   * the organisers can judge context, so they get the last word.
   */
  blockedTerms: string[];

  /** Whether the entrant must accept the privacy notice and the rules. */
  requireConsent: boolean;

  /** Where the privacy notice lives. Relative URLs are allowed. */
  policyUrl: string;

  /**
   * The privacy notice in English, in the small markup `privacy-notice.ts`
   * describes.
   *
   * Stored per language rather than translated at render time: a privacy notice is
   * a statement the organisers may need to adjust for their own circumstances, and
   * they must be able to do that in each language without one edit overwriting the
   * other.
   *
   * Editable by the organisers because what a competition may lawfully do with
   * entrant data is their call, not this application's — and a notice that cannot
   * be corrected is worse than one that is slightly wrong, since it is the thing
   * people are asked to consent to.
   */
  privacyNoticeEn: string;

  /** The same notice in Arabic. Shown when the form is being used in Arabic. */
  privacyNoticeAr: string;
}

export const DEFAULT_MAX_ROSTER = 6;

/** Fallback allowance for a game that does not specify its own. */
export const DEFAULT_MAX_SUBSTITUTES = 2;

/** Fallback allowance for coaching staff. */
export const DEFAULT_MAX_COACHES = 1;

/** Hard ceiling the admin console (and the API) will accept. */
export const MAX_ROSTER_LIMIT = 12;

/** Hard ceiling on the supporting roles, on top of the playing squad. */
export const MAX_SUPPORT_LIMIT = 8;

/**
 * Longest privacy notice that may be stored.
 *
 * Generous — the built-in one is a few thousand characters — but bounded, because
 * it is saved into the config row with every other setting and read on every page
 * load. A paste of an entire document would slow every request down.
 */
export const MAX_PRIVACY_NOTICE = 20_000;

export const DEFAULT_TOURNAMENT: TournamentConfig = {
  updatedAt: "",
  tournamentName: "KSU Crown",
  tagline: "Esports Championship · Team Registration",
  registrationOpen: true,
  closedMessage:
    "Registration for this tournament is closed. Follow the organisers for the next window.",
  maxRoster: DEFAULT_MAX_ROSTER,
  gameTagLabel: "Game tag",
  gameTagHint: "Your in-game handle exactly as it appears — Epic ID, Riot ID or Battle.net tag.",
  games: [
    {
      id: "rocket-league",
      name: "Rocket League",
      format: "3v3",
      squadSize: 3,
      maxSubstitutes: 2,
      maxCoaches: 1,
      accent: ["#5cf0f7", "#23b5c6"],
      divisions: ["male"],
    },
    {
      id: "overwatch-2",
      name: "OverWatch 2",
      format: "5v5",
      squadSize: 5,
      maxSubstitutes: 2,
      maxCoaches: 2,
      accent: ["#ffb457", "#f97316"],
      divisions: ["male", "female"],
    },
    {
      id: "ea-fc-26",
      name: "EA FC 26",
      format: "1v1",
      squadSize: 1,
      // A 1v1 title has no bench at all.
      maxSubstitutes: 0,
      maxCoaches: 1,
      accent: ["#8de08d", "#22a06b"],
      divisions: ["male"],
    },
    {
      id: "valorant",
      name: "Valorant",
      format: "5v5",
      squadSize: 5,
      maxSubstitutes: 2,
      maxCoaches: 2,
      accent: ["#ff8497", "#e63950"],
      divisions: ["female"],
    },
  ],
  requirements: [],
  allowedRegions: [],
  hiddenUniversities: [],
  extraUniversities: [],
  allowMixedUniversities: true,
  blockedTerms: [],
  // On by default: consent is the reason the notice exists, so an organiser who
  // has not thought about it gets the safe behaviour rather than none.
  requireConsent: true,
  policyUrl: "/privacy",
  privacyNoticeEn: DEFAULT_PRIVACY_NOTICE,
  privacyNoticeAr: DEFAULT_PRIVACY_NOTICE_AR,
};

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const GENDERS: Gender[] = ["male", "female"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown, fallback: string, max = 200) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

const int = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

function hexOr(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

/** Turn an untrusted id into one that is safe to use as a draft/payload key. */
export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Per-game role allowances a game inherits when it does not carry its own. */
interface RoleDefaults {
  maxSubstitutes: number;
  maxCoaches: number;
}

function normaliseGame(
  value: unknown,
  index: number,
  defaults: RoleDefaults,
): GameDefinition | null {
  if (!isRecord(value)) return null;

  const name = str(value.name, "", 48);
  if (!name) return null;

  const id = slugify(str(value.id, name, 48)) || `game-${index + 1}`;
  const declared = Array.isArray(value.divisions) ? value.divisions : [];
  const divisions = GENDERS.filter((gender) => declared.includes(gender));

  const accent = Array.isArray(value.accent)
    ? [
        hexOr(value.accent[0], ACCENT_PRESETS[0].accent[0]),
        hexOr(value.accent[1], ACCENT_PRESETS[0].accent[1]),
      ]
    : ACCENT_PRESETS[0].accent;

  // A substitute needs somewhere to sit, so the count can never exceed the
  // difference between the roster cap and the starting line-up.
  const roomForSubstitutes = Math.max(0, MAX_ROSTER_LIMIT - int(value.squadSize, 1, 1, MAX_ROSTER_LIMIT));

  return {
    id,
    name,
    format: str(value.format, "1v1", 12),
    squadSize: int(value.squadSize, 1, 1, MAX_ROSTER_LIMIT),
    maxSubstitutes: Math.min(
      int(value.maxSubstitutes, defaults.maxSubstitutes, 0, MAX_SUPPORT_LIMIT),
      Math.max(roomForSubstitutes, 0),
    ),
    maxCoaches: int(value.maxCoaches, defaults.maxCoaches, 0, MAX_SUPPORT_LIMIT),
    accent: [accent[0], accent[1]] as [string, string],
    // A game nobody can enter would silently disappear from the form.
    divisions: divisions.length > 0 ? divisions : ["male", "female"],
  };
}

function normaliseRequirement(value: unknown, index: number): RequirementDefinition | null {
  if (!isRecord(value)) return null;

  const label = str(value.label, "", 60);
  if (!label) return null;

  const type: RequirementType = (["text", "number", "select", "checkbox"] as const).includes(
    value.type as RequirementType,
  )
    ? (value.type as RequirementType)
    : "text";

  const options =
    type === "select" && Array.isArray(value.options)
      ? value.options
          .map((option) => (typeof option === "string" ? option.trim().slice(0, 60) : ""))
          .filter(Boolean)
      : [];

  // A select with no choices can never be answered, so it degrades to text.
  const resolved: RequirementType = type === "select" && options.length === 0 ? "text" : type;

  return {
    id: slugify(str(value.id, label, 48)) || `requirement-${index + 1}`,
    label,
    type: resolved,
    required: value.required !== false,
    hint: typeof value.hint === "string" && value.hint.trim() ? value.hint.trim().slice(0, 160) : undefined,
    placeholder:
      typeof value.placeholder === "string" && value.placeholder.trim()
        ? value.placeholder.trim().slice(0, 80)
        : undefined,
    options: resolved === "select" ? options : undefined,
    minLength: resolved === "text" ? int(value.minLength, 0, 0, 200) || undefined : undefined,
    maxLength: resolved === "text" ? int(value.maxLength, 0, 0, 200) || undefined : undefined,
  };
}

function normaliseExtraUniversity(value: unknown, index: number): University | null {
  if (!isRecord(value)) return null;

  const name = str(value.name, "", 90);
  if (!name) return null;

  const domains = Array.isArray(value.emailDomains)
    ? value.emailDomains
        .map((domain) => (typeof domain === "string" ? domain.trim().toLowerCase() : ""))
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    : [];

  const sector: UniversitySector = value.sector === "Private" ? "Private" : "Government";

  return {
    id: slugify(str(value.id, name, 48)) || `university-${index + 1}`,
    name,
    city: str(value.city, "—", 60),
    sector,
    emailDomains: domains,
    region: isCustomRegion(value.region) ? value.region : "Other",
    addedByOrganisers: true,
  };
}

function isCustomRegion(value: unknown): value is SaudiRegion {
  return typeof value === "string" && [...SAUDI_REGIONS, "Other"].includes(value);
}

/**
 * Coerce anything that arrived over the wire — a stored config, a request body,
 * an old format — into a config the app can trust. Never throws: a config that
 * cannot be understood is replaced field by field with the default.
 */
/**
 * A link the form may render: a path on this site, or an http(s) address. Anything
 * else — `javascript:`, `data:`, a protocol-relative `//host` — falls back to the
 * default, so a mistyped or malicious setting can never become script in a link.
 */
function safeLink(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^\/(?![\/\\])/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // Not an absolute URL.
  }
  return fallback;
}

export function normaliseConfig(input: unknown): TournamentConfig {
  if (!isRecord(input)) return { ...DEFAULT_TOURNAMENT };

  /* Substitutes and coaches used to be tournament-wide. A config saved before
     that changed still carries those fields and knows nothing about per-game
     limits, so they are read here and handed to each game as its starting point
     — otherwise an organiser's existing settings would silently reset. */
  const legacyRoles: RoleDefaults = {
    maxSubstitutes:
      input.allowSubstitutes === false
        ? 0
        : int(input.maxSubstitutes, DEFAULT_MAX_SUBSTITUTES, 0, MAX_SUPPORT_LIMIT),
    maxCoaches:
      input.allowCoaches === true
        ? int(input.maxCoaches, DEFAULT_MAX_COACHES, 0, MAX_SUPPORT_LIMIT)
        : 0,
  };

  const games = Array.isArray(input.games)
    ? input.games
        .map((game, index) => normaliseGame(game, index, legacyRoles))
        .filter((game): game is GameDefinition => game !== null)
        .filter((game, index, all) => all.findIndex((other) => other.id === game.id) === index)
    : [];

  const requirements = Array.isArray(input.requirements)
    ? input.requirements
        .map(normaliseRequirement)
        .filter((requirement): requirement is RequirementDefinition => requirement !== null)
        .filter((requirement, index, all) => all.findIndex((r) => r.id === requirement.id) === index)
    : [];

  const hidden = Array.isArray(input.hiddenUniversities)
    ? input.hiddenUniversities.filter((id): id is string => typeof id === "string")
    : [];

  const extras = Array.isArray(input.extraUniversities)
    ? input.extraUniversities
        .map(normaliseExtraUniversity)
        .filter((university): university is University => university !== null)
    : [];

  const allowedRegions = Array.isArray(input.allowedRegions)
    ? input.allowedRegions.filter(isCustomRegion)
    : [];

  /**
   * One privacy notice, falling back to the built-in text.
   *
   * A cleared textarea means "use the built-in notice" rather than "show nothing":
   * an organiser who clears the box by accident must not leave entrants agreeing to
   * a blank page.
   */
  const notice = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.slice(0, MAX_PRIVACY_NOTICE) : fallback;

  return {
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
    tournamentName: str(input.tournamentName, DEFAULT_TOURNAMENT.tournamentName, 60),
    tagline: str(input.tagline, DEFAULT_TOURNAMENT.tagline, 90),
    registrationOpen: input.registrationOpen !== false,
    closedMessage: str(input.closedMessage, DEFAULT_TOURNAMENT.closedMessage, 240),
    maxRoster: int(input.maxRoster, DEFAULT_MAX_ROSTER, 1, MAX_ROSTER_LIMIT),
    gameTagLabel: str(input.gameTagLabel, DEFAULT_TOURNAMENT.gameTagLabel, 40),
    gameTagHint: str(input.gameTagHint, DEFAULT_TOURNAMENT.gameTagHint, 160),
    // A tournament with no games cannot be registered for — keep the defaults.
    games: games.length > 0 ? games : DEFAULT_TOURNAMENT.games.map((game) => ({ ...game })),
    requirements,
    allowedRegions,
    hiddenUniversities: hidden,
    extraUniversities: extras,
    allowMixedUniversities: input.allowMixedUniversities !== false,
    /* Lower-cased and de-duplicated *after* truncation, so the stored list is
       canonical: "Rivals" and "rivals" are one term, not two, and two long terms
       that truncate to the same 40 characters collapse rather than both being
       matched. Matching itself is case-insensitive, so nothing is lost by fixing
       the case here — and the organiser's textarea then round-trips unchanged,
       rather than appearing to gain duplicate lines. */
    blockedTerms: Array.from(
      new Set(
        (Array.isArray(input.blockedTerms) ? input.blockedTerms : [])
          .map((term) => (typeof term === "string" ? term.trim().toLowerCase().slice(0, 40) : ""))
          .filter(Boolean),
      ),
    ).slice(0, 200),
    requireConsent: input.requireConsent !== false,
    policyUrl: safeLink(str(input.policyUrl, DEFAULT_TOURNAMENT.policyUrl, 200), DEFAULT_TOURNAMENT.policyUrl),
    /* Empty means "use the built-in notice" rather than "show nothing" — an
       organisers' textarea cleared by accident must not leave entrants agreeing
       to a blank page. */
    privacyNoticeEn: notice(input.privacyNoticeEn ?? input.privacyNotice, DEFAULT_PRIVACY_NOTICE),
    privacyNoticeAr: notice(input.privacyNoticeAr, DEFAULT_PRIVACY_NOTICE_AR),
  };
}

/* ------------------------------------------------------------------ */
/* Derived reads                                                       */
/* ------------------------------------------------------------------ */

export function gameById(config: TournamentConfig, id: string): GameDefinition | null {
  return config.games.find((game) => game.id === id) ?? null;
}

export function gamesForDivision(config: TournamentConfig, gender: Gender | ""): GameDefinition[] {
  if (!gender) return [];
  return config.games.filter((game) => game.divisions.includes(gender));
}

export function isGameAllowedForDivision(
  config: TournamentConfig,
  gameId: string,
  gender: Gender | "",
) {
  if (!gender || !gameId) return false;
  return Boolean(gameById(config, gameId)?.divisions.includes(gender));
}

/**
 * How many of each role a roster may hold for a given game.
 *
 * Starters are fixed at the game's on-field size — a team must field a full
 * squad. Substitutes and coaches come from the game's own settings, so each
 * title can have a different bench.
 *
 * Accepts the game itself rather than just its squad size, because the answer
 * now depends on the game's role allowances too. `null` (no game chosen yet)
 * yields a bare single-player roster, which is only ever used to keep the form
 * renderable before a game is picked.
 */
export interface RosterRules {
  starters: number;
  maxSubstitutes: number;
  maxCoaches: number;
  /** Cap on starters + substitutes together. */
  maxPlayers: number;
  /** Cap on every roster row, supporting staff included. */
  maxTotal: number;
}

/** The subset of a game the roster rules need. */
export type GameRoleSource = Pick<
  GameDefinition,
  "squadSize" | "maxSubstitutes" | "maxCoaches"
>;

export function rosterRulesFor(
  config: TournamentConfig,
  game: GameRoleSource | null | undefined,
): RosterRules {
  const starters = Math.max(1, Math.min(game?.squadSize ?? 1, MAX_ROSTER_LIMIT));

  /*
   * The player cap is **starters plus this game's bench**, not the tournament's
   * roster cap.
   *
   * It used to be `max(starters, config.maxRoster)`. With the shipped default of
   * six, a 1v1 title advertised a room for six players: the review step read
   * "1 / 6" for EA FC, and the roster step let the captain add five reserves to a
   * game that has no bench at all. The tournament-wide cap is a ceiling on what a
   * game *may* allow, not an allowance in its own right — a title with
   * `maxSubstitutes: 0` has an eleven-player team size of one, however generous
   * the organisers are feeling.
   *
   * `config.maxRoster` still bites: it is what stops a game that declares a large
   * bench from breaching the tournament's own limit, which is why it caps the room
   * for substitutes rather than being ignored.
   */
  const roomForSubstitutes = Math.max(
    0,
    Math.min(config.maxRoster, MAX_ROSTER_LIMIT) - starters,
  );
  const substitutes = Math.max(
    0,
    Math.min(game?.maxSubstitutes ?? 0, roomForSubstitutes),
  );
  const maxPlayers = starters + substitutes;

  const coaches = Math.max(0, Math.min(game?.maxCoaches ?? 0, MAX_SUPPORT_LIMIT));

  return {
    starters,
    maxSubstitutes: substitutes,
    maxCoaches: coaches,
    maxPlayers,
    maxTotal: Math.min(MAX_ROSTER_LIMIT + MAX_SUPPORT_LIMIT, maxPlayers + coaches),
  };
}

/** Roster bounds for a game: a full squad at minimum, the role caps at most. */
export function rosterBoundsFor(
  config: TournamentConfig,
  game: GameRoleSource | null | undefined,
) {
  const rules = rosterRulesFor(config, game);
  return { min: rules.starters, max: rules.maxTotal };
}

/** Every university a team may pick from: built-ins minus closed, plus added. */
export function activeUniversities(
  config: TournamentConfig,
  gender: Gender | "",
): University[] {
  const hidden = new Set(config.hiddenUniversities);
  const all = [...UNIVERSITIES, ...config.extraUniversities].filter(
    (university) => !hidden.has(university.id),
  );
  if (gender === "male") return all.filter((university) => !university.womenOnly);
  return all;
}

/**
 * The universities a roster may actually select.
 *
 * Institutions in a province the organisers closed are removed outright — they
 * used to be listed struck through and unselectable, which read as a puzzle
 * rather than a rule. Provinces with nothing open simply have no institutions
 * left to choose from.
 */
export function selectableUniversities(
  config: TournamentConfig,
  gender: Gender | "",
): University[] {
  return activeUniversities(config, gender).filter((university) =>
    regionIsAllowed(config, university.region),
  );
}

export function universityById(config: TournamentConfig, id: string): University | null {
  return (
    UNIVERSITIES.find((university) => university.id === id) ??
    config.extraUniversities.find((university) => university.id === id) ??
    null
  );
}

/** Provinces the tournament is open to. Empty list means the whole country. */
export function allowedRegionSet(config: TournamentConfig) {
  return new Set<SaudiRegion>(config.allowedRegions);
}

export function regionIsAllowed(config: TournamentConfig, region: SaudiRegion) {
  if (config.allowedRegions.length === 0) return true;
  return config.allowedRegions.includes(region);
}

/* ------------------------------------------------------------------ */
/* Requirement validation                                              */
/* ------------------------------------------------------------------ */

const REQUIREMENT_VALUE_MAX = 160;

/** Error message for one requirement answer, or `null` when it is acceptable. */
export function requirementError(
  requirement: RequirementDefinition,
  raw: string | undefined,
): string | null {
  const value = (raw ?? "").trim();

  if (!value) {
    return requirement.required
      ? requirement.type === "checkbox"
        ? "You must tick this to continue"
        : "Required"
      : null;
  }

  if (value.length > REQUIREMENT_VALUE_MAX) return `Keep this under ${REQUIREMENT_VALUE_MAX} characters`;

  switch (requirement.type) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(value) ? null : "Enter a number";
    case "select":
      return requirement.options?.includes(value) ? null : "Choose one of the listed options";
    case "checkbox":
      return value === "yes" ? null : "You must tick this to continue";
    case "text": {
      if (requirement.minLength && value.length < requirement.minLength) {
        return `At least ${requirement.minLength} characters`;
      }
      if (requirement.maxLength && value.length > requirement.maxLength) {
        return `At most ${requirement.maxLength} characters`;
      }
      return null;
    }
  }
}

/** Excel-style column letter for a 1-based index (1 → A, 27 → AA). */
export function columnLetter(index: number) {
  let value = index;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}
