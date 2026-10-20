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
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn(
        "flex items-center gap-1 rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950/50 p-1",
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
              "rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-wide transition-colors",
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
