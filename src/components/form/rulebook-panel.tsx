"use client";

import * as React from "react";
import { BookOpen, Check, Download, ExternalLink, FileText, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RulebookVersion } from "@/lib/store";
import { RulebookReader } from "./rulebook-reader";
import { useLanguage } from "./language-provider";

export interface RulebookChoice {
  id: string;
  name: string;
  /** Null when the organisers have not uploaded one for this game. */
  rulebook: RulebookVersion | null;
}

/**
 * The rulebook tab: choose a game, then read its rules.
 *
 * Each title is played by different rules and is published separately, so the tab
 * leads with a chooser rather than assuming which document the reader wants. The game
 * they have already entered is preselected, which makes the common path one click.
 *
 * The PDF is served from this origin and drawn page by page onto canvases by
 * `RulebookReader`, rather than pulled into an iframe. The reason is the acknowledgement:
 * "I read the rules" has to be unlocked by something, and the only thing an iframe around
 * the browser's PDF viewer can report is that it *loaded*. Drawing the pages ourselves
 * makes reaching the end of the document observable, keeps the layout the same on a phone
 * as on a desktop, and needs no PDF plugin at all.
 *
 * The viewer is why `X-Frame-Options` is relaxed for the rulebook path alone (see
 * `next.config.mjs`) — the fallback when the in-page reader cannot start is the browser's
 * own viewer, inside a frame the site's blanket `DENY` would otherwise refuse.
 *
 * **The acknowledgement lives on the Review step, not here.** It has to be part of the
 * draft, because that is what validation and the API carry, and the draft belongs to
 * the form. This panel's job is to put the right document in front of the reader and
 * to report when it has been read to the end.
 */
