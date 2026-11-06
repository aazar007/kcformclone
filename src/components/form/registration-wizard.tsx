"use client";

import * as React from "react";
import { BookOpen, ClipboardList, PencilLine, ShieldAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TournamentConfig } from "@/lib/tournament";
import type { RulebookVersions } from "@/lib/store";
import { WaveWall } from "@/components/brand/wave-wall";
import { TournamentLogo } from "@/components/brand/ksu-crown-logo";
import { RegistrationForm } from "./registration-form";
import { EditFlow } from "./edit-flow";
import { RulebookPanel } from "./rulebook-panel";
import { LanguageProvider, useLanguage } from "./language-provider";
import { Landing } from "./landing";
import { SiteFooter } from "./site-footer";

/**
 * The public page: register a new team, or reopen an existing one.
 *
 * Both live behind one set of tabs rather than two pages, because a captain who
 * has already registered is looking at the same form they used the first time
 * and expects to find their way back to it in the same place.
 */
/**
 * The characters a minus key can report, so the shortcut survives every layout.
 *
 * `-` is the plain key; `_` is what most layouts report when Shift is held; `–` and `—` are
 * what **macOS** produces for Option+minus and Option+Shift+minus, because a Mac composes a
 * character rather than sending the bare key; `−` is U+2212, which some keyboard drivers
 * and IMEs send instead of the hyphen. Missing any one of these makes the shortcut fail on
 * exactly the platforms this feature exists to serve.
 */
const DASH_KEYS = new Set(["-", "_", "–", "—", "−"]);

/** Whether a keydown is the minus key, by physical code or by whatever character it made. */
function isMinusKey(event: KeyboardEvent) {
  return (
    event.code === "Minus" ||
    event.code === "NumpadSubtract" ||
    DASH_KEYS.has(event.key)
  );
}

/**
 * The hidden ways into the console.
 *
 * `Ctrl`/`Cmd` + **Alt** + `−` opens the grand admin's address; `Ctrl`/`Cmd` + `Shift` +
 * `−` opens the staff one. Two shortcuts rather than one because the two audiences are
 * separate: whoever runs the tournament knows the first, and everyone granted access is
 * handed the second. Neither is a link on the page, and `/admin` answers 404.
 *
 * **Alt is the Mac's Option key**, so the same combination works on both: the code accepts
 * `metaKey` or `ctrlKey` for the primary modifier, and `altKey` covers Option. The minus is
 * matched by character *as well as* by key code, which is what makes it portable — with
 * Option held a Mac reports `–` rather than `-`, and with Shift held every platform reports
 * `_`. Matching on the bare `-` would have made the combo unreachable on macOS.
 *
 * The two combinations are mutually exclusive on purpose (`alt` without `shift`, `shift`
 * without `alt`), so a three-modifier press is ignored rather than guessed at. Nothing fires
 * while a text field has focus.
 *
 * One known false positive: `AltGr` reports itself as `ctrlKey` + `altKey` on Windows, so on
 * a layout where a minus sits behind AltGr the shortcut could fire. The consequence is a
 * navigation to a page that still demands the secret, so it is an annoyance rather than a
 * problem.
 *
 * This is a convenience, not a security boundary: both pages still demand their own
 * credential and the API checks every request. Either address may be null when the
 * deployment has no console configured, in which case that shortcut simply does nothing.
 */
function useOrganiserShortcut(ownerHref: string | null, staffHref: string | null) {
  React.useEffect(() => {
    if (!ownerHref && !staffHref) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!isMinusKey(event)) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      /* Mutually exclusive, so Ctrl+Alt+Shift+minus is deliberately inert rather than
         resolving to whichever branch happened to be written first. */
      const destination =
        event.altKey && !event.shiftKey ? ownerHref : event.shiftKey && !event.altKey ? staffHref : null;
      if (!destination) return;

      event.preventDefault();
      window.location.assign(destination);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ownerHref, staffHref]);
}

