"use client";

import * as React from "react";
import { ImagePlus, Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  MAX_SPONSORS,
  SPONSOR_NAME_MAX,
  SPONSOR_ROLE_MAX,
  SPONSOR_URL_MAX,
  type Sponsor,
} from "@/lib/tournament";
import { LOGO_SIZE } from "@/lib/image";
import { prepareLogo, type PreparedLogo } from "@/lib/logo-prepare";
import { Button } from "@/components/ui/button";
import { SectionCard, Setting, Pill, EmptyNote } from "./controls";
import type { SectionProps } from "./general-section";

/** The same one-line summary the game logos produce, so both read the same way. */
function describePreparation(prepared: PreparedLogo): string {
  const source = `${prepared.sourceWidth}×${prepared.sourceHeight}`;
  if (prepared.removedBackground) return `Background removed, resized from ${source}.`;
  if (prepared.alreadyTransparent) {
    return prepared.sourceWidth === LOGO_SIZE && prepared.sourceHeight === LOGO_SIZE
      ? "Already a transparent square — used as-is."
      : `Already transparent, resized from ${source}.`;
  }
  return prepared.removalError
    ? `Resized from ${source} — background kept (${prepared.removalError})`
    : `Resized from ${source}.`;
}

/**
 * One sponsor's logo: upload, replace or remove.
 *
 * The game-logo control, re-pointed at a sponsor. It reuses `prepareLogo`, so the
 * artwork is background-removed and squared to 512×512 in the browser before it is
 * sent — which means the organiser sees the result immediately, and the server only ever
 * receives something it will accept.
 *
 * A sponsor with no stored logo simply shows nothing here, and the landing tile falls
 * back to the wordmark — so this is additive rather than required.
 */
function SponsorLogo({
  sponsor,
  version,
  onChange,
}: {
  sponsor: Sponsor;
  /** The server's cache-busting version, or undefined when no logo is stored. */
  version?: number;
  onChange: (version: number | undefined) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  /**
   * Set when the browser could not load the stored logo.
   *
   * Without this the box showed the browser's torn-page icon, which says nothing about
   * what happened or what to do.
   *
   * **A failed load is nearly always "there is no logo", not a fault.** The bytes can be
   * removed by `pruneSponsorLogos`, and the console's map of versions is fixed when the
   * page loads — so a logo deleted in another tab, or by an earlier save, leaves a stale
   * entry that 404s here. Reporting that in red, as an error the organiser has to fix,
   * blamed them for state that was simply out of date.
   *
   * So an error is treated as "forget it": the version is cleared from the parent's map,
   * which is the truth, and the control falls back to the ordinary empty state.
   */
  const [broken, setBroken] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // A new upload is a new URL; let it be tried even if the last one failed.
  React.useEffect(() => {
    setBroken(false);
  }, [version, sponsor.id]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setStage("Reading the image");

    try {
      const prepared = await prepareLogo(file, {
        onProgress: (_fraction, note) => setStage(note),
      });

      setStage("Uploading");

      const form = new FormData();
      form.set("logo", new File([prepared.blob], "logo.png", { type: "image/png" }));

      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsor.id)}/logo`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Upload failed.");
        return;
      }

      /* The server's version, not a local counter: a client-side number would restart at
         0 after a reload and reuse a year-old cached image. */
      onChange(typeof payload.version === "number" ? payload.version : Date.now());
      setNotice(describePreparation(prepared));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not prepare that image.");
    } finally {
      setBusy(false);
      setStage(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/sponsors/${encodeURIComponent(sponsor.id)}/logo`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not remove the logo.");
        return;
      }
      onChange(undefined);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  /* A sponsor that has never been saved has no id to key a logo by — the same trap the
     game logos have, solved the same way rather than by inventing one here. */
  if (!sponsor.id) {
    return (
      <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-[rgba(79, 182, 208,0.24)] text-ash/50">
        <ImagePlus className="size-5" />
      </span>
    );
  }

  const showImage = version !== undefined && !broken;

  return (
    <div className="shrink-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="relative flex size-14 shrink-0 items-center justify-center rounded-xl border border-[rgba(79, 182, 208,0.35)]">
          {showImage ? (
            <img
              src={`/api/sponsors/${encodeURIComponent(sponsor.id)}/logo?v=${version}`}
              alt={`${sponsor.name || "Sponsor"} logo`}
              width={52}
              height={52}
              className="size-[3.25rem] object-contain p-0.5"
              /* A failed load means the stored row is gone. Drop it from the map so the
                 control settles on "no logo" instead of retrying a URL that will never
                 work. `broken` also covers the case where the parent is not controlled,
                 so the placeholder shows either way. */
              onError={() => {
                setBroken(true);
                onChange(undefined);
                /* Drop the "uploaded successfully" line too. It described an earlier
                   upload whose bytes are gone, and leaving it on screen next to an empty
                   box reads as the console contradicting itself — which is exactly how
                   this was reported: a success message and no logo. */
                setNotice(null);
              }}
            />
          ) : (
            <ImagePlus className="size-5 text-ash/50" />
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-wall-950/70">
              <Loader2 className="size-4 animate-spin text-brand" />
            </span>
          )}
        </span>

        <div className="flex flex-col gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 justify-start px-2 text-[0.6875rem]"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3" />
            {showImage ? "Replace" : "Logo"}
          </Button>
          {showImage && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 justify-start px-2 text-[0.6875rem] text-danger"
              disabled={busy}
              onClick={() => void removeLogo()}
            >
              <Trash2 className="size-3" />
              Remove
            </Button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error ? (
        <p className="max-w-44 text-[0.625rem] leading-tight text-danger">{error}</p>
      ) : busy && stage ? (
        <p className="max-w-44 text-[0.625rem] leading-tight text-brand">{stage}…</p>
      ) : notice ? (
        <p className="max-w-44 text-[0.625rem] leading-tight text-ash/80">{notice}</p>
      ) : (
        /* Neutral either way. When the stored logo failed to load this is the whole
           truth — there is nothing to show and the upload button is right there. */
        <p className="max-w-44 text-[0.625rem] leading-tight text-ash/70">
          Any size — resized to {LOGO_SIZE}×{LOGO_SIZE}. Background removed automatically.
        </p>
      )}
    </div>
  );
}

