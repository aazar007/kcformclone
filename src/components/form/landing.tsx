"use client";

import * as React from "react";
import { ArrowRight, BookOpen, ClipboardList, ExternalLink, PencilLine, Play, ShieldAlert, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TournamentConfig } from "@/lib/tournament";
import { sponsorRoleLabel } from "@/lib/i18n";
import { totalPrizePool } from "@/lib/prize-total";
import { CrownReveal } from "@/components/brand/crown-reveal";
import { useLanguage } from "./language-provider";
import { SiteFooter } from "./site-footer";

/** Scroll-reveal: plays the entrance animation once the element enters the viewport. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [seen, setSeen] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
      className={cn(seen ? "hero-in" : "opacity-0", className)}
    >
      {children}
    </div>
  );
}

/**
 * The spinning crown, fixed behind the page.
 *
 * It starts at hero size and, as the page scrolls, grows and dims until it fills the
 * background. Scroll progress is written to a CSS variable (`--p`, 0 to 1 over the first
 * screen and a bit) so the browser does the interpolation; no React state changes per frame.
 */
function ScrollCrown({ label }: { label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* The crown eases toward the scroll position instead of jumping to it, so wheel
       notches and touch flings read as one continuous movement rather than steps. */
    let frame = 0;
    let target = 0;
    let current = 0;
    const tick = () => {
      current += (target - current) * 0.1;
      if (Math.abs(target - current) < 0.0005) current = target;
      el.style.setProperty("--p", current.toFixed(4));
      frame = current === target ? 0 : requestAnimationFrame(tick);
    };
    const update = () => {
      target = Math.min(1, window.scrollY / (window.innerHeight * 1.2));
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onScroll = update;

    target = current = Math.min(1, window.scrollY / (window.innerHeight * 1.2));
    el.style.setProperty("--p", current.toFixed(4));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className="scroll-crown">
      {/* Fade-in lives on an inner element: its `forwards` fill would otherwise pin the
          opacity and transform that the scroll position drives on the outer one. */}
      {/* The WebP carries its own alpha, so there is no backdrop to blend away. Nothing sits
          behind it: a still underneath showed through the spinning crown's edges. */}
      <div className="hero-in size-full" style={delay(0)}>
        <img src="/crown-spin.webp?v=4" alt={label} width={720} height={480} className="size-full object-contain" />
      </div>
    </div>
  );
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export function Landing({
  config,
  logoVersions = {},
  sponsorLogoVersions = {},
  onRegister,
  onEdit,
  onRules,
}: {
  config: TournamentConfig;
  /**
   * Which games have a logo stored, and the version of each.
   *
   * The version is part of the URL so a replaced logo is not served from cache — the
   * same reason the console bumps it, read here instead of guessed.
   */
  logoVersions?: Record<string, number>;
  /** The same, for sponsors: sponsor id → cache-busting version. */
  sponsorLogoVersions?: Record<string, number>;
  onRegister: () => void;
  onEdit: () => void;
  onRules: () => void;
}) {
  const { t, rtl, language } = useLanguage();
  const open = config.registrationOpen;
  /* Null unless at least one game has a prize the organisers wrote down. A total of
     nothing is not a headline, so the card is left out rather than printed as "0". */
  const prize = totalPrizePool(config.games);

  return (
    <div className="relative">
      {/* **Start the logo requests while the HTML is still being parsed.**
          These come from `/api/games/[id]/logo`, which reads the bytes out of the
          database — a round trip each, and they used to begin only after React had
          hydrated and the cards had rendered, so the pictures arrived last on an
          otherwise finished page. A preload hint starts each one immediately, in parallel
          with everything else. The `?v=` is the same cache-busting version the card uses,
          so this can never warm a stale URL. */}
      {config.sponsors
        .filter((sponsor) => sponsorLogoVersions[sponsor.id] !== undefined)
        .map((sponsor) => (
          <link
            key={sponsor.id}
            rel="preload"
            as="image"
            href={`/api/sponsors/${encodeURIComponent(sponsor.id)}/logo?v=${sponsorLogoVersions[sponsor.id]}`}
          />
        ))}
      {config.games
        .filter((game) => logoVersions[game.id] !== undefined)
        .map((game) => (
          <link
            key={game.id}
            rel="preload"
            as="image"
            href={`/api/games/${encodeURIComponent(game.id)}/logo?v=${logoVersions[game.id]}`}
          />
        ))}
      <ScrollCrown label={config.tournamentName} />
      <div className="relative z-10">
      <section className="relative flex min-h-[88vh] flex-col items-center overflow-x-clip px-2 pb-10 text-center">
        {/* Keeps the crown's place in the layout; the crown itself is the fixed layer
            below.

            **The height has to track the crown, not be a constant.** The crown is
            `position: fixed` and sized from the viewport (`min(110vw, 720px)`), while this
            spacer used to be a flat 288px. At 768px wide the crown's lower edge fell at
            446px and the headline started at 439px — a 7px overlap, and the 9px that was
            left at 1280px was not enough for Arabic, whose diacritics (the shadda in
            كوّن, the marks on فريقك) draw above the text box. `.hero-crown-space` mirrors
            the crown's own geometry, so the gap is the same at every width in both
            languages. */}
        <div aria-hidden className="hero-crown-space" />

        {/* **Sized by screen, not by breakpoint luck.**
            The old steps stopped at `sm:text-6xl` and never moved again, so a 1920 or
            2560 display showed a laptop heading over a 1152px column. The extra steps are
            Tailwind's `3xl`/`4xl`, added in `globals.css` at 1920/2560. `max-w` grows with
            the type so the line length stays balanced instead of wrapping into a ribbon.

            **The heading is revealed by the crown**, which replaces the old fade-in:
            the sentence is painted once and a mask of measured letters opens behind the
            travelling mark. The `hero-in` animation is dropped here rather than stacked
            on top, because two entrances on one element would fight — and its opacity
            would hide the mask while it ran. */}
        <h1 className="font-display max-w-3xl text-4xl leading-tight sm:text-5xl md:text-6xl xl:max-w-4xl xl:text-7xl 3xl:max-w-6xl 3xl:text-8xl 4xl:text-9xl">
          <CrownReveal text={t("home.headline")} rtl={rtl} />
        </h1>

        <p className="hero-in mt-5 max-w-xl text-sm leading-relaxed text-ash sm:text-base xl:max-w-2xl xl:text-lg 3xl:max-w-3xl 3xl:text-xl" style={delay(550)}>
          {t("home.sub", { tournament: config.tournamentName })}
        </p>

        <div className="hero-in mt-8 flex flex-wrap items-center justify-center gap-3" style={delay(700)}>
          <button
            type="button"
            onClick={onRegister}
            className="sheen brand-glow group relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-brand px-7 py-3.5 text-sm font-bold text-wall-950 transition-transform hover:scale-[1.04] active:scale-95 3xl:gap-3 3xl:px-10 3xl:py-5 3xl:text-base"
          >
            <ClipboardList className="size-4" />
            {t("home.cta")}
            <ArrowRight
              className={cn("size-4 transition-transform", rtl ? "rotate-180 group-hover:-translate-x-1" : "group-hover:translate-x-1")}
            />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(79, 182, 208,0.25)] bg-wall-950/50 px-5 py-3.5 text-sm font-bold text-snow transition hover:border-brand/50 hover:text-brand"
          >
            <PencilLine className="size-4" />
            {t("home.ctaEdit")}
          </button>
          <button
            type="button"
            onClick={onRules}
            className="inline-flex items-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold text-ash transition hover:text-snow"
          >
            <BookOpen className="size-4" />
            {t("home.ctaRules")}
          </button>
        </div>

        {/* Said before anyone starts. A team is registered once, by its leader —
            a second entry is how a squad ends up disqualified, so the rule is
            stated where the decision is made rather than buried in the rules tab. */}
        <p
          className="hero-in mt-6 flex max-w-xl items-start gap-2 rounded-xl border border-amber-400/45 bg-amber-400/10 px-3.5 py-2.5 text-start text-[0.6875rem] leading-relaxed text-amber-100/90"
          style={delay(780)}
        >
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-300" />
          <span>{t("home.leaderWarning")}</span>
        </p>

        {/* The open/closed notice belongs under the buttons, not above the headline.
            Up there it was the first thing read, which promised a status before saying
            what the page was for — and it sat where a caption for the headline would be,
            so it explained the wrong thing. Here it qualifies the actions: press one of
            these, and this is whether it will work. */}
        <div
          className="hero-in mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-wall-950/60 px-4 py-1.5 text-xs font-bold tracking-wide text-snow"
          style={delay(850)}
        >
          <span className={cn("hero-ping size-2 rounded-full", open ? "bg-ok" : "bg-danger")} />
          {open ? t("home.badgeOpen") : t("home.badgeClosed")}
        </div>

        {/* **The live notice lives here, on the landing page only.**
            It is deliberately outside the wizard: the registration steps are about
            filling a form, and an announcement about a stream belongs on the page
            that announces the tournament. Independent of the open/closed badge above
            — a tournament is usually live while its registration is closed, but the
            organisers can also announce the stream early.

            `role="status"` with `aria-live="polite"` because this is an announcement:
            a screen reader should say that the tournament is live without the visitor
            having to hunt for it, and politely so it does not interrupt a sentence
            they are already reading. */}
        {config.tournamentLive && (
          <div
            role="status"
            aria-live="polite"
            className="hero-in mt-5 w-full max-w-xl"
            style={delay(950)}
          >
            <div className="relative overflow-hidden rounded-2xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 shadow-[0_24px_60px_-35px_rgba(244,63,94,0.7)]">
              <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-1 text-[0.625rem] font-bold tracking-[0.16em] text-white uppercase">
                  <span aria-hidden className="live-ping size-1.5 rounded-full bg-white" />
                  {t("home.liveBadge")}
                </span>
                <p className="min-w-0 text-sm font-bold text-snow">
                  {/* An empty message uses the dictionary, so the default sentence
                      still reads in Arabic for an Arabic visitor. */}
                  {config.liveMessage || t("home.liveDefault")}
                </p>
              </div>

              {config.watchLinks.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {config.watchLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      /* `target="_blank"` without saying so is the classic
                         accessibility gap: a screen-reader user gets moved to a new
                         tab with no warning and no way back. */
                      aria-label={`${link.label} — ${t("home.liveOpensNewTab")}`}
                      className="group inline-flex items-center gap-1.5 rounded-xl border border-rose-300/35 bg-wall-950/60 px-3.5 py-2 text-xs font-bold text-snow transition-colors hover:border-rose-300/70 hover:text-rose-100"
                    >
                      {sponsorLogoVersions[`channel:${link.id}`] !== undefined ? (
                        /* The channel's own logo, when the organisers uploaded one; the
                           play icon is the fallback for a channel without artwork. Empty
                           alt: the label beside it already names the channel. */
                        <img
                          src={`/api/channels/${encodeURIComponent(link.id)}/logo?v=${sponsorLogoVersions[`channel:${link.id}`]}`}
                          alt=""
                          width={20}
                          height={20}
                          className="size-5 shrink-0 object-contain"
                        />
                      ) : (
                        <Play className="size-3.5 shrink-0 text-rose-300" aria-hidden />
                      )}
                      <span className="min-w-0 truncate">{link.label}</span>
                      <ExternalLink
                        className="size-3 shrink-0 text-ash transition-colors group-hover:text-rose-200"
                        aria-hidden
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* The prize money, between the status badge and the games.
          It answers the question a visitor asks before reading any of the cards — what
          is this worth — and it answers it in one number instead of five, so the games
          below are read as ways in rather than as a price list. The per-card prizes stay
          on the cards; this is the headline.

          Hidden entirely when no game has a figure. A total of nothing is not a
          headline, and "0" would read as a tournament with no prize at all. */}
      {prize && (
        <section className="pb-2">
          <Reveal className="mx-auto max-w-sm 3xl:max-w-md">
            <div className="relative overflow-hidden rounded-3xl border border-amber-300/30 bg-wall-950/60 px-6 py-5 text-center shadow-[0_30px_70px_-40px_rgba(252,211,77,0.55)]">
              {/* Two decorative layers, both `aria-hidden`: a bloom behind the figure and
                  a hairline of gold across the top edge. Everything they do is done in
                  CSS, so neither costs an image request before the number is painted. */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 -top-16 size-40 -translate-x-1/2 rounded-full bg-amber-300/20 blur-3xl"
              />
              <span
                aria-hidden
                className="absolute inset-x-6 top-0 h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, transparent, rgba(252,211,77,0.75), transparent)",
                }}
              />

              <p className="relative flex items-center justify-center gap-2 text-[0.625rem] font-bold tracking-[0.3em] text-amber-200/85 uppercase">
                <Trophy className="size-3.5" aria-hidden />
                {t("home.prizeTotal")}
              </p>

              {/* No `dir` override: the figure is digits plus whatever unit the
                  organisers wrote, and the browser's bidi algorithm already places an
                  Arabic unit on the correct side of a Latin number. */}
              <p className="chrome-text font-display relative mt-2 text-3xl leading-none sm:text-4xl">
                {prize.display}
              </p>

              <p className="relative mt-2 text-[0.6875rem] text-ash">
                {prize.games === 1
                  ? t("home.prizeTotalAcrossOne")
                  : t("home.prizeTotalAcross", { count: prize.games })}
              </p>
            </div>
          </Reveal>
        </section>
      )}

      {config.games.length > 0 && (
        <section className="py-10">
          <Reveal>
            <h2 className="font-display mb-5 text-center text-lg tracking-wide text-snow sm:text-xl">{t("home.gamesTitle")}</h2>
          </Reveal>
          {/* Centre-aligned, not left-aligned. These are posters for four titles rather
              than rows in a list, so the eye should land on the logo and fall straight
              down the middle of the card. `text-start` was inherited from the button's
              default and read as a table column.

              **Small cards, four across.** The card, not just the artwork, was the thing
          {/* Three across at most, and centred when there are fewer.

              **Not a grid.** A grid with `sm:grid-cols-3` pins the first card to the left
              of its column, so a single game sat hard against the left edge of the page.
              Flex with `justify-center` puts one game in the middle, two side by side, and
              three across as more are added — which is what a strip of equal cards should
              do however many there are.

              Deliberately smaller than a sponsor tile (256px): the sponsors are the larger
              element, the game cards are navigation. */}
          <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-3 sm:gap-4 3xl:max-w-5xl 3xl:gap-6">
            {config.games.map((game, i) => (
              <Reveal key={game.id} delay={(i % 3) * 80} className="w-full max-w-56 sm:w-56 3xl:w-72 3xl:max-w-none">
                {/* **Not a button.** Clicking a game card used to open the registration
                    form, which made every card a large accidental trap — a visitor reading
                    the game list would be thrown into the form by a stray tap. The one way
                    in is the Register button below; these are a list of what is on offer. */}
                <div className="panel group relative flex h-full w-full flex-col items-center overflow-hidden rounded-2xl px-4 py-4 text-center">
                  <div
                    className="absolute inset-x-0 top-0 h-0.5 origin-center scale-x-50 transition-transform duration-500 group-hover:scale-x-100"
                    style={{ backgroundImage: `linear-gradient(90deg, ${game.accent[0]}, ${game.accent[1]})` }}
                  />
                  <div
                    className="pointer-events-none absolute -top-8 -end-8 size-20 rounded-full opacity-20 blur-xl transition-opacity duration-500 group-hover:opacity-50"
                    style={{ backgroundImage: `linear-gradient(135deg, ${game.accent[0]}, ${game.accent[1]})` }}
                  />

                  {/* The uploaded logo, when there is one. `logoVersions[game.id]` is only
                      defined for a game that has a stored image, so a game without one
                      simply has no box rather than a broken picture. */}
                  {logoVersions[game.id] !== undefined && (
                    <img
                      src={`/api/games/${encodeURIComponent(game.id)}/logo?v=${logoVersions[game.id]}`}
                      alt=""
                      width={72}
                      height={72}
                      /* `lazy` meant the picture was only asked for once the card
                         scrolled into view — so the first thing a visitor saw was a
                         row of empty cards filling in one by one. These sit just under
                         the hero and there are at most a handful of them, so they are
                         fetched immediately; the preload above starts the same URLs
                         during parsing. */
                      loading="eager"
                      decoding="async"
                      fetchPriority={i < 3 ? "high" : "auto"}
                      className="mb-2.5 size-16 object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-105 sm:size-[4.5rem] 3xl:size-24"
                    />
                  )}

                  <p className="font-display text-sm leading-tight text-snow 3xl:text-base">{game.name}</p>

                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[0.6875rem] text-ash">
                    <span className="rounded-full bg-brand/12 px-2 py-0.5 font-bold text-brand">{game.format}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" />
                      {/* One player is not "1 players". */}
                      {game.squadSize === 1
                        ? t("home.playerOne")
                        : t("home.players", { count: game.squadSize })}
                    </span>
                  </div>

                  {/* Only when the organisers have published one — an empty prize is not
                      announced as "Prize: —". */}
                  {game.prizePool && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[0.625rem] font-bold text-amber-200">
                      <Trophy className="size-3" />
                      {game.prizePool}
                    </p>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* The organisers' sponsors, in place of the "How it works" explainer they asked
          to remove. Hidden entirely when none are configured, so the page does not carry
          an empty heading. */}
      {config.sponsors.length > 0 && (
        <section className="py-12">
          <Reveal>
            {/* One step larger than the games heading above it, and underlined with a
                rule. The sponsors are the reason the tournament exists; the section that
                carries them should read as the more important one before a single tile is
                seen, not only once the artwork is compared. */}
            <h2 className="font-display mb-2 text-center text-2xl tracking-wide text-snow sm:text-3xl">
              {t("home.sponsorsTitle")}
            </h2>
            <div className="chrome-rule mx-auto mb-8 h-px w-28" />
          </Reveal>
          {/* Each tile is a logo box: the role heads it, the name stands in for the mark.
              That is the shape a sponsor strip is read in — tier first, then who — and it
              keeps every tile the same height whether or not the organisers wrote a role. */}
          <ul className="mx-auto flex max-w-3xl flex-wrap items-stretch justify-center gap-3 3xl:max-w-5xl 3xl:gap-5">
            {config.sponsors.map((sponsor, i) => {
              const hasLogo = sponsorLogoVersions[sponsor.id] !== undefined;
              const tile = (
                <>
                  {sponsor.role && (
                    <span className="mb-3 block text-[0.8125rem] font-bold tracking-[0.16em] text-ash uppercase">
                      {sponsorRoleLabel(sponsor.role, language)}
                    </span>
                  )}
                  {hasLogo ? (
                    /* The uploaded artwork. `alt` carries the name, because the image is
                       the logo and a screen reader has nothing else to read.

                       **Sized for a logo, not for an icon.** At 56px the artwork carried the
                       same visual weight as the caption above it, so it read as decoration
                       beside the name rather than as the sponsor's mark.

                       The width is now a fixed 256px, matching the tile, so every sponsor
                       fills its box the same way and a row of them reads as a wall rather
                       than a ragged line of differently-sized marks. `contain` keeps a wide
                       logo whole inside that width instead of cropping it, and the height
                       is capped so a tall mark cannot stretch the tile. */
                    <img
                      src={`/api/sponsors/${encodeURIComponent(sponsor.id)}/logo?v=${sponsorLogoVersions[sponsor.id]}`}
                      alt={sponsor.name}
                      width={256}
                      height={128}
                      loading="eager"
                      decoding="async"
                      className="h-auto max-h-32 w-full object-contain 3xl:max-h-40"
                    />
                  ) : (
                    /* No artwork uploaded yet — the name stands in, in the display face, at
                       a size that keeps a half-filled strip reading as a sponsorship. */
                    <span className="chrome-text block font-display text-xl leading-tight sm:text-2xl">
                      {sponsor.name}
                    </span>
                  )}
                </>
              );
              /* **256px wide, always — every breakpoint, every tile.**
                 A fixed `w-64` rather than a minimum: the tiles are the same size as each
                 other however long a name is, which is what makes a sponsors strip look
                 like a strip. 256px also fits a 360px phone's content width, so the tile
                 no longer stretched to fill the row there while shrinking to 256px on a
                 desktop — it is one width everywhere.

                 The padding is deliberately small. It is subtracted from the tile before the
                 artwork gets anything, so generous padding silently shrank the logo — 256px
                 of tile was showing a 190px mark. */
              const shell =
                "panel-inset flex h-full w-64 flex-col items-center justify-center rounded-2xl px-5 py-5 text-center transition-colors 3xl:w-80 3xl:px-6 3xl:py-6";

              return (
                <li key={sponsor.id}>
                  <Reveal delay={(i % 3) * 100} className="h-full">
                    {sponsor.url ? (
                      <a
                        href={sponsor.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={cn(shell, "hover:border-brand/45 hover:text-brand")}
                      >
                        {tile}
                      </a>
                    ) : (
                      <span className={shell}>{tile}</span>
                    )}
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="py-12">
        <Reveal className="flex justify-center">
          <button
            type="button"
            onClick={onRegister}
            className="sheen brand-glow relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-brand px-7 py-3.5 text-sm font-bold text-wall-950 transition-transform hover:scale-[1.04] active:scale-95"
          >
            {t("home.cta")}
          </button>
        </Reveal>
      </section>

      {/* The footer sits inside the landing column so it lines up with the sections
          above it, rather than spanning the full viewport width behind them. */}
      <SiteFooter config={config} logoVersions={sponsorLogoVersions} />
      </div>
    </div>
  );
}