export function RulebookPanel({
  games,
  initialGameId,
  viewed,
  onViewed,
  onContinue,
}: {
  games: RulebookChoice[];
  /** The game to open on — usually the one the captain has entered. */
  initialGameId: string | null;
  /**
   * Games whose rulebook has already been read to the end this session.
   *
   * Passed in rather than tracked locally because this panel unmounts every time the
   * reader leaves the tab: a local `useState` would forget, and the way back would appear
   * to re-lock itself after a trip to another tab.
   */
  viewed: ReadonlySet<string>;
  /** Called with the game id once its document has been read to the end. */
  onViewed: (gameId: string) => void;
  /**
   * Return to the form — the submission page, at whatever step it was on.
   *
   * The form is never unmounted, only hidden, so this restores the step the captain was
   * reading the rules *from* rather than starting them over.
   */
  onContinue?: () => void;
}) {
  const { t } = useLanguage();

  /* Open on the captain's own game when it has a rulebook; otherwise fall back to the
     first game that has one, so the tab is useful rather than a chooser when there is
     only one document in play. */
  const [selected, setSelected] = React.useState<string | null>(() => {
    if (initialGameId && games.some((game) => game.id === initialGameId && game.rulebook)) {
      return initialGameId;
    }
    const firstWithRulebook = games.find((game) => game.rulebook);
    return firstWithRulebook ? firstWithRulebook.id : null;
  });

  /* The Review step's link can arrive while this panel is already mounted, so the
     preselection has to follow it. Only when the target actually has a document —
     otherwise the link would swap the reader onto a game with nothing to show. */
  React.useEffect(() => {
    if (!initialGameId) return;
    if (!games.some((game) => game.id === initialGameId && game.rulebook)) return;
    setSelected(initialGameId);
  }, [initialGameId, games]);

  const anyPublished = games.some((game) => game.rulebook);
  const current = games.find((game) => game.id === selected) ?? null;
  const src = current?.rulebook
    ? `/api/games/${encodeURIComponent(current.id)}/rulebook?v=${current.rulebook.version}`
    : null;
  /** Whether *this* game's document has been read to the end — the same signal that unlocks the
   *  acknowledgement on the submission page. Per game, because it gates that game's box. */
  const hasRead = current ? viewed.has(current.id) : false;

  /* Nothing published for any game. Say so plainly rather than showing a viewer that
     would only render 404s — and say where the rules will appear, because this tab is
     how anyone discovers them. */
  if (!anyPublished) {
    return (
      <div className="panel mx-auto max-w-2xl rounded-3xl p-6 text-center sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[rgba(148,196,208,0.2)] bg-wall-950/60 text-ash">
          <BookOpen className="size-5" />
        </span>
        <h2 className="mt-4 font-display text-lg tracking-wide text-snow">
          {t("rulebook.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ash">
          {t("rulebook.notPublished")}
        </p>
      </div>
    );
  }

  return (
    <div className="panel mx-auto max-w-4xl rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand/40 bg-brand/10 text-brand">
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-display tracking-wide text-snow">{t("rulebook.title")}</h2>
          {current?.rulebook?.title && (
            <p className="mt-0.5 text-xs text-ash">{current.rulebook.title}</p>
          )}
        </div>
        {src && (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={src} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                {t("rulebook.open")}
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={src} download>
                <Download className="size-3.5" />
                {t("rulebook.download")}
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* ---- Choose a game ------------------------------------------------ */}
      <p className="mt-4 text-[11px] font-bold tracking-[0.14em] text-ash uppercase">
        {t("rulebook.chooseGame")}
      </p>
      <div role="tablist" aria-label={t("rulebook.chooseGame")} className="mt-2 flex flex-wrap gap-1.5">
        {games.map((game) => {
          const active = game.id === selected;
          const available = Boolean(game.rulebook);
          return (
            <button
              key={game.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={!available}
              onClick={() => setSelected(game.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs font-bold tracking-wide transition-colors",
                active
                  ? "border-brand/60 bg-brand/12 text-brand"
                  : available
                    ? "border-[rgba(148,196,208,0.16)] text-ash hover:border-brand/40 hover:text-snow"
                    : "cursor-not-allowed border-[rgba(148,196,208,0.1)] text-ash/40",
              )}
            >
              {game.name}
              {/* Say which games have no rules yet, rather than offering a tab that
                  would open nothing. */}
              {!available && (
                <span className="ms-1.5 text-[10px] font-normal">{t("rulebook.none")}</span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90">
        {t("rulebook.intro")}
      </p>

      {src && (
        <>
          {/* Drawn by us rather than framed, because the gate is "reached the end" and a
              native PDF frame cannot report that. `key` forces a fresh document when the
              game changes, so the previous game's rules cannot linger on screen.

              `onReadToEnd` is what marks the game as read — the same signal that unlocks
              the acknowledgement on the submission page. */}
          <RulebookReader
            key={src}
            src={src}
            title={t("rulebook.viewerLabel", { game: current?.name ?? "" })}
            onReadToEnd={() => current && onViewed(current.id)}
          />

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ash/80">
            <FileText className="mt-px size-3.5 shrink-0" />
            <span>{t("rulebook.viewerFallback")}</span>
          </p>

          {/* ---- Back to the form ------------------------------------------
              Reading the rules is something this page asked the captain to leave the form to
              do, so the way back has to be obvious. The tab bar has one, but that tab is
              labelled "New registration" — which reads as *start over* to somebody who has
              just filled in a whole form and is exactly the moment they are most likely to
              give up.

              The unlock signal is the reader reaching the end of the document — the same
              signal that unlocks the acknowledgement on the submission page. Nothing in a
              browser can show that a person *read* a page, so this does not pretend to:
              the copy says the button unlocks once the rulebook has been read to the end,
              and the ticking still happens on the other side. Precisely: `viewed` is per
              game, so switching to a game whose rules have not been reached re-locks this —
              which is right, because those are different rules. */}
          {onContinue && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/6 p-3.5 sm:flex-row sm:items-center sm:gap-4">
              <Button type="button" onClick={onContinue} disabled={!hasRead} className="sm:w-auto">
                {hasRead ? <Check className="size-4" /> : <Lock className="size-4" />}
                {t("rulebook.continue")}
              </Button>
              <p className="text-[11px] leading-relaxed text-ash">{t("rulebook.continueHint")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
