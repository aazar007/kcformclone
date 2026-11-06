"use client";

import * as React from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { socialLogoKey } from "@/lib/logo-keys";
import type { TournamentConfig } from "@/lib/tournament";
import { useLanguage } from "./language-provider";
import { LanguageToggle } from "./language-toggle";

/**
 * The site footer.
 *
 * **One footer, two pages.** It is mounted on the landing page and inside the wizard,
 * because a captain who is halfway through a form should not have to go back to the
 * home page to read the privacy policy or find a way to ask a question.
 *
 * What it carries:
 *
 * - **Privacy policy** — a real route (`/privacy`), not a configurable link, because
 *   the notice it shows is the one the consent checkbox refers to. Letting an organiser
 *   point this somewhere else would let the form demand consent to a document nobody
 *   can read.
 * - **Contact** and **social accounts** — both configured by an organiser in the
 *   console, since addresses and accounts are the kind of thing that changes during a
 *   tournament. Each is omitted entirely when unset rather than rendered as a dead link.
 *   Social accounts render their uploaded logo alone, in one horizontal row: a footer
 *   strip of icons reads at a glance, where a column of text labels pushed everything
 *   else down the page.
 * - **The language switch** — moved here from the top of the page. It is a preference,
 *   not a call to action, and the hero was carrying two competing controls.
 * - **The club's partner logo** — the artwork supplied by the organisers, with its black
 *   background removed (`/club-logo.png`) so it sits on the arena gradient rather than
 *   in a black rectangle.
 *
 * The footer never contains a form control other than the language switch, so it cannot
 * interfere with the wizard's own state.
 */
export function SiteFooter({
  config,
  logoVersions = {},
  className,
}: {
  config: TournamentConfig;
  /**
   * Stored logo versions, keyed the way the server keys them — social accounts are
   * `social:<id>`. An account with no logo is left out of the public row: the footer
   * prints the artwork alone, and a link with nothing to show would be an invisible
   * tap target rather than a social icon.
   */
  logoVersions?: Record<string, number>;
  className?: string;
}) {
  const { t } = useLanguage();

  const social = (config.socialLinks ?? []).flatMap((link) => {
    const key = socialLogoKey(link.id);
    const version = key ? logoVersions[key] : undefined;
    return version === undefined ? [] : [{ link, version }];
  });
  const contact = config.contactEmail?.trim();

  return (
    <footer
      className={cn(
        "mt-12 border-t border-[rgba(79, 182, 208,0.16)] pt-8",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-7 text-center">
        {/* The partners' wordmark, with its background removed. `brightness-0 invert`
            is deliberately *not* applied: the supplied artwork is already white, and
            recolouring it would flatten the antialiased edges that were preserved when
            the black background was keyed out. */}
        <img
          src="/club-logo.png"
          alt=""
          width={974}
          height={322}
          loading="lazy"
          decoding="async"
          className="h-10 w-auto opacity-90 sm:h-12"
        />

        <nav
          aria-label={t("footer.community")}
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs font-bold text-ash"
        >
          <a
            href="/privacy"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
          >
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            {t("footer.privacy")}
          </a>

          {/* Rendered only when configured: a "Contact us" that opens an empty mail
              client is worse than no contact link at all. */}
          {contact && (
            <a
              href={`mailto:${contact}`}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              {t("footer.contact")}
            </a>
          )}
        </nav>

        {social.length > 0 && (
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-[0.625rem] font-bold tracking-[0.24em] text-ash/60 uppercase">
              {t("footer.social")}
            </p>
            <ul className="flex flex-row flex-wrap items-center justify-center gap-2.5">
              {social.map(({ link, version }) => (
                <li key={link.id}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={link.label}
                    title={`${link.label} · ${t("footer.opensNewTab")}`}
                    className="flex size-11 items-center justify-center rounded-xl border border-[rgba(79, 182, 208,0.22)] bg-wall-950/40 transition-colors hover:border-brand/50 hover:bg-wall-900/60"
                  >
                    {/* Decorative: the link's accessible name is its label, so the image
                        must not be announced a second time. */}
                    <img
                      src={`/api/social/${encodeURIComponent(link.id)}/logo?v=${version}`}
                      alt=""
                      width={512}
                      height={512}
                      loading="lazy"
                      decoding="async"
                      className="size-7 object-contain"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The language switch. `LanguageToggle` is already a client component sharing
            this provider, so the footer only decides where it sits. */}
        <LanguageToggle />

        <p className="text-[0.625rem] leading-relaxed text-ash/45">
          {t("footer.rights")} · {config.tournamentName}
        </p>
      </div>
    </footer>
  );
}
