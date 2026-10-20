"use client";

import * as React from "react";
import { Mars, Shield, Sparkles, Venus } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENDERS, type Gender } from "@/lib/games";
import { gamesForDivision } from "@/lib/tournament";
import { normaliseTeamName, TEAM_NAME_MAX } from "@/lib/team-name";
import { revealsImmediately } from "@/lib/validation";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DuplicateBadge } from "./duplicate-badge";
import { useLanguage } from "./language-provider";
import type { StepProps } from "./types";

const DIVISION_ICON: Record<Gender, React.ElementType> = {
  male: Mars,
  female: Venus,
};

const DIVISION_ACCENT: Record<Gender, string> = {
  male: "#5cf0f7",
  female: "#ff8497",
};

export function StepTeam({ config, draft, update, errors, duplicates }: StepProps) {
  const { t } = useLanguage();
  const preview = normaliseTeamName(draft.teamName);

  return (
    <div className="space-y-8">
      <Field
        label={t("team.nameLabel")}
        htmlFor="teamName"
        required
        error={errors.teamName}
        /* Illegal characters and refused language are shown as they are typed, so
           it is obvious the name is being checked at all. */
        immediate={revealsImmediately("teamName", draft.teamName, config.blockedTerms)}
        hint={t("team.nameHint", { max: TEAM_NAME_MAX })}
      >
        <div className="relative">
          <Shield className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-ash" />
          <Input
            id="teamName"
            value={draft.teamName}
            invalid={Boolean(errors.teamName)}
            maxLength={TEAM_NAME_MAX}
            autoComplete="organization"
            placeholder="e.g. Falcons"
            onChange={(event) => update("teamName", event.target.value)}
            /* Reserved at the reading end so a long name cannot run underneath the
               badge, and logical so the reservation follows the direction rather
               than always sitting on the right. */
            className="pe-24 ps-10"
          />
          <DuplicateBadge state={duplicates.teamName} taken={t("dup.nameTaken")} />
        </div>
      </Field>

      {/* Show exactly what the bracket will say, before they move on. */}
      {draft.teamName.trim() && preview !== draft.teamName.trim() && (
        <div className="panel-inset flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-[11px] text-ash">
          <span>{t("team.announcedAs")}</span>
          <span className="rounded-lg border border-brand/35 bg-brand/10 px-2 py-0.5 font-bold text-brand">
            {preview}
          </span>
        </div>
      )}

      <Field
        label={t("team.divisionLabel")}
        required
        error={errors.gender}
        hint={t("team.divisionHint")}
      >
        <div role="radiogroup" aria-label={t("team.divisionLabel")} className="grid gap-3 sm:grid-cols-2">
          {GENDERS.map((gender) => {
            const selected = draft.gender === gender;
            const Icon = DIVISION_ICON[gender];
            const accent = DIVISION_ACCENT[gender];
            const openGames = gamesForDivision(config, gender).length;

            return (
              <button
                key={gender}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update("gender", gender)}
                className={cn(
                  /* Centred, not start-aligned.
                   *
                   * Each option is half the row wide, so start-aligning left the icon
                   * and its label bunched against one edge with a large empty gap beside
                   * them — most visible in Arabic, where the pair sat hard against the
                   * right. `justify-center` centres the icon and the text together as one
                   * group; the label itself is centred too, so the second line (the games
                   * count, empty unless the organiser has filled it in) cannot stretch
                   * its own width and pull the group off-centre. */
                  "group relative overflow-hidden rounded-xl border p-4 text-center transition-all",
                  selected
                    ? "border-brand/70 bg-brand/8 shadow-[0_0_34px_-14px_rgba(92,240,247,0.9)]"
                    : "border-[rgba(148,196,208,0.16)] bg-wall-950/40 hover:border-brand/40 hover:bg-wall-800/60",
                )}
              >
                <div className="flex items-center justify-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors"
                    style={{
                      backgroundColor: selected ? `${accent}22` : "rgba(255,255,255,0.04)",
                      color: selected ? accent : "var(--ash)",
                    }}
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-bold tracking-wide",
                        selected ? "text-brand" : "text-snow",
                      )}
                    >
                      {t(gender === "female" ? "team.female" : "team.male")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ash">
                      {openGames === 1
                        ? t("team.gamesOpenOne")
                        : t("team.gamesOpen", { count: openGames })}
                    </p>
                  </div>
                </div>
                {selected && (
                  <span className="absolute top-3 end-3 flex size-5 items-center justify-center rounded-full bg-brand text-wall-950">
                    <Sparkles className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}
