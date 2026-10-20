import type { Metadata } from "next";
import Link from "next/link";
import { loadConfig } from "@/lib/config-store";
import { PRIVACY_NOTICE_ADVICE } from "@/lib/privacy-notice";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "@/lib/i18n";
import { fillNoticeTokens, parseNotice, splitEmphasis } from "@/components/privacy/notice-render";
import { PrivacyLanguageToggle } from "@/components/privacy/language-toggle";

export const dynamic = "force-dynamic";

/** The two languages' own words for the page furniture. */
const PAGE: Record<Language, { title: string; lead: string; advice: string; back: string }> = {
  en: {
    title: "Privacy notice",
    lead: "This explains what is collected when a team registers, why, who can see it, and how to have it removed.",
    advice: PRIVACY_NOTICE_ADVICE,
    back: "← Back to registration",
  },
  ar: {
    title: "إشعار الخصوصية",
    lead: "يوضّح هذا ما يُجمع عند تسجيل الفريق، ولماذا، ومن يمكنه الاطلاع عليه، وكيف يمكن حذفه.",
    advice:
      "هذا وصف واقعي لما يخزّنه النظام. وهو ليس استشارة قانونية — راجعه وفق التزاماتكم قبل الاعتماد عليه.",
    back: "→ العودة إلى التسجيل",
  },
};

/**
 * The language this page should render in.
 *
 * Read from the URL rather than from storage, because the choice lives in the
 * visitor's browser and this is a server component — the server cannot see
 * `localStorage`. The consent link in the form carries `?lang=` for exactly this
 * reason, and the toggle on this page keeps it there.
 *
 * A visitor arriving directly with no parameter gets the app's default language.
 */
async function languageFrom(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<Language> {
  const params = await searchParams;
  const value = params.lang;
  const single = Array.isArray(value) ? value[0] : value;
  return isLanguage(single) ? single : DEFAULT_LANGUAGE;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [language, { config }] = await Promise.all([languageFrom(searchParams), loadConfig()]);
  const title = language === "ar" ? "إشعار الخصوصية" : "Privacy notice";

  return {
    title: `${title} · ${config.tournamentName}`,
    description:
      language === "ar"
        ? `ما الذي يجمعه ${config.tournamentName} عند تسجيل فريق، ولماذا.`
        : `What ${config.tournamentName} collects when you register a team, and why.`,
    robots: { index: false, follow: false },
  };
}

function Paragraph({ text, tournamentName }: { text: string; tournamentName: string }) {
  return (
    <p>
      {splitEmphasis(fillNoticeTokens(text, tournamentName)).map((part, index) =>
        part.bold ? (
          <strong key={index} className="text-snow">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold tracking-[0.18em] text-brand uppercase">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ash">{children}</div>
    </section>
  );
}

/**
 * The privacy notice.
 *
 * The content belongs to the organisers — edited in the admin console and stored
 * with the tournament config, in each language — because what a competition may
 * lawfully do with entrant data is their call, not this application's. What the page
 * supplies is the shell: the heading, the advice, the language switch and the link
 * back.
 *
 * The advice is deliberately visible rather than hidden in a comment. A notice that
 * reads as authoritative while actually being a description of what a program does
 * is worse than one that says plainly it has not been reviewed.
 */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [language, { config }] = await Promise.all([languageFrom(searchParams), loadConfig()]);

  const notice = language === "ar" ? config.privacyNoticeAr : config.privacyNoticeEn;
  const { lead, sections } = parseNotice(notice);
  const copy = PAGE[language];

  return (
    <div
      /* Set from the language actually rendered, not from a client-side choice, so
         the direction can never disagree with the text on screen. */
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"
    >
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-brand uppercase">
              {config.tournamentName}
            </p>
            <h1 className="mt-2 font-display text-2xl tracking-wide text-snow">{copy.title}</h1>
          </div>
          <PrivacyLanguageToggle current={language} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ash">{copy.lead}</p>
      </header>

      <div className="space-y-8">
        {lead.length > 0 && (
          <section className="space-y-3 text-sm leading-relaxed text-ash">
            {lead.map((text, index) => (
              <Paragraph key={index} text={text} tournamentName={config.tournamentName} />
            ))}
          </section>
        )}

        {sections.map((section, index) => (
          <Section key={index} title={section.title}>
            {section.paragraphs.map((text, paragraphIndex) => (
              <Paragraph key={paragraphIndex} text={text} tournamentName={config.tournamentName} />
            ))}
          </Section>
        ))}

        {/* The organisers' note is for the people who own the notice, and they read
            English — so it stays English whichever language an entrant chose. */}
        <div className="panel rounded-2xl p-4" lang="en" dir="ltr">
          <p className="text-[11px] leading-relaxed text-ash">
            <strong className="text-ash">Note for the organisers:</strong> {PRIVACY_NOTICE_ADVICE}{" "}
            Contact details for data requests should be added to this notice — edit both languages
            under <span className="font-mono">General → Privacy notice</span> in the console.
          </p>
        </div>
      </div>

      <footer className="mt-10 border-t border-[rgba(148,196,208,0.12)] pt-5">
        <Link
          href="/"
          className="text-xs text-ash underline-offset-2 transition-colors hover:text-brand hover:underline"
        >
          {copy.back}
        </Link>
      </footer>
    </div>
  );
}
