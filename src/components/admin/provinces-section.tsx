"use client";

import * as React from "react";
import { MapPin, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { REGION_LABEL, SAUDI_REGIONS, type SaudiRegion } from "@/lib/regions";
import { UNIVERSITIES } from "@/lib/universities";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxField } from "@/components/ui/checkbox";
import { Pill, SectionCard } from "./controls";
import type { SectionProps } from "./general-section";

/** How many institutions each province actually brings to the tournament. */
const UNIVERSITY_COUNT: Record<string, number> = UNIVERSITIES.reduce<Record<string, number>>(
  (counts, university) => {
    counts[university.region] = (counts[university.region] ?? 0) + 1;
    return counts;
  },
  {},
);

export function ProvincesSection({ config, patch }: SectionProps) {
  const allOpen = config.allowedRegions.length === 0;

  const toggle = (region: SaudiRegion, enabled: boolean) => {
    const next = enabled
      ? Array.from(new Set([...config.allowedRegions, region]))
      : config.allowedRegions.filter((entry) => entry !== region);
    patch("allowedRegions", next);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Eligible provinces"
        description="A member qualifies through the province of their university. Tick the provinces this tournament is open to; leave everything unticked to accept the whole country."
        action={
          <div className="flex items-center gap-2">
            {allOpen ? <Pill tone="brand">All provinces open</Pill> : <Pill tone="muted">{config.allowedRegions.length} open</Pill>}
            {!allOpen && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => patch("allowedRegions", [])}
              >
                <RotateCcw className="size-3.5" />
                Open all
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SAUDI_REGIONS.map((region) => {
            const enabled = config.allowedRegions.includes(region);
            const count = UNIVERSITY_COUNT[region] ?? 0;
            return (
              <label
                key={region}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                  enabled
                    ? "border-brand/50 bg-brand/8"
                    : "border-[rgba(148,196,208,0.14)] bg-wall-950/40 hover:border-brand/40",
                )}
              >
                <Checkbox
                  checked={enabled}
                  onChange={(checked) => toggle(region, checked)}
                  aria-label={`${REGION_LABEL[region]} may enter`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-xs font-semibold",
                      enabled ? "text-brand" : "text-snow",
                    )}
                  >
                    {REGION_LABEL[region]}
                  </span>
                  <span className="block font-mono text-[10px] text-ash">
                    {count} universit{count === 1 ? "y" : "ies"}
                  </span>
                </span>
                <MapPin className={cn("size-3.5 shrink-0", enabled ? "text-brand" : "text-ash/40")} />
              </label>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-ash/80">
          A closed province disappears from the form entirely: its universities are removed from the
          roster step&apos;s list rather than shown greyed out, so a captain cannot pick one and the
          roster step never has to refuse it. Provinces with no institutions in the list have nothing
          to exclude today, but stay ticked-safe if you add a university there.
        </p>
      </SectionCard>

      <SectionCard
        title="Roster composition"
        description="How much freedom a captain has when building their roster."
      >
        <CheckboxField
          checked={config.allowMixedUniversities}
          onChange={(checked) => patch("allowMixedUniversities", checked)}
          label="Allow members from different universities"
          hint="On: a roster may mix institutions, and every member picks their own university. Off: all members must study at the same university."
        />
      </SectionCard>
    </div>
  );
}
