"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "@/lib/i18n";
import { useLanguage } from "./language-provider";

/**
 * The Arabic / English switch.
 *
 * Two labelled buttons rather than a dropdown, because the whole point is that
 * someone who cannot read the current language can find their own — and a control
 * showing only the language you are already stuck in is no help. Both names are
 * always visible, each written in its own script.
 *
 * `compact` shrinks it to a single icon that switches to the other language on press,
 * for the landing page. There the labelled pair was reading as a second call to action
 * beside the real one; a corner icon stays available without competing. The icon still
 * carries the target language as its accessible name, and its `title` says which
 * language it switches to, so the reason for the original rule — that you can find your
 * own language without reading the current one — is kept: the label is the *other*
 * language's name, in that language.
 */
export function LanguageToggle({
  className,
  compact = false,
}: {
  className?: string;
  /** Icon-only switch, for corners. */
  compact?: boolean;
}) {
  const { language, setLanguage, t } = useLanguage();

  if (compact) {
    const other = LANGUAGES.find((entry) => entry.id !== language) ?? LANGUAGES[0];
    const current = LANGUAGES.find((entry) => entry.id === language);

    return (
      <button
        type="button"
        onClick={() => setLanguage(other.id)}
        aria-label={t("common.language")}
        title={other.label}
        lang={other.id}
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-[rgba(79, 182, 208,0.22)] bg-wall-950/60 px-2.5 py-1.5 text-ash backdrop-blur transition-colors hover:border-brand/50 hover:text-brand",
          className,
        )}
      >
        <Languages className="size-3.5 shrink-0" aria-hidden />
        {/* The name of the language it switches *to*, not the current one. */}
        <span className="text-[0.6875rem] font-bold tracking-wide">{other.label}</span>
        <span className="sr-only">{current?.english}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn(
        "flex items-center gap-1 rounded-xl border border-[rgba(79, 182, 208,0.18)] bg-wall-950/50 p-1",
        className,
      )}
    >
      <Languages className="mx-1.5 size-3.5 shrink-0 text-ash" aria-hidden />
      {LANGUAGES.map((entry) => {
        const active = entry.id === language;
        return (
          <button
            key={entry.id}
            type="button"
            /* The accessible name is always the English one, so a screen reader
               announces the choice consistently whatever the current language is. */
            aria-label={entry.english}
            aria-pressed={active}
            lang={entry.id}
            onClick={() => setLanguage(entry.id)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[0.6875rem] font-bold tracking-wide transition-colors",
              active ? "bg-brand/14 text-brand" : "text-ash hover:bg-wall-700/50 hover:text-snow",
            )}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