/**
 * The typed way in: a team name that opens an organiser door.
 *
 * The grand admin and the staff door each have an address, and a word that a person can
 * be told once. Typing it into the team-name field navigates there — nothing more. Both
 * doors still demand their own secret or mailed code, and every API call is checked again
 * on the server, so this is a route, not a credential.
 *
 * **Why a document listener rather than a prop.** The value lives in the draft, which is
 * owned several components down (`registration-form` → `step-team`), and threading two
 * paths plus two callbacks through that chain to compare one string would put the
 * shortcut's plumbing into every layer between them. The field has a stable id, and the
 * listener is read-only: it watches, it never writes to the draft.
 *
 * Matching is forgiving — case, surrounding space and repeated spaces are ignored — so a
 * phone keyboard that capitalises the first letter still works.
 */
function useEntryNameShortcut(
  config: TournamentConfig,
  ownerHref: string | null,
  staffHref: string | null,
) {
  React.useEffect(() => {
    const ownerName = config.adminEntryName.trim().toLowerCase();
    const staffName = config.staffEntryName.trim().toLowerCase();
    if (!ownerName && !staffName) return;

    /* One navigation, whatever happens to the DOM afterwards. Without this a fast typist
       can fire two `input` events before the browser unloads, and the second
       `location.assign` is a reload of the page being left. */
    let leaving = false;

    const onInput = (event: Event) => {
      if (leaving) return;
      const target = event.target as HTMLInputElement | null;
      if (!target || target.id !== "teamName") return;

      const typed = target.value.trim().toLowerCase().replace(/\s+/g, " ");
      if (!typed) return;

      /* The staff door first when both are configured to the same word: it is the
         narrower of the two, so a mistaken match can only ever reach the smaller door. */
      const destination =
        staffName && typed === staffName && staffHref
          ? staffHref
          : ownerName && typed === ownerName && ownerHref
            ? ownerHref
            : null;
      if (!destination) return;

      leaving = true;
      window.location.assign(destination);
    };

    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, [config.adminEntryName, config.staffEntryName, ownerHref, staffHref]);
}

export function RegistrationWizard({
  config,
  logoVersions,
  sponsorLogoVersions = {},
  rulebooks = {},
  initialTab = "register",
  initialReference = "",
  skipLanding = false,
  adminHref = null,
  staffHref = null,
  organiserPreview = false,
}: {
  config: TournamentConfig;
  /**
   * Games with an uploaded logo, keyed by game id with a cache-busting version.
   * Threaded down so a card only requests an image that exists.
   */
  logoVersions: Record<string, number>;
  /** The same for sponsors, keyed by sponsor id. */
  sponsorLogoVersions?: Record<string, number>;
  /**
   * Which games have a rulebook, keyed by game id.
   *
   * A map rather than a single document, because each title is played by different
   * rules and a team only ever needs the rules for the game it entered. An empty map
   * means nothing has been published yet — the tab still exists and says so, but no
   * acknowledgement is gated on a document that is not there.
   */
  rulebooks?: RulebookVersions;
  /** Which tab to open on — the confirmation email links straight to `edit`. */
  initialTab?: "register" | "edit";
  /**
   * A reference code carried by a share link (`?tab=edit&ref=ESC-26-…`).
   *
   * The leader passes that link round the team, so the only thing a player should
   * have to add is their own address. Prefilling it also means the code never has
   * to be retyped from a screenshot.
   */
  initialReference?: string;
  /** Skip the landing page and open the form immediately — used by "View form". */
  skipLanding?: boolean;
  /**
   * The grand admin console's address, resolved on the server — `/crown-…`, never
   * `/admin`.
   *
   * Passed in rather than imported because the segment is derived from `ADMIN_SECRET`,
   * which must not reach the browser. Null when the deployment has no console, and the
   * shortcut and the edit flow's console link are then simply absent.
   */
  adminHref?: string | null;
  /** The staff sign-in address — `/crew-…`. Same reasoning; null when unconfigured. */
  staffHref?: string | null;
  /**
   * Whether this visitor is signed in to the organiser console.
   *
   * Resolved on the server from the HttpOnly session cookie and passed down as a
   * single boolean. It only decides whether the form stays open while registration is
   * closed: an organiser who presses "View form" must be able to enter a team after
   * the public window has shut. Every write re-checks the cookie on the API, so this
   * flag is presentation, never authority.
   */
  organiserPreview?: boolean;
}) {
  return (
    <LanguageProvider>
      <WizardShell
        config={config}
        logoVersions={logoVersions}
        sponsorLogoVersions={sponsorLogoVersions}
        rulebooks={rulebooks}
        initialTab={initialTab}
        initialReference={initialReference}
        skipLanding={skipLanding}
        adminHref={adminHref}
        staffHref={staffHref}
        organiserPreview={organiserPreview}
      />
    </LanguageProvider>
  );
}

function WizardShell({
  config,
  logoVersions,
  sponsorLogoVersions = {},
  rulebooks,
  initialTab,
  initialReference,
  skipLanding,
  adminHref,
  staffHref,
  organiserPreview,
}: {
  config: TournamentConfig;
  logoVersions: Record<string, number>;
  /** Sponsor id → cache-busting version, for the sponsors that have a logo. */
  sponsorLogoVersions: Record<string, number>;
  rulebooks: RulebookVersions;
  initialTab: "register" | "edit";
  initialReference: string;
  skipLanding: boolean;
  adminHref: string | null;
  staffHref: string | null;
  organiserPreview: boolean;
}) {
  const { t, rtl } = useLanguage();
  useOrganiserShortcut(adminHref, staffHref);
  useEntryNameShortcut(config, adminHref, staffHref);

  /* The public window, or an organiser working after it. One expression used by every
     branch below, so the form and the notice can never disagree about whether the
     form is reachable. */
  const organiserMayEnter = organiserPreview && config.allowOrganiserEntriesClosed;
  const formOpen = config.registrationOpen || organiserMayEnter;
  const previewingClosed = organiserMayEnter && !config.registrationOpen;

  /** Which tab is *shown*. `rules` is a view, not a form. */
  const [tab, setTab] = React.useState<"register" | "edit" | "rules">(initialTab);
  /**
   * Which form is mounted behind the rulebook.
   *
   * Kept separate so opening the rulebook does not unmount the form. Unmounting
   * would throw away everything typed so far — the draft is persisted, but the live
   * component state (which step you were on, a half-filled roster) is not, and
   * coming back from the rules to a reset form would be a nasty surprise.
   */
  const [formTab, setFormTab] = React.useState<"register" | "edit">(initialTab);
  /**
   * Which games' rulebooks have been rendered this session.
   *
   * This is what unlocks the acknowledgement on the Review step: a team has to have
   * had *its own game's* rulebook in front of it before it can say it read the rules.
   * Tracked per game rather than as one flag, because reading the Rocket League rules
   * says nothing about the EA FC rules. It is session state rather than part of the
   * draft because it describes what happened on screen, not an answer the captain
   * gave.
   */
  const [viewedGames, setViewedGames] = React.useState<ReadonlySet<string>>(new Set());
  const markViewed = React.useCallback((gameId: string) => {
    setViewedGames((current) => (current.has(gameId) ? current : new Set(current).add(gameId)));
  }, []);

  /** Which game the rulebook tab is showing. Null means "pick one". */
  const [readingGame, setReadingGame] = React.useState<string | null>(null);

  /**
   * The game the captain has chosen, reported up by the form.
   *
   * The draft itself lives in `RegistrationForm`, and the wizard deliberately does not
   * read it — but it needs the game id to preselect the right rulebook and to point
   * the Review step's link at the right document. One callback is cheaper than two
   * components reading the same browser storage and disagreeing.
   */
  const [chosenGameId, setChosenGameId] = React.useState<string | null>(null);

  /**
   * Open the rulebook at a particular game.
   *
   * The Review step's link calls this, so a captain who is told to read the EA FC
   * rules lands on the EA FC rules rather than a chooser they have to navigate.
   */
  const openRulebookFor = React.useCallback((gameId: string) => {
    setReadingGame(gameId);
    setTab("rules");
  }, []);

  /**
   * Back to the form, at the step the captain left it on.
   *
   * `formTab` is which *form* they were using; the step inside it is the form's own state and
   * is preserved because the form is hidden rather than unmounted. So a captain who was on
   * the submission step, went to read the rules, and presses the continue button lands back
   * on the submission step — with the acknowledgement now unlocked, because `viewedGames`
   * gained their game while they were away.
   *
   * `readingGame` is cleared so a later visit to this tab opens on the captain's own game
   * again, rather than re-opening whichever document they last peeked at.
   */
  const backToForm = React.useCallback(() => {
    setReadingGame(null);
    setTab(formTab);
  }, [formTab]);

  /* The landing page shows first, unless the confirmation email sent the captain
     straight to the edit flow. */
  const [started, setStarted] = React.useState(skipLanding || initialTab === "edit");

  /**
   * **The `?tab=register` deep link is consumed once.**
   *
   * "View form" in the console links to `/?tab=register` so an organiser lands on the
   * form rather than the landing page. That query string then stayed in the address
   * bar, so pressing refresh re-opened the form — and to anyone else, or to the same
   * person later, the site appeared to have forgotten it has a home page.
   *
   * The address is rewritten as soon as the form is on screen. The link still does its
   * job on the way in; a refresh afterwards lands on the landing page.
   *
   * The same rewrite already runs in `<head>` (`layout.tsx`), before Next.js hydrates.
   * This effect is the fallback for a browser that blocked the inline script; it also
   * keeps `?lang=` rather than replacing the whole query string, so an English link
   * does not quietly revert to the stored language on the next load.
   *
   * `replaceState`, not `pushState`: this corrects the current history entry rather
   * than adding one, so Back still returns to wherever the visitor came from instead
   * of bouncing between `?tab=register` and `/`.
   *
   * The edit deep link (`?tab=edit`, from the confirmation email) is deliberately
   * *not* rewritten — that address is meant to be reopened, and a captain who
   * refreshes it is still trying to reach their own registration.
   */
  React.useEffect(() => {
    if (!skipLanding) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== "register") return;
    url.searchParams.delete("tab");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [skipLanding]);

  const enter = (next: "register" | "edit" | "rules") => {
    setTab(next);
    if (next !== "rules") setFormTab(next);
    setStarted(true);
    window.scrollTo({ top: 0 });
  };

  const tabs = [
    { id: "register" as const, label: t("wizard.newTab"), icon: ClipboardList },
    { id: "edit" as const, label: t("wizard.editTab"), icon: PencilLine },
    /* Always offered, even before a document is published.
     *
     * It used to appear only once a rulebook existed, on the reasoning that there is
     * nothing to read without one. That was wrong in practice: the tab is how anyone
     * discovers the rulebook exists at all, so hiding it until an upload has happened
     * means nobody can find where the rulebook lives — the feature looks absent rather
     * than empty. The panel itself explains when nothing is published. */
    { id: "rules" as const, label: t("rulebook.tab"), icon: BookOpen },
  ];

  return (
    <div className="relative min-h-screen">
      <WaveWall />

      {!started ? (
        /* **No top padding on this branch.**
           The form below sits in a padded shell, but the landing measures its own space
           from the top of the page: `.hero-crown-space` is exactly the crown's lower edge
           plus the gap, so any padding above it would be added to that gap. With the
           shell's `py-8 lg:py-12` still on, the gap measured 143px and 159px — the 110px
           asked for plus 33 or 49px of shell that nobody could see the source of. */
        <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6 lg:pb-12 3xl:max-w-7xl 4xl:max-w-[96rem]">
          <Landing
            config={config}
            logoVersions={logoVersions}
            sponsorLogoVersions={sponsorLogoVersions}
            onRegister={() => enter("register")}
            onEdit={() => enter("edit")}
            onRules={() => enter("rules")}
          />
        </div>
      ) : (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12 3xl:max-w-7xl 3xl:py-14 4xl:max-w-[96rem]">
        {/* ---------------------------- Header ---------------------------- */}
        <header className="mb-6 flex flex-col items-center text-center">
          {/* **The logo is the way back.** Pressing it returns to the landing page.
              The landing route sets `started` and never clears it, and the URL never
              changes, so without this the only way home was a page refresh — and the
              "Back to start" string the dictionaries already carried had nowhere to be
              rendered. A logo meaning "home" is the convention people already try. */}
          <button
            type="button"
            onClick={() => {
              setStarted(false);
              setTab("register");
              setFormTab("register");
              window.scrollTo({ top: 0 });
            }}
            aria-label={t("home.back")}
            title={t("home.back")}
            className="rounded-2xl transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:outline-none"
          >
            <TournamentLogo name={config.tournamentName} tagline={config.tagline} size="lg" />
          </button>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ash">
            {t("wizard.intro", { tournament: config.tournamentName })}
          </p>
        </header>

        {!formOpen ? (
          <ClosedPanel config={config} />
        ) : (
          <>
            {/* An organiser is working after the public window has closed. Said
                plainly, because otherwise the form looks like it failed to notice the
                setting — and an organiser should know entries made here are real, not a
                preview. */}
            {previewingClosed && (
              <div className="mb-5 flex flex-wrap items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-amber-100">{t("preview.title")}</p>
                  <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-amber-100/80">
                    {t("preview.body")}
                  </p>
                </div>
              </div>
            )}

            {/* ----------------------------- Tabs ----------------------------- */}
            <nav
              /* Mirrored for the same reason the reading direction is: the
                 active tab sits at the reading start, which is the right in
                 Arabic and the left in English. */
              dir={rtl ? "rtl" : "ltr"}
              className="mx-auto mb-6 flex w-full max-w-md gap-1.5 rounded-2xl border border-[rgba(79, 182, 208,0.16)] bg-wall-950/50 p-1.5"
              aria-label={t("wizard.tabsLabel")}
            >
              {tabs.map((entry) => {
                const Icon = entry.icon;
                const active = tab === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setTab(entry.id);
                      /* Remember the last real form, so leaving the rulebook returns
                         to the form they were using rather than always to
                         "New registration". */
                      if (entry.id !== "rules") setFormTab(entry.id);
                    }}
                    /* **Three tabs do not fit across a narrow phone.**
                       "New registration", "Edit my registration" and "Rulebook" side by
                       side needed more width than a 360px screen has, and because a flex
                       child will not shrink below its own text the row pushed the whole
                       page sideways — the document became 13px wider than the viewport,
                       so the layout scrolled horizontally and looked like a desktop page
                       on a phone. Below `sm` the tabs now stack each icon over its label
                       and shrink the type, which fits at any phone width; from `sm` up
                       they return to the side-by-side row they were designed as. */
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[0.625rem] leading-tight font-bold tracking-wide transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-xs",
                      active
                        ? "bg-brand/14 text-brand"
                        : "text-ash hover:bg-wall-700/50 hover:text-snow",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="min-w-0">{entry.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* The form stays mounted while the rulebook is open, merely hidden, so
                nothing typed is lost when a team goes to read the rules. */}
            <div className={tab === "rules" ? "hidden" : undefined}>
              {formTab === "register" ? (
                <RegistrationForm
                  config={config}
                  logoVersions={logoVersions}
                  mode="create"
                  rulebooks={rulebooks}
                  gamesRead={viewedGames}
                  onOpenRulebook={openRulebookFor}
                  onGameChange={setChosenGameId}
                />
              ) : (
                <EditFlow
                  config={config}
                  logoVersions={logoVersions}
                  adminHref={adminHref}
                  initialReference={initialReference}
                />
              )}
            </div>

            {tab === "rules" && (
              <RulebookPanel
                games={config.games.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  rulebook: rulebooks[entry.id] ?? null,
                }))}
                /* Preselect the game the captain has already chosen, so the common
                   case is one click rather than a chooser. */
                initialGameId={readingGame ?? chosenGameId}
                viewed={viewedGames}
                onViewed={markViewed}
                onContinue={backToForm}
              />
            )}
          </>
        )}

        {/* The same footer as the landing page, so the policy, contact details and
            language switch do not disappear the moment a captain starts filling in
            the form. It replaces the bare one-line note that used to sit here. */}
        <SiteFooter config={config} logoVersions={sponsorLogoVersions} />
      </div>
      )}
    </div>
  );
}

/** Shown instead of the form when the organisers have closed registration. */
function ClosedPanel({ config }: { config: TournamentConfig }) {
  const { t } = useLanguage();

  return (
    <div className="panel mx-auto max-w-xl rounded-3xl p-8 text-center">
      {/* A red warning mark, not the tournament logo.
          The logo read as branding — the same mark appears above a working form, so a
          closed window looked like an empty one that had failed to load. The icon and
          its colour say "stopped" before the heading is read, in both languages. */}
      <span className="mx-auto flex size-16 items-center justify-center rounded-full border border-danger/40 bg-danger/12">
        <TriangleAlert className="size-8 text-danger" strokeWidth={2} aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-xl tracking-wide text-snow">
        {t("closed.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ash">{config.closedMessage}</p>
    </div>
  );
}
