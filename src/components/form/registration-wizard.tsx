"use client";

import * as React from "react";
import { BookOpen, ClipboardList, Lock, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TournamentConfig } from "@/lib/tournament";
import type { RulebookVersions } from "@/lib/store";
import { WaveWall } from "@/components/brand/wave-wall";
import { KsuCrownMark, TournamentLogo } from "@/components/brand/ksu-crown-logo";
import { RegistrationForm } from "./registration-form";
import { EditFlow } from "./edit-flow";
import { RulebookPanel } from "./rulebook-panel";
import { LanguageProvider, useLanguage } from "./language-provider";
import { LanguageToggle } from "./language-toggle";

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

export function RegistrationWizard({
  config,
  logoVersions,
  rulebooks = {},
  initialTab = "register",
  adminHref = null,
  staffHref = null,
}: {
  config: TournamentConfig;
  /**
   * Games with an uploaded logo, keyed by game id with a cache-busting version.
   * Threaded down so a card only requests an image that exists.
   */
  logoVersions: Record<string, number>;
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
}) {
  return (
    <LanguageProvider>
      <WizardShell
        config={config}
        logoVersions={logoVersions}
        rulebooks={rulebooks}
        initialTab={initialTab}
        adminHref={adminHref}
        staffHref={staffHref}
      />
    </LanguageProvider>
  );
}

function WizardShell({
  config,
  logoVersions,
  rulebooks,
  initialTab,
  adminHref,
  staffHref,
}: {
  config: TournamentConfig;
  logoVersions: Record<string, number>;
  rulebooks: RulebookVersions;
  initialTab: "register" | "edit";
  adminHref: string | null;
  staffHref: string | null;
}) {
  const { t, rtl } = useLanguage();
  useOrganiserShortcut(adminHref, staffHref);
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

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        {/* ---------------------------- Header ---------------------------- */}
        <header className="mb-6 flex flex-col items-center text-center">
          <TournamentLogo name={config.tournamentName} tagline={config.tagline} size="lg" />
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ash">
            {t("wizard.intro", { tournament: config.tournamentName })}
          </p>
          <LanguageToggle className="mt-4" />
        </header>

        {!config.registrationOpen ? (
          <ClosedPanel config={config} />
        ) : (
          <>
            {/* ----------------------------- Tabs ----------------------------- */}
            <nav
              /* Mirrored for the same reason the reading direction is: the
                 active tab sits at the reading start, which is the right in
                 Arabic and the left in English. */
              dir={rtl ? "rtl" : "ltr"}
              className="mx-auto mb-6 flex w-full max-w-md gap-1.5 rounded-2xl border border-[rgba(148,196,208,0.16)] bg-wall-950/50 p-1.5"
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
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold tracking-wide transition-colors",
                      active
                        ? "bg-brand/14 text-brand"
                        : "text-ash hover:bg-wall-700/50 hover:text-snow",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {entry.label}
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
                <EditFlow config={config} logoVersions={logoVersions} adminHref={adminHref} />
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

        <footer className="mt-10 flex items-center justify-center gap-2 text-[11px] text-ash/55">
          <Lock className="size-3" />
          <span>{t("wizard.footerNote")}</span>
        </footer>
      </div>
    </div>
  );
}

/** Shown instead of the form when the organisers have closed registration. */
function ClosedPanel({ config }: { config: TournamentConfig }) {
  const { t } = useLanguage();

  return (
    <div className="panel mx-auto max-w-xl rounded-3xl p-8 text-center">
      <KsuCrownMark size="md" className="mx-auto opacity-90" />
      <h2 className="mt-4 font-display text-xl tracking-wide text-snow">
        {t("closed.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ash">{config.closedMessage}</p>
    </div>
  );
}
