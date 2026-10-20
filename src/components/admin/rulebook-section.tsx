"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Check, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TournamentConfig } from "@/lib/tournament";
import { Pill } from "./controls";

interface RulebookState {
  exists: boolean;
  title?: string;
  size?: number;
  updatedAt?: string;
  version?: number;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The rulebooks teams must read before they can submit — one per game.
 *
 * Each title is played by different rules, so the documents are managed per game
 * rather than as one tournament-wide file. Every game is listed, including the ones
 * without a document, because the point of this screen is to show at a glance what is
 * still missing.
 *
 * Replacing one is a deliberate act: the document defines the rules people are held
 * to, and the acknowledgement is asked for again once it changes.
 */
export function RulebookSection({ config }: { config: TournamentConfig }) {
  const [states, setStates] = React.useState<Record<string, RulebookState>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const entries = await Promise.all(
      config.games.map(async (game) => {
        try {
          const response = await fetch(`/api/admin/games/${encodeURIComponent(game.id)}/rulebook`, {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => ({}))) as RulebookState;
          return [game.id, response.ok ? payload : { exists: false }] as const;
        } catch {
          return [game.id, { exists: false }] as const;
        }
      }),
    );
    setStates(Object.fromEntries(entries));
  }, [config.games]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const upload = async (gameId: string, file: File, title: string) => {
    setBusy(gameId);
    setErrors((current) => ({ ...current, [gameId]: "" }));
    setNotice(null);
    try {
      const form = new FormData();
      form.set("rulebook", file);
      form.set("title", title);

      const response = await fetch(`/api/admin/games/${encodeURIComponent(gameId)}/rulebook`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setErrors((current) => ({
          ...current,
          [gameId]: typeof payload.error === "string" ? payload.error : "Could not store that file.",
        }));
        return;
      }
      setNotice("Published. Teams entering this game must now confirm they read it.");
      await load();
    } catch {
      setErrors((current) => ({ ...current, [gameId]: "We could not reach the server." }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (gameId: string) => {
    setBusy(gameId);
    setErrors((current) => ({ ...current, [gameId]: "" }));
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/games/${encodeURIComponent(gameId)}/rulebook`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setErrors((current) => ({ ...current, [gameId]: "Could not remove the rulebook." }));
        return;
      }
      setNotice("Removed. Teams entering this game are no longer asked to read one.");
      await load();
    } catch {
      setErrors((current) => ({ ...current, [gameId]: "We could not reach the server." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 text-brand" />
          <h3 className="text-sm font-bold tracking-wide text-snow">Rulebooks</h3>
          <Pill tone="brand">
            {Object.values(states).filter((state) => state.exists).length} of {config.games.length}
          </Pill>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ash">
          One document per game. A team must confirm it has read the rules for the game it
          entered, so a game without a rulebook is simply not gated on one.
        </p>

        {notice && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-emerald-300">
            <Check className="mt-px size-3.5 shrink-0" />
            <span>{notice}</span>
          </p>
        )}
      </section>

      {config.games.map((game) => (
        <GameRulebook
          key={game.id}
          gameId={game.id}
          gameName={game.name}
          format={game.format}
          state={states[game.id]}
          busy={busy === game.id}
          error={errors[game.id] || undefined}
          onUpload={(file, title) => void upload(game.id, file, title)}
          onRemove={() => void remove(game.id)}
        />
      ))}

      <section className="panel rounded-2xl p-5">
        <h3 className="text-sm font-bold tracking-wide text-snow">How the gate works</h3>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ash">
          <li>
            • The Rulebook tab on the registration page is always there, whether or not a
            document has been uploaded. It lets the reader choose a game, and says which
            games have no rules published yet.
          </li>
          <li>
            • On the Review step, the acknowledgement names the team&apos;s own game and links to
            that game&apos;s rulebook — a captain who is told to read the EA FC rules lands on
            those, not on a chooser.
          </li>
          <li>
            • The box stays locked until <em>that game&apos;s</em> document has been shown, so a team
            is never in a position to say it read something it was not shown. Reading the
            Rocket League rules does not unlock the EA FC box.
          </li>
          <li>
            • The tick is checked on the server as well, so a hand-made request cannot skip
            it. Replacing a rulebook asks teams to confirm again.
          </li>
        </ul>
      </section>
    </div>
  );
}

/** One game's document: its state, and the controls to replace or remove it. */
function GameRulebook({
  gameId,
  gameName,
  format,
  state,
  busy,
  error,
  onUpload,
  onRemove,
}: {
  gameId: string;
  gameName: string;
  format: string;
  state: RulebookState | undefined;
  busy: boolean;
  error?: string;
  onUpload: (file: File, title: string) => void;
  onRemove: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [title, setTitle] = React.useState("");
  const [fileName, setFileName] = React.useState("");

  /* Seed the title from the stored one so replacing a document does not silently
     erase the name the organisers gave it. */
  React.useEffect(() => {
    if (state?.exists && typeof state.title === "string") setTitle(state.title);
  }, [state?.exists, state?.title]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    onUpload(file, title.trim());
  };

  const published = Boolean(state?.exists);

  return (
    <section className="panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-bold tracking-wide text-snow">
            {gameName}
            <span className="font-mono text-[10px] font-normal text-ash">{format}</span>
            {published ? <Pill tone="brand">Published</Pill> : <Pill tone="muted">None</Pill>}
          </h4>
          {published && (
            <p className="mt-1 text-[11px] text-ash">
              {state?.title ? `${state.title} · ` : ""}
              {state?.size ? formatSize(state.size) : ""}
              {state?.updatedAt
                ? ` · updated ${new Date(state.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`
                : ""}
            </p>
          )}
        </div>
        {published && (
          <div className="flex items-center gap-2">
            <Link
              href={`/api/games/${encodeURIComponent(gameId)}/rulebook`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-brand underline underline-offset-2 hover:text-brand-bright"
            >
              Open
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              className="text-danger hover:bg-danger/10"
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <label
            htmlFor={`rulebook-${gameId}`}
            className="block text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
          >
            PDF file
          </label>
          <input
            ref={fileRef}
            id={`rulebook-${gameId}`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
            className="block w-full cursor-pointer rounded-lg border border-[rgba(148,196,208,0.18)] bg-wall-950/60 px-3 py-2.5 text-xs text-ash file:me-3 file:rounded-md file:border-0 file:bg-brand/15 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-brand"
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor={`rulebook-title-${gameId}`}
            className="block text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
          >
            Title
          </label>
          <Input
            id={`rulebook-title-${gameId}`}
            value={title}
            maxLength={120}
            placeholder={`${gameName} rulebook`}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <Button type="submit" className="h-11" disabled={busy || !fileName}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {published ? "Replace" : "Publish"}
        </Button>
      </form>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <p className={cn("mt-3 text-[11px] leading-relaxed", published ? "text-ash/60" : "text-amber-200/80")}>
        {published
          ? "Teams entering this game must confirm they read this before they can submit."
          : "Not published, so teams entering this game are not asked to read one. Upload a PDF to switch the acknowledgement on for this game only."}
      </p>
    </section>
  );
}
