"use client";

import * as React from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { LOGO_SIZE } from "@/lib/image";
import { prepareLogo, type PreparedLogo } from "@/lib/logo-prepare";
import { Button } from "@/components/ui/button";

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
 * Upload, replace or remove one logo.
 *
 * The same control the sponsor rows use, parameterised by where the bytes go and where they
 * are read back, so a channel's logo behaves exactly like a sponsor's: the artwork is
 * background-removed and squared to 512×512 in the browser, and the server only ever
 * receives something it will accept.
 *
 * `version` is the server's cache-busting number, or `undefined` when nothing is stored. A
 * logo that fails to load is treated as "none stored" rather than as an error — the bytes
 * can have been pruned since the console loaded, and blaming the organiser for stale state
 * is worse than showing the empty control.
 */
export function LogoControl({
  label,
  uploadUrl,
  imageUrl,
  version,
  onChange,
}: {
  /** What the logo belongs to, for the image's description. */
  label: string;
  /** Admin endpoint: POST uploads, DELETE removes. */
  uploadUrl: string;
  /** Public URL the stored logo is served from, before the `?v=` suffix. */
  imageUrl: string;
  version?: number;
  onChange: (version: number | undefined) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [broken, setBroken] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // A new upload is a new URL; let it be tried even if the last one failed.
  React.useEffect(() => {
    setBroken(false);
  }, [version, imageUrl]);

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

      const response = await fetch(uploadUrl, { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Upload failed.");
        return;
      }

      /* The server's version, not a local counter: a counter would restart at 0 after a
         reload and reuse a year-old cached image. */
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
      const response = await fetch(uploadUrl, { method: "DELETE" });
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

  const showImage = version !== undefined && !broken;

  return (
    <div className="shrink-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="relative flex size-14 shrink-0 items-center justify-center rounded-xl border border-[rgba(79, 182, 208,0.35)]">
          {showImage ? (
            <img
              src={`${imageUrl}?v=${version}`}
              alt={`${label} logo`}
              width={52}
              height={52}
              className="size-[3.25rem] object-contain p-0.5"
              onError={() => {
                setBroken(true);
                onChange(undefined);
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
        <p className="max-w-44 text-[0.625rem] leading-tight text-ash/70">
          Any size — resized to {LOGO_SIZE}×{LOGO_SIZE}. Background removed automatically.
        </p>
      )}
    </div>
  );
}
