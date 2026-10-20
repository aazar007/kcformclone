"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES, LANGUAGE_STORAGE_KEY, type Language } from "@/lib/i18n";

/**
 * The language switch on the privacy notice.
 *
 * Deliberately *not* the shared `LanguageToggle`: that one reads its state from the
 * form's provider, and this page is a server component whose language comes from the
 * URL. Using the shared one here would mean two sources of truth for the same fact,
 * and the visible text could disagree with the page's `dir`.
 *
 * Switching writes storage, puts `?lang=` in the URL and reloads — the same contract
 * the form uses, so a student who switches here and goes back finds the form in the
 * language they picked, and vice versa.
 */
export function PrivacyLanguageToggle({ current }: { current: Language }) {
  const select = (next: Language) => {
    if (next === current) return;

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the URL below still carries the choice.
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.location.assign(url.toString());
    } catch {
      window.location.reload();
    }
  };

  return (
    <div
      role="group"
      aria-label="Language / اللغة"
      lang="en"
      dir="ltr"
      className="flex shrink-0 items-center gap-1 rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950/50 p-1"
    >
      <Languages className="mx-1.5 size-3.5 shrink-0 text-ash" aria-hidden />
      {LANGUAGES.map((entry) => {
        const active = entry.id === current;
        return (
          <button
            key={entry.id}
            type="button"
            aria-label={entry.english}
            aria-pressed={active}
            lang={entry.id}
            onClick={() => select(entry.id)}
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
