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
  /**
   * What the winners take, as the organisers want it written.
   *
   * Free text rather than a number: prizes here are announced as "10,000 SAR",
   * "Gaming PC + 5,000 SAR" or "Trophy only", and forcing a numeric field would make
   * two of those unrepresentable. Empty means the organisers have not published one,
   * and the card simply omits the line rather than showing a blank.
   */
  prizePool: string;
  /** Divisions that may enter this game. */
  divisions: Gender[];
}

/**
 * A sponsor shown on the landing page.
 *
 * A logo card, not a paragraph: the role is the heading printed above the mark, and
 * `name` is what stands in for the logo. Uploaded artwork would need the storage,
 * validation and cache-busting the game logos got, so a wordmark in the card is what
 * ships — it reads as a logo tile and needs no second asset pipeline.
 */
export interface Sponsor {
  id: string;
  /** The wordmark shown in the tile — "Riyadh Bank", "stc". */
  name: string;
  /**
   * What they sponsor as: "Platinum Sponsor", "Official Bank", "Media Partner".
   *
   * Printed as the heading of the tile. Free text because the tiers are the
   * organisers' commercial language, not something this application can enumerate.
   */
  role: string;
  /** Where the tile links to. Empty means it is not a link. */
  url: string;
}

/**
 * One place to watch the tournament, shown while it is live.
 *
 * Deliberately just an app name and a URL: the organisers add "Twitch" or
 * "YouTube" as they would write it on a poster, and the landing page renders each as
 * a button. Nothing is inferred from the URL, so a channel on a platform this
 * application has never heard of works exactly the same way.
 */
export interface WatchLink {
  id: string;
  /** The app or channel name — "Twitch", "YouTube", "Kick". */
  label: string;
  /** Where the button goes. Only http(s) or a site-relative path survives. */
  url: string;
}

