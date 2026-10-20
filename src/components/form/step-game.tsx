"use client";

import * as React from "react";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { gameById, gamesForDivision, type GameDefinition } from "@/lib/tournament";
import { Field } from "@/components/ui/field";
import { useLanguage } from "./language-provider";
import type { StepProps } from "./types";

function DivisionPills({ game }: { game: GameDefinition }) {
  const { t } = useLanguage();

  return (
    <span className="flex flex-wrap gap-1">
      {game.divisions.map((division) => (
        <span
          key={division}
          className="rounded-full border border-[rgba(148,196,208,0.24)] px-2 py-px text-[10px] font-bold text-ash"
        >
          {/* The whole word, not an initial — "Male"/"Female" in English and
              "ذكر"/"انثى" in Arabic. A single letter reads as an abbreviation the
              reader may not recognise, and English had no such shorthand. */}
          {t(division === "female" ? "team.female" : "team.male")}
        </span>
      ))}
    </span>
  );
}

function GameCard({
  game,
  selected,
  logoVersion,
  onSelect,
}: {
  game: GameDefinition;
  selected: boolean;
  /** Present only when a logo exists — and unique per logo, so replacements appear. */
  logoVersion?: number;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const [from, to] = game.accent;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative overflow-hidden rounded-xl border p-4 text-start transition-all",
        selected
          ? "border-brand/70 shadow-[0_0_34px_-14px_rgba(92,240,247,0.9)]"
          : "border-[rgba(148,196,208,0.16)] hover:border-brand/40",
      )}
      style={selected ? { backgroundColor: `${from}14` } : { backgroundColor: "rgba(14,20,23,0.4)" }}
    >
      {/* per-game accent bar */}
      <span
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {logoVersion !== undefined && (
            /* Only requested when the organisers actually uploaded one, so a game
               without a logo never renders a broken image.

               The logo sits on its own — no filled box behind it — so the artwork
               reads as part of the card rather than as a picture in a frame. The
               border is what gives that transparent art a defined edge against the
               dark wall, and `contain` keeps it from being cropped. */
            <img
              src={`/api/games/${encodeURIComponent(game.id)}/logo?v=${logoVersion}`}
              alt=""
              width={44}
              height={44}
              loading="lazy"
              className="size-11 shrink-0 rounded-xl border border-[rgba(148,196,208,0.35)] object-contain p-0.5"
            />
          )}
          <div className="min-w-0">
            <p className={cn("text-sm font-bold tracking-wide", selected ? "text-brand" : "text-snow")}>
              {game.name}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tracking-wider text-ash">
              {t("game.onField", { format: game.format, count: game.squadSize })}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-brand bg-brand text-wall-950" : "border-[rgba(148,196,208,0.3)]",
          )}
        >
          {selected && <Check className="size-3" />}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.14em] text-ash/70 uppercase">
          {t("game.openTo")}
        </span>
        <DivisionPills game={game} />
      </div>
    </button>
  );
}

export function StepGame({ config, logoVersions, draft, update, errors }: StepProps) {
  const { t } = useLanguage();
  const games = gamesForDivision(config, draft.gender);
  const selected = gameById(config, draft.gameId);
  const squad = selected?.squadSize ?? 1;

  /* Assembled from the chosen game's own allowances, so the sentence names what
     *this* game permits rather than a generic maximum. */
  const squadNote = (() => {
    const base = squad === 1 ? t("game.fieldsOne") : t("game.fieldsMany", { count: squad });

    const extras: string[] = [];
    if (selected?.maxSubstitutes) {
      extras.push(
        selected.maxSubstitutes === 1
          ? t("game.subsOne")
          : t("game.subsMany", { count: selected.maxSubstitutes }),
      );
    }
    if (selected?.maxCoaches) {
      extras.push(
        selected.maxCoaches === 1
          ? t("game.coachesOne")
          : t("game.coachesMany", { count: selected.maxCoaches }),
      );
    }

    if (extras.length === 0) return base;

    /* "A and B" reads as a list in both languages, so the join is a key too. */
    const joined =
      extras.length === 1
        ? extras[0]
        : t("game.listJoin", { first: extras[0], second: extras[1] });

    return base + t("game.mayAdd", { extras: joined });
  })();

  return (
    <div className="space-y-8">
      <Field
        label={t("game.chooseLabel")}
        required
        error={errors.game}
        hint={
          draft.gender
            ? t("game.openForDivision", {
                division:
                  draft.gender === "female" ? t("team.female") : t("team.male"),
              })
            : undefined
        }
      >
        {!draft.gender ? (
          <div className="panel-inset flex items-center gap-3 rounded-xl p-4">
            <AlertCircle className="size-4 shrink-0 text-amber-300" />
            <p className="text-xs text-ash">{t("game.divisionFirst")}</p>
          </div>
        ) : games.length === 0 ? (
          <div className="panel-inset flex items-center gap-3 rounded-xl p-4">
            <AlertCircle className="size-4 shrink-0 text-amber-300" />
            <p className="text-xs text-ash">{t("game.noGames")}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                selected={draft.gameId === game.id}
                logoVersion={logoVersions[game.id]}
                onSelect={() => update("gameId", game.id)}
              />
            ))}
          </div>
        )}
      </Field>

      <div className="panel-inset flex items-start gap-3 rounded-xl p-4">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="text-xs leading-relaxed text-ash">{squadNote}</p>
      </div>
    </div>
  );
}