/**
 * The sponsors strip on the landing page.
 *
 * Capped at `MAX_SPONSORS` (9) because the page shows them as one band of cards: past
 * two rows it stops reading as a sponsorship and starts reading as a wall of names. The
 * cap is enforced in `normaliseConfig` too, so the limit holds whatever the console
 * sends.
 *
 * A sponsor carries an uploaded logo, a role line, a name and an optional link. The name
 * is still required and still stands in when no artwork has been uploaded — a sponsor
 * whose logo the organisers have not received yet should read as its name, not as an
 * empty box.
 */
export function SponsorsSection({
  config,
  patch,
  logoVersions = {},
  onLogoVersionsChange,
}: SectionProps & {
  /** Which sponsors already have a stored logo, keyed by id. */
  logoVersions?: Record<string, number>;
  onLogoVersionsChange?: (versions: Record<string, number>) => void;
}) {
  const sponsors = config.sponsors;

  const setLogoVersion = (sponsorId: string, version: number | undefined) => {
    if (!onLogoVersionsChange) return;
    const next = { ...logoVersions };
    if (version === undefined) delete next[sponsorId];
    else next[sponsorId] = version;
    onLogoVersionsChange(next);
  };

  /**
   * A new row gets an id that never changes.
   *
   * **This used to be derived from the name, and that was a bug with teeth.** The id was
   * re-slugged from the name only while it still looked like `sponsor-N`; typing the first
   * letter of "TWISTED MINDS" turned it into `t`, after which it was frozen at `t` for
   * ever. A sponsor's id is what a logo's bytes are keyed by, so any id that changes under
   * an uploaded logo orphans it — and `pruneSponsorLogos` then deletes the bytes on the
   * next save, leaving the console showing a broken image for a logo that was uploaded
   * successfully.
   *
   * The id is internal and never displayed to an entrant, so there is nothing to gain from
   * making it readable. It is opaque and stable: renaming does not touch it, so a logo
   * stays attached to its sponsor.
   */
  const blank = (): Sponsor => {
    const taken = new Set(sponsors.map((sponsor) => sponsor.id));
    let id = "";
    do {
      id = `sponsor-${Math.random().toString(36).slice(2, 10)}`;
    } while (!id || taken.has(id));
    return { id, name: "", role: "", url: "" };
  };

  const update = (index: number, next: Partial<Sponsor>) => {
    patch(
      "sponsors",
      sponsors.map((sponsor, i) => (i === index ? { ...sponsor, ...next } : sponsor)),
    );
  };

  const remove = (index: number) => {
    patch(
      "sponsors",
      sponsors.filter((_, i) => i !== index),
    );
  };

  const add = () => {
    if (sponsors.length >= MAX_SPONSORS) return;
    patch("sponsors", [...sponsors, blank()]);
  };

  /* A name is only a name. It no longer feeds the id, so renaming cannot detach a logo. */
  const rename = (index: number, name: string) => update(index, { name });

  return (
    <SectionCard
      title="Sponsors"
      description="Shown on the landing page, in this order. Up to nine — the strip stops reading as a sponsorship past that. Each sponsor can have an uploaded logo; without one the tile shows the name. Leave the link empty for a sponsor that has no website."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={sponsors.length >= MAX_SPONSORS ? "warn" : "muted"}>
            {sponsors.length}/{MAX_SPONSORS}
          </Pill>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={add}
            disabled={sponsors.length >= MAX_SPONSORS}
          >
            <Plus className="size-3.5" />
            Add sponsor
          </Button>
        </div>
      }
    >
      {sponsors.length === 0 ? (
        <EmptyNote>
          No sponsors yet. The landing page leaves the section out entirely while this
          list is empty, rather than showing an empty heading.
        </EmptyNote>
      ) : (
        <div className="space-y-3">
          {sponsors.map((sponsor, index) => (
            <div key={sponsor.id} className="panel-inset rounded-xl p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-mono text-[0.625rem] text-ash" title={sponsor.id}>
                  {index + 1}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-danger"
                  onClick={() => remove(index)}
                  aria-label={`Remove ${sponsor.name || "this sponsor"}`}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </div>

              <div className="flex flex-wrap items-start gap-4">
                <SponsorLogo
                  sponsor={sponsor}
                  version={logoVersions[sponsor.id]}
                  onChange={(version) => setLogoVersion(sponsor.id, version)}
                />

                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
                  <Setting
                    label="Name"
                    required
                    maxLength={SPONSOR_NAME_MAX}
                    value={sponsor.name}
                    placeholder="e.g. Riyadh Bank"
                    hint="Shown when there is no logo, and as the image's description."
                    onChange={(value) => rename(index, value)}
                  />
                  <Setting
                    label="Role"
                    maxLength={SPONSOR_ROLE_MAX}
                    value={sponsor.role}
                    placeholder="Platinum Sponsor"
                    hint="Heads the tile, above the logo."
                    onChange={(value) => update(index, { role: value })}
                  />
                  <Setting
                    label="Link"
                    maxLength={SPONSOR_URL_MAX}
                    value={sponsor.url}
                    placeholder="https://…"
                    hint="Optional; only https links survive."
                    onChange={(value) => update(index, { url: value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
