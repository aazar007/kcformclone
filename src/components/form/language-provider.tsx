"use client";

import * as React from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  direction,
  isLanguage,
  t as translate,
  translateErrors,
  translateList,
  translateMessage,
  type Language,
  type MessageKey,
} from "@/lib/i18n";

/**
 * The chosen language, for the whole public form.
 *
 * Held in one place rather than passed down, because almost every component needs
 * it and threading it through six levels of props would make each of them harder to
 * read than the translation is worth.
 *
 * The choice is remembered in `localStorage`, so a student who switches to Arabic
 * does not have to switch again on the next visit — and the `<html>` element's
 * `dir` is updated alongside it, because the browser needs to know right-to-left
 * before it lays anything out.
 */

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Translate a form string. */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Translate one validation message produced by `validation.ts`. */
  message: (text: string) => string;
  /** Translate a whole error map. */
  errors: (errors: Record<string, string>) => Record<string, string>;
  /** Translate a list, de-duplicated. */
  list: (messages: string[]) => string[];
  rtl: boolean;
}

const LanguageContext = React.createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = LANGUAGE_STORAGE_KEY;

/**
 * The language to start in.
 *
 * A `?lang=` in the URL wins, so a link in a WhatsApp group can open in Arabic.
 * Otherwise the remembered choice, otherwise Arabic — the entrants are students at
 * a Saudi university, so Arabic is the language most of them will want and English
 * is the one they opt into.
 */
function initialLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (isLanguage(fromUrl)) return fromUrl;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be blocked; the default is fine.
  }

  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>(DEFAULT_LANGUAGE);

  /* Read the stored choice after mount rather than during render, so the server
     and the first client render agree. Reading it in `useState`'s initialiser
     would render Arabic on the client and English on the server for anyone whose
     language came from storage — a hydration mismatch. */
  React.useEffect(() => {
    setLanguageState(initialLanguage());
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = direction(language);
  }, [language]);

  /**
   * Switch language, then reload.
   *
   * Changing the language changes the whole document direction, and a direction
   * change is not something a re-render handles cleanly: every logical property,
   * scroll position and mirrored icon has to be recomputed, and anything a
   * browser or extension measured on the previous layout is now wrong. Reloading
   * rebuilds it in one pass from `LANGUAGE_BOOTSTRAP_SCRIPT`, so the page is laid
   * out correctly the first time rather than corrected afterwards.
   *
   * The chosen language is written to storage *and* to the URL before reloading,
   * because the bootstrap script reads the URL first — otherwise a page opened as
   * `?lang=en` would flip straight back after the reload and the toggle would look
   * broken.
   *
   * Worth knowing: a reload re-mounts the form. A registration in progress comes
   * back from the saved draft, but the consent box is deliberately not restored
   * (consent is given per submission), so it has to be ticked again. Switching
   * language mid-form is rare enough that this is preferable to a half-relaid
   * layout.
   */
  const setLanguage = React.useCallback(
    (next: Language) => {
      if (next === language) return;

      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage can be blocked; the URL below still carries the choice.
      }

      try {
        const url = new URL(window.location.href);
        url.searchParams.set("lang", next);
        window.history.replaceState(null, "", url.toString());
      } catch {
        // A malformed URL is not worth failing the switch over.
      }

      window.location.reload();
    },
    [language],
  );

  const value = React.useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => translate(language, key, vars),
      message: (text) => translateMessage(text, language),
      errors: (errors) => translateErrors(errors, language),
      list: (messages) => translateList(messages, language),
      rtl: language === "ar",
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * The current language.
 *
 * Throws outside a provider rather than silently defaulting, because a component
 * that renders English into an Arabic form is a bug worth noticing immediately —
 * and it would otherwise only show up as a stray English label in production.
 */
export function useLanguage(): LanguageContextValue {
  const value = React.useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside a LanguageProvider");
  return value;
}