/** Accent presets offered when an organiser creates a game. */
export const ACCENT_PRESETS: { id: string; label: string; accent: [string, string] }[] = [
  { id: "cyan", label: "Cyan", accent: ["#4fb6d0", "#0583b6"] },
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

  /**
   * Whether an admin or staff member may still register while the window is closed.
   *
   * On by default: the people running the tournament are the ones who need to enter a
   * team that turned up late, or to correct an entry after the deadline. Turning it off
   * closes the form to *everyone*, which is the only way to stop a signed-in organiser
   * from adding a team by accident once the bracket is locked.
   *
   * This is a policy switch, not the security boundary. The exemption itself is always
   * the signed console session — the flag only decides whether that session is honoured.
   */
  allowOrganiserEntriesClosed: boolean;

  /**
   * Whether the tournament is being played right now.
   *
   * Independent of `registrationOpen` on purpose: the usual case is a live
   * tournament whose registration has closed, but an organiser may also want the
   * announcement up while the form is still open. The notice is shown on the
   * landing page — the "main page" — and never inside the registration form.
   */
  tournamentLive: boolean;

  /**
   * The live notice, as the organisers want it written.
   *
   * Empty means "use the translated default", so an organisers who leaves the box
   * alone still gets a proper sentence in the reader's own language rather than a
   * hardcoded English one.
   */
  liveMessage: string;

  /** Where to watch, when the tournament is live. */
  watchLinks: WatchLink[];

  /**
   * The community Discord invite shown on the success screen.
   *
   * Empty means "show no link", so a tournament that does not run a Discord never
   * shows a dead button. It is read *after* a team submits, which is the one moment
   * every member is guaranteed to be looking — the landing page already has the
   * latest announcement, but a captain who has just registered needs the room they
   * will actually play in.
   *
   * Editable by any signed-in organiser, because the invite is a thing that expires
   * and gets reissued mid-tournament.
   */
  discordInviteUrl: string;

  /**
   * The address the footer's "Contact us" writes to.
   *
   * Empty hides the link rather than showing a `mailto:` with no destination — a
   * footer link that opens a blank compose window is worse than no link.
   */
  contactEmail: string;

  /**
   * The tournament's social accounts, shown in the footer.
   *
   * Same shape as the watch links so an organiser edits them the same way. Free-form
   * label plus URL: the committee's accounts change platform, and enumerating them
   * would mean a code change every time.
   */
  socialLinks: WatchLink[];

  /** Most players (starters + substitutes) one roster may hold. */
  maxRoster: number;

  /** The in-game handle every member must provide. */
  gameTagLabel: string;
  gameTagHint: string;

  games: GameDefinition[];

  /**
   * Sponsors, in the order the organisers arranged them.
   *
   * Capped at `MAX_SPONSORS` — the landing page shows one strip of them, and a list
   * long enough to wrap past two rows stops reading as a sponsorship and starts
   * reading as a wall of text.
   */
  sponsors: Sponsor[];

  /**
   * Typing this as a team name opens the grand admin sign-in instead of registering.
   *
   * See `DEFAULT_ADMIN_ENTRY_NAME`. Empty turns the shortcut off; the sign-in itself is
   * unaffected and still reachable at its own address.
   */
  adminEntryName: string;

  /** The same, for the staff door. */
  staffEntryName: string;

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
 * How many sponsors the landing page will show.
 *
 * Enforced here rather than only in the console: the config row is read on every page
 * load, and the limit is a property of the layout, not a rule the console happens to
 * apply.
 */
export const MAX_SPONSORS = 9;

/** Longest sponsor name, and how long a stored link may be. */
export const SPONSOR_NAME_MAX = 48;
export const SPONSOR_URL_MAX = 200;
/** Longest sponsor role line — "Platinum Sponsor", "Official Payment Partner". */
export const SPONSOR_ROLE_MAX = 32;

/**
 * How many "watch us" buttons the live notice may show.
 *
 * A handful of official channels is a choice; a dozen is a directory. The landing
 * page shows them in one row of buttons, so the cap is about the layout as much as
 * the setting.
 */
export const MAX_WATCH_LINKS = 8;

/** Longest app name ("YouTube Live") and stored watch URL. */
export const WATCH_LABEL_MAX = 32;
export const WATCH_URL_MAX = 300;

/** Cap on the footer's social accounts, and the longest contact address accepted. */
export const MAX_SOCIAL_LINKS = 6;
export const CONTACT_EMAIL_MAX = 160;

/**
 * A team name that opens the organiser sign-in instead of registering a team.
 *
 * A typed word rather than a link, because the people who need it are the ones who
 * would otherwise hunt for a URL, and because a name nobody registers is easy to hand
 * out verbally. It is **not** a credential: both doors still demand their own secret or
 * mailed code, and every API call is checked again on the server. What it changes is
 * only where a browser goes.
 *
 * Empty disables it. Compared case-insensitively, with whitespace collapsed, so
 * "Crown-Admin" and "crown admin" both work.
 */
export const DEFAULT_ADMIN_ENTRY_NAME = "crown-admin";
export const DEFAULT_STAFF_ENTRY_NAME = "crown-staff";
export const ENTRY_NAME_MAX = 32;

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
  closedMessage: "Registration is closed. Follow the organisers for the next window.",
  // On by default: a late team, or a correction after the deadline, is exactly what the
  // organisers need the form for once the public window has shut.
  allowOrganiserEntriesClosed: true,
  // Off until the organisers say otherwise: announcing a live tournament that is not
  // being played is worse than saying nothing.
  tournamentLive: false,
  liveMessage: "",
  watchLinks: [],
  // Empty: no Discord link until the organisers provide one.
  discordInviteUrl: "",
  // No contact address and no social accounts until the organisers add them; an empty
  // list hides that column of the footer rather than showing a heading over nothing.
  contactEmail: "",
  socialLinks: [],
  maxRoster: DEFAULT_MAX_ROSTER,
  gameTagLabel: "Game tag",
  gameTagHint: "Exactly as it appears in game.",
  sponsors: [],
  adminEntryName: DEFAULT_ADMIN_ENTRY_NAME,
  staffEntryName: DEFAULT_STAFF_ENTRY_NAME,
  games: [
    {
      id: "rocket-league",
      name: "Rocket League",
      format: "3v3",
      squadSize: 3,
      maxSubstitutes: 2,
      maxCoaches: 1,
      accent: ["#4fb6d0", "#0583b6"],
      prizePool: "",
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
      prizePool: "",
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
      prizePool: "",
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
      prizePool: "",
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
    /* Trimmed and bounded. Empty is meaningful — "no prize announced" — so it is kept
       as an empty string rather than being replaced with a placeholder that would then
       be printed on the card. */
    prizePool: str(value.prizePool, "", 40),
    // A game nobody can enter would silently disappear from the form.
    divisions: divisions.length > 0 ? divisions : ["male", "female"],
  };
}

/**
 * One sponsor row, or `null` when there is nothing to show.
 *
 * The id is derived from the name so the same sponsor typed twice collapses, and so
 * the console has a stable key to edit and remove by. A link is accepted only when it
 * is http(s) or a site-relative path — `safeLink` is the same rule every other
 * organiser-supplied URL goes through, because this text ends up in an `href`.
 */
function normaliseSponsor(value: unknown, index: number): Sponsor | null {
  if (!isRecord(value)) return null;

  const name = str(value.name, "", SPONSOR_NAME_MAX);
  if (!name) return null;

  const id = slugify(str(value.id, name, 48)) || `sponsor-${index + 1}`;
  const raw = str(value.url, "", SPONSOR_URL_MAX);

  return { id, name, role: str(value.role, "", SPONSOR_ROLE_MAX), url: raw ? safeLink(raw, "") : "" };
}

/**
 * One "watch us" row, or `null` when it could not be a button.
 *
 * A label and a usable URL are both required: a button with no destination is worse
 * than no button, and a row with no label would render as an empty tile. The URL goes
 * through `safeLink`, so an organiser's mistyped paste cannot become a
 * `javascript:` link on the landing page.
 */
function normaliseWatchLink(value: unknown, index: number): WatchLink | null {
  if (!isRecord(value)) return null;

  const label = str(value.label, "", WATCH_LABEL_MAX);
  const raw = str(value.url, "", WATCH_URL_MAX);
  if (!label || !raw) return null;

  const url = safeLink(raw, "");
  if (!url) return null;

  const id = slugify(str(value.id, label, 48)) || `watch-${index + 1}`;
  return { id, label, url };
}

/**
 * One social account in the footer, or `null` when it could not be a link.
 *
 * Same rules as a watch link — a label and a usable URL, both required — and the same
 * `safeLink` filter, because these render as `<a href>` on every page. The id is
 * prefixed so a label that matches a watch link's cannot produce the same React key in
 * a page that shows both.
 */
function normaliseSocialLink(value: unknown, index: number): WatchLink | null {
  const link = normaliseWatchLink(value, index);
  if (!link) return null;
  /* Prefix once, not on every save.
   *
   * The prefix keeps a social account's React key distinct from a watch link's, but
   * blindly adding it here re-prefixed an id that already carried it — so saving the
   * config twice turned `social-instagram` into `social-social-instagram`, and the
   * account's uploaded logo (keyed by that id) was orphaned. */
  return { ...link, id: link.id.startsWith("social-") ? link.id : `social-${link.id}` };
}

/**
 * A contact address, or empty.
 *
 * Deliberately permissive about shape — an address is the operator's own, typed into
 * their own deployment — but strict about *meaning*: without an `@` it can only ever
 * be a broken `mailto:`, so it is dropped rather than shown. Newlines and spaces are
 * removed because they would break the header the browser builds.
 */
function emailLike(value: unknown): string {
  const raw = str(value, "", CONTACT_EMAIL_MAX).replace(/\s+/g, "");
  if (!raw || !raw.includes("@")) return "";
  return raw;
}

function normaliseRequirement(value: unknown, index: number): RequirementDefinition | null {  if (!isRecord(value)) return null;

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

  /*
   * The student-only domains, and how the number sits inside an address.
   *
   * Carried through normalisation because an institution the organisers add is often one
   * whose students use a subdomain the built-in list does not have. Both are optional: an
   * entry without them behaves exactly as before, and `emailDomains` remains the fallback.
   */
  const studentDomains = Array.isArray(value.studentDomains)
    ? value.studentDomains
        .map((domain) => (typeof domain === "string" ? domain.trim().toLowerCase() : ""))
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    : [];

  const rawFormat = isRecord(value.studentIdFormat) ? value.studentIdFormat : null;
  const affix = (input: unknown) =>
    typeof input === "string" ? input.trim().slice(0, 12) : "";
  const studentIdFormat = rawFormat
    ? (() => {
        const prefix = affix(rawFormat.prefix);
        const suffix = affix(rawFormat.suffix);
        return prefix || suffix ? { ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) } : null;
      })()
    : null;

  const sector: UniversitySector = value.sector === "Private" ? "Private" : "Government";

  return {
    id: slugify(str(value.id, name, 48)) || `university-${index + 1}`,
    name,
    city: str(value.city, "—", 60),
    sector,
    emailDomains: domains,
    ...(studentDomains.length > 0 ? { studentDomains } : {}),
    ...(studentIdFormat ? { studentIdFormat } : {}),
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

  /* Sponsors, capped in order. `slice` after de-duplication rather than before, so a
     duplicated first entry does not cost the organisers a slot. */
  const sponsors = Array.isArray(input.sponsors)
    ? input.sponsors
        .map(normaliseSponsor)
        .filter((sponsor): sponsor is Sponsor => sponsor !== null)
        .filter((sponsor, index, all) => all.findIndex((other) => other.id === sponsor.id) === index)
        .slice(0, MAX_SPONSORS)
    : [];

  /* What to watch, capped in order and de-duplicated by id, exactly like sponsors.
     A row without both a label and a usable link is dropped rather than rendered as
     a dead button. */
  const watchLinks = Array.isArray(input.watchLinks)
    ? input.watchLinks
        .map(normaliseWatchLink)
        .filter((link): link is WatchLink => link !== null)
        .filter((link, index, all) => all.findIndex((other) => other.id === link.id) === index)
        .slice(0, MAX_WATCH_LINKS)
    : [];

  /* Same treatment as the watch links, capped separately: the footer is one row, and
     six accounts is already more than fits beside the logo on a phone. */
  const socialLinks = Array.isArray(input.socialLinks)
    ? input.socialLinks
        .map(normaliseSocialLink)
        .filter((link): link is WatchLink => link !== null)
        .filter((link, index, all) => all.findIndex((other) => other.id === link.id) === index)
        .slice(0, MAX_SOCIAL_LINKS)
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
    /* `!== false` so a config saved before this existed keeps the behaviour it already
       had — organisers could register through a closed window then too. */
    allowOrganiserEntriesClosed: input.allowOrganiserEntriesClosed !== false,
    /* Off unless the organisers switch it on. `!== false` would be wrong here: a config
       saved before this existed must not start announcing a live tournament. */
    tournamentLive: input.tournamentLive === true,
    /* Empty means "use the translated default" — see the landing page. */
    liveMessage: str(input.liveMessage, "", 240),
    watchLinks,
    /* Through `safeLink`, so a mistyped invite can never become a `javascript:` link
       on the success screen. Empty stays empty — that is "no Discord", not a fallback. */
    discordInviteUrl: safeLink(str(input.discordInviteUrl, "", 300), ""),
    /* A plain address, not a link: the footer builds the `mailto:` so an organiser
       cannot paste a `javascript:` URL into a field that looks like an email. Anything
       without an `@` is dropped — that would only ever be a broken link. */
    contactEmail: emailLike(input.contactEmail),
    socialLinks,
    maxRoster: int(input.maxRoster, DEFAULT_MAX_ROSTER, 1, MAX_ROSTER_LIMIT),
    gameTagLabel: str(input.gameTagLabel, DEFAULT_TOURNAMENT.gameTagLabel, 40),
    gameTagHint: str(input.gameTagHint, DEFAULT_TOURNAMENT.gameTagHint, 160),
    // A tournament with no games cannot be registered for — keep the defaults.
    games: games.length > 0 ? games : DEFAULT_TOURNAMENT.games.map((game) => ({ ...game })),
    sponsors,
    adminEntryName: str(input.adminEntryName, DEFAULT_ADMIN_ENTRY_NAME, ENTRY_NAME_MAX),
    staffEntryName: str(input.staffEntryName, DEFAULT_STAFF_ENTRY_NAME, ENTRY_NAME_MAX),
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
