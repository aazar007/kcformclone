"use client";

import * as React from "react";
import { Gamepad2, ImagePlus, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENDERS, GENDER_LABEL, type Gender } from "@/lib/games";
import {
  ACCENT_PRESETS,
  DEFAULT_MAX_COACHES,
  DEFAULT_MAX_SUBSTITUTES,
  MAX_ROSTER_LIMIT,
  MAX_SUPPORT_LIMIT,
  slugify,
  type GameDefinition,
} from "@/lib/tournament";
import { LOGO_SIZE } from "@/lib/image";
import { prepareLogo, type PreparedLogo } from "@/lib/logo-prepare";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionCard, Setting, Pill, EmptyNote } from "./controls";
import type { SectionProps } from "./general-section";

/** A blank game, pre-filled so the organiser only has to type the name. */
function newGame(existing: GameDefinition[]): GameDefinition {
  return {
    id: "",
    name: "",
    format: "5v5",
    squadSize: 5,
    maxSubstitutes: DEFAULT_MAX_SUBSTITUTES,
    maxCoaches: DEFAULT_MAX_COACHES,
    accent: ACCENT_PRESETS[existing.length % ACCENT_PRESETS.length].accent,
    divisions: ["male", "female"],
  };
}

/**
 * Make sure a newly named game gets an id that does not collide with the others.
 *
 * An id that already exists is kept, even when the game is renamed: logos are
 * stored against the id, and registrations record it, so re-deriving it from the
 * name would orphan both.
 */
function withUniqueId(game: GameDefinition, index: number, all: GameDefinition[]): GameDefinition {
  const taken = new Set(all.filter((_, i) => i !== index).map((entry) => entry.id));
  if (game.id && !taken.has(game.id)) return game;

  const base = slugify(game.name) || `game-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return { ...game, id };
}

function DivisionToggle({
  game,
  index,
  divisions,
  onToggle,
}: {
  game: GameDefinition;
  index: number;
  divisions: Gender[];
  onToggle: (gender: Gender, enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">Open to</span>
      {divisions.map((gender) => {
        const enabled = game.divisions.includes(gender);
        return (
          <label
            key={gender}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors",
              enabled
                ? "border-brand/50 bg-brand/10 text-brand"
                : "border-[rgba(148,196,208,0.2)] text-ash hover:border-brand/40",
            )}
          >
            <Checkbox
              checked={enabled}
              aria-label={`${GENDER_LABEL[gender]} division may enter ${game.name || "this game"}`}
              onChange={(checked) => onToggle(gender, checked)}
            />
            <span className="text-[11px] font-bold tracking-wide">{GENDER_LABEL[gender]}</span>
          </label>
        );
      })}
      {game.divisions.length === 0 && (
        <span className="text-[10px] text-amber-300">Nobody can enter this game</span>
      )}
    </div>
  );
}

/** One line telling the organiser exactly what happened to their image. */
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
 * A game's logo: upload, replace or remove.
 *
 * The organiser can pick any image. It is prepared in the browser first — the
 * background is removed unless the artwork already has transparency, and the
 * result is fitted to a 512×512 transparent PNG — because the server accepts
 * nothing else. Because the game's id is part of the logo URL, uploading for a
 * game that has never been saved has nowhere to land, so that case is disabled
 * rather than failing.
 */
function GameLogo({
  game,
  secret,
  version,
  onChange,
}: {
  game: GameDefinition;
  secret: string;
  /** The server's cache-busting version, or undefined when no logo is stored. */
  version?: number;
  onChange: (version: number | undefined) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** What the browser is doing right now, shown while `busy`. */
  const [stage, setStage] = React.useState<string | null>(null);
  /** What it did, shown afterwards — "background removed", and so on. */
  const [notice, setNotice] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

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

      const response = await fetch(`/api/admin/games/${encodeURIComponent(game.id)}/logo`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Upload failed.");
        return;
      }

      /* The server's version, so the URL matches what a reload would produce —
         a client-side counter would restart at 0 and reuse a cached image. */
      onChange(typeof payload.version === "number" ? payload.version : Date.now());
      setNotice(describePreparation(prepared));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not prepare that image.");
    } finally {
      setBusy(false);
      setStage(null);
      // Allow re-selecting the same file after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/games/${encodeURIComponent(game.id)}/logo`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not remove the logo.");
        return;
      }
      onChange(undefined);
      setNotice(null);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!game.id) {
    return (
      <span
        className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-[rgba(148,196,208,0.24)] text-ash/50"
        title="Save the game with a name before adding a logo"
      >
        <ImagePlus className="size-5" />
      </span>
    );
  }

  return (
    <div className="shrink-0 space-y-1.5">
      <div className="flex items-center gap-2">
        {/* No filled box behind the logo — it is transparent art, and a shaded
            container reads as part of the picture. The border defines the edge. */}
        <span className="relative flex size-14 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,196,208,0.35)]">
          {version !== undefined ? (
            <img
              src={`/api/games/${encodeURIComponent(game.id)}/logo?v=${version}`}
              alt={`${game.name || "Game"} logo`}
              width={52}
              height={52}
              className="size-[52px] object-contain p-0.5"
            />
          ) : (
            <Gamepad2 className="size-5 text-ash/50" />
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
            className="h-7 justify-start px-2 text-[11px]"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3" />
            {version !== undefined ? "Replace" : "Logo"}
          </Button>
          {version !== undefined && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 justify-start px-2 text-[11px] text-danger"
              disabled={busy}
              onClick={() => void remove()}
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
        <p className="max-w-44 text-[10px] leading-tight text-danger">{error}</p>
      ) : busy && stage ? (
        <p className="max-w-44 text-[10px] leading-tight text-brand">{stage}…</p>
      ) : notice ? (
        <p className="max-w-44 text-[10px] leading-tight text-ash/80">{notice}</p>
      ) : (
        <p className="max-w-44 text-[10px] leading-tight text-ash/70">
          Any size — resized to {LOGO_SIZE}×{LOGO_SIZE}. Background removed automatically.
        </p>
      )}
    </div>
  );
}

