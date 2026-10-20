"use client";

import * as React from "react";
import { Building2, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { REGION_LABEL, SELECTABLE_REGIONS, type SaudiRegion } from "@/lib/regions";
import { UNIVERSITIES, type University } from "@/lib/universities";
import { slugify } from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyNote, Pill, SectionCard, Setting } from "./controls";
import type { SectionProps } from "./general-section";

const EMPTY_DRAFT = {
  name: "",
  city: "",
  region: "Riyadh" as SaudiRegion,
  sector: "Government" as University["sector"],
  emailDomain: "",
};

export function UniversitiesSection({ config, patch }: SectionProps) {
  const [query, setQuery] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState(EMPTY_DRAFT);

  const hidden = new Set(config.hiddenUniversities);
  const needle = query.trim().toLowerCase();

  /* A province the organisers closed takes its institutions off the list
     entirely. They used to stay visible, struck through and unselectable, which
     read as a puzzle rather than a rule — and gave the misleading impression
     that a captain could still choose one. */
  const closedByProvince = (university: University) =>
    config.allowedRegions.length > 0 && !config.allowedRegions.includes(university.region);

  const available = UNIVERSITIES.filter((university) => !closedByProvince(university));
  const provinceHidden = UNIVERSITIES.length - available.length;

  const filtered = available.filter(
    (university) =>
      !needle ||
      university.name.toLowerCase().includes(needle) ||
      university.city.toLowerCase().includes(needle) ||
      university.region.toLowerCase().includes(needle),
  );

  const toggle = (id: string, enabled: boolean) => {
    patch(
      "hiddenUniversities",
      enabled ? config.hiddenUniversities.filter((entry) => entry !== id) : [...config.hiddenUniversities, id],
    );
  };

  const commit = () => {
    const name = draft.name.trim();
    if (name.length < 3) return;

    const domains = draft.emailDomain
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain));

    const taken = new Set([...UNIVERSITIES, ...config.extraUniversities].map((u) => u.id));
    const base = slugify(name) || "university";
    let id = base;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }

    patch("extraUniversities", [
      ...config.extraUniversities,
      {
        id,
        name,
        city: draft.city.trim() || "—",
        region: draft.region,
        sector: draft.sector,
        emailDomains: domains,
        addedByOrganisers: true,
      },
    ]);

    setDraft(EMPTY_DRAFT);
    setAdding(false);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="University list"
        description="Captains pick from this list per member — they cannot add institutions themselves. Close the ones this tournament does not accept, or add one that is missing."
        action={
          <div className="flex items-center gap-2">
            <Pill tone="muted">
              {available.length - config.hiddenUniversities.length} open
            </Pill>
            {provinceHidden > 0 && (
              <Pill tone="warn">{provinceHidden} closed by province</Pill>
            )}
            {config.hiddenUniversities.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => patch("hiddenUniversities", [])}
              >
                <RotateCcw className="size-3.5" />
                Reopen all
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding((value) => !value)}
            >
              <Plus className="size-3.5" />
              Add university
            </Button>
          </div>
        }
      >
        {adding && (
          <div className="animate-rise panel-inset mb-4 space-y-4 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold tracking-[0.14em] text-brand uppercase">
                New institution
              </p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Cancel"
                onClick={() => {
                  setAdding(false);
                  setDraft(EMPTY_DRAFT);
                }}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Setting
                label="Name"
                required
                maxLength={90}
                value={draft.name}
                placeholder="e.g. King Salman University"
                onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
              />
              <Setting
                label="City"
                maxLength={60}
                value={draft.city}
                placeholder="e.g. Riyadh"
                hint="Shown beside the name in the picker."
                onChange={(value) => setDraft((current) => ({ ...current, city: value }))}
              />
              <Setting
                label="Email domain"
                value={draft.emailDomain}
                placeholder="ksu.edu.sa"
                hint="Comma-separated. Used for the soft “wrong university” warning."
                onChange={(value) => setDraft((current) => ({ ...current, emailDomain: value }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <span className="block text-[11px] font-bold tracking-[0.12em] text-ash uppercase">
                    Province
                  </span>
                  <Select
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value as SaudiRegion }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_REGIONS.map((region) => (
                        <SelectItem key={region} value={region}>
                          {REGION_LABEL[region]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <span className="block text-[11px] font-bold tracking-[0.12em] text-ash uppercase">
                    Sector
                  </span>
                  <Select
                    value={draft.sector}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        sector: value as University["sector"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Government">Government</SelectItem>
                      <SelectItem value="Private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={draft.name.trim().length < 3} onClick={commit}>
                <Plus className="size-3.5" />
                Add to the list
              </Button>
            </div>
          </div>
        )}

        {config.extraUniversities.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">
              Added by organisers
            </p>
            {config.extraUniversities.map((university) => (
              <div
                key={university.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/25 bg-brand/6 p-3"
              >
                <Building2 className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-snow">
                    {university.name}
                  </span>
                  <span className="block font-mono text-[10px] text-ash">
                    {university.city} · {university.region}
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${university.name}`}
                  onClick={() =>
                    patch(
                      "extraUniversities",
                      config.extraUniversities.filter((entry) => entry.id !== university.id),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ash" />
          <Input
            value={query}
            placeholder="Search by name, city or province…"
            onChange={(event) => setQuery(event.target.value)}
            className="pl-10"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyNote>No institution matches “{query}”.</EmptyNote>
        ) : (
          <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {filtered.map((university) => {
              const open = !hidden.has(university.id);
              return (
                <label
                  key={university.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                    open
                      ? "border-[rgba(148,196,208,0.14)] bg-wall-950/40 hover:border-brand/40"
                      : "border-danger/25 bg-danger/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(event) => toggle(university.id, event.target.checked)}
                    aria-label={`${university.name} may enter`}
                    className="size-4 shrink-0 cursor-pointer accent-[#5cf0f7]"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-xs font-semibold",
                        open ? "text-snow" : "text-ash/70",
                      )}
                    >
                      {university.name}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-ash">
                      {university.city} · {university.region}
                      {university.womenOnly && " · women only"}
                    </span>
                  </span>
                  {!open && (
                    <span className="shrink-0 rounded-full border border-danger/30 bg-danger/8 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-danger uppercase">
                      Closed
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