export function GamesSection({
  config,
  patch,
  secret,
  logoVersions,
  onLogoVersionsChange,
}: SectionProps & {
  secret: string;
  logoVersions: Record<string, number>;
  onLogoVersionsChange: (versions: Record<string, number>) => void;
}) {
  const [removing, setRemoving] = React.useState<number | null>(null);

  const replace = (index: number, next: GameDefinition) => {
    const games = config.games.map((game, i) => (i === index ? next : game));
    // A new game gets its id derived from its name; an existing one keeps it.
    patch("games", games.map(withUniqueId));
  };

  /** Record that a game's logo changed, so its URL stops being cacheable-as-is. */
  const setLogoVersion = (gameId: string, version: number | undefined) => {
    const next = { ...logoVersions };
    if (version === undefined) delete next[gameId];
    else next[gameId] = version;
    onLogoVersionsChange(next);
  };

  return (
    <SectionCard
      title="Games"
      description="Every game on the registration form lives here. Pick which division may enter each one — a game with no division ticked disappears from the form. A logo is optional; upload any size and the background is removed for you."
      action={
        <div className="flex items-center gap-2">
          <Pill tone="muted">{config.games.length} games</Pill>
          <Pill tone="muted">{Object.keys(logoVersions).length} logos</Pill>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => patch("games", [...config.games, newGame(config.games)])}
          >
            <Plus className="size-3.5" />
            Add game
          </Button>
        </div>
      }
    >
      {config.games.length === 0 ? (
        <EmptyNote>
          No games yet — the form falls back to the built-in list until you add one.
        </EmptyNote>
      ) : (
        <div className="space-y-3">
          {config.games.map((game, index) => {
            const [from, to] = game.accent;
            return (
              <div key={game.id || index} className="panel-inset rounded-2xl p-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <GameLogo
                    game={game}
                    secret={secret}
                    version={game.id ? logoVersions[game.id] : undefined}
                    onChange={(version) => setLogoVersion(game.id, version)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-snow">
                      {game.name || "Untitled game"}
                    </p>
                    <p className="font-mono text-[10px] text-ash">
                      id: {game.id || "—"} · {game.format} · {game.squadSize} on field · {game.maxSubstitutes} sub{game.maxSubstitutes === 1 ? "" : "s"} · {game.maxCoaches} coach{game.maxCoaches === 1 ? "" : "es"}
                    </p>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    {(["male", "female"] as Gender[]).map((gender) => (
                      <span
                        key={gender}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                          game.divisions.includes(gender)
                            ? "border-brand/40 bg-brand/10 text-brand"
                            : "border-[rgba(148,196,208,0.2)] text-ash/50",
                        )}
                      >
                        {GENDER_LABEL[gender]}
                      </span>
                    ))}
                    {removing === index ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            patch(
                              "games",
                              config.games.filter((_, i) => i !== index),
                            );
                            setRemoving(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Cancel"
                          onClick={() => setRemoving(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${game.name}`}
                        onClick={() => setRemoving(index)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Setting
                    label="Name"
                    required
                    maxLength={48}
                    value={game.name}
                    placeholder="e.g. Valorant"
                    onChange={(value) => replace(index, { ...game, name: value })}
                  />
                  <Setting
                    label="Format"
                    maxLength={12}
                    value={game.format}
                    placeholder="5v5"
                    hint="Free text shown on the game card."
                    onChange={(value) => replace(index, { ...game, format: value })}
                  />
                  <Setting
                    label="Players on field"
                    type="number"
                    min={1}
                    max={MAX_ROSTER_LIMIT}
                    value={game.squadSize}
                    hint="The starting line-up; a team must name exactly this many."
                    onChange={(value) => {
                      const parsed = Number.parseInt(value, 10);
                      const squadSize = Number.isFinite(parsed) ? parsed : game.squadSize;
                      /* Shrinking the starting line-up also shrinks the room
                         available for a bench, so keep the two in step. */
                      const room = Math.max(0, MAX_ROSTER_LIMIT - squadSize);
                      replace(index, {
                        ...game,
                        squadSize,
                        maxSubstitutes: Math.min(game.maxSubstitutes, room),
                      });
                    }}
                  />
                  <Setting
                    label="Substitutes allowed"
                    type="number"
                    min={0}
                    max={MAX_SUPPORT_LIMIT}
                    value={game.maxSubstitutes}
                    hint="0 means this game takes no substitutes. Also capped by the maximum roster size."
                    onChange={(value) => {
                      const parsed = Number.parseInt(value, 10);
                      replace(index, {
                        ...game,
                        maxSubstitutes: Number.isFinite(parsed) ? parsed : game.maxSubstitutes,
                      });
                    }}
                  />
                  <Setting
                    label="Coaches allowed"
                    type="number"
                    min={0}
                    max={MAX_SUPPORT_LIMIT}
                    value={game.maxCoaches}
                    hint="Staff, not players. They need no game tag or student ID."
                    onChange={(value) => {
                      const parsed = Number.parseInt(value, 10);
                      replace(index, {
                        ...game,
                        maxCoaches: Number.isFinite(parsed) ? parsed : game.maxCoaches,
                      });
                    }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                  <DivisionToggle
                    game={game}
                    index={index}
                    divisions={GENDERS}
                    onToggle={(gender, enabled) =>
                      replace(index, {
                        ...game,
                        divisions: enabled
                          ? Array.from(new Set([...game.divisions, gender]))
                          : game.divisions.filter((entry) => entry !== gender),
                      })
                    }
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">
                      Accent
                    </span>
                    {ACCENT_PRESETS.map((preset) => {
                      const active = preset.accent[0] === from && preset.accent[1] === to;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          title={preset.label}
                          aria-label={preset.label}
                          aria-pressed={active}
                          onClick={() => replace(index, { ...game, accent: preset.accent })}
                          className={cn(
                            "size-6 rounded-md border transition-transform",
                            active
                              ? "border-brand scale-110"
                              : "border-white/15 hover:border-brand/60",
                          )}
                          style={{
                            backgroundImage: `linear-gradient(140deg, ${preset.accent[0]}, ${preset.accent[1]})`,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
