import type { Metadata } from "next";
import { RegistrationWizard } from "@/components/form/registration-wizard";
import { adminHref, staffHref } from "@/lib/admin-path";
import { loadConfig } from "@/lib/config-store";
import { listGameLogoVersions, listRulebookVersions, type RulebookVersions } from "@/lib/store";

/**
 * The tournament config lives in the database and is edited from the admin
 * console, so this page can never be served from a build-time cache.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await loadConfig();
  return {
    title: `${config.tournamentName} · Team Registration`,
    description: config.tagline,
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { config } = await loadConfig();

  // A missing database must not stop the form rendering: the logos are simply
  // absent, and a submission reports its own, clearer failure.
  const logoVersions = await listGameLogoVersions().catch(() => ({}) as Record<string, number>);

  /* Which games have a rulebook, and when each changed. Only the metadata is read
     here — the documents are streamed from /api/games/[gameId]/rulebook, so this page
     never carries a multi-megabyte payload. */
  const rulebooks: RulebookVersions = await listRulebookVersions().catch(() => ({}));

  /* The confirmation email links here with `?tab=edit`, so a captain lands on
     the edit flow rather than being told to find it themselves. */
  const params = await searchParams;
  const tab = params.tab === "edit" ? "edit" : "register";

  /* Where the console actually lives. Resolved here, on the server, because the
     segments are derived from `ADMIN_SECRET` — and the browser is told only the
     finished paths, never the secret behind them. Two addresses, one per door: the
     shortcut that opens each is bound to its own. Either is null when the deployment
     has no console configured, in which case that exit is left out entirely rather
     than pointing at a URL that 404s. */
  const [consoleHref, staffConsoleHref] = await Promise.all([adminHref(), staffHref()]);

  return (
    <RegistrationWizard
      config={config}
      logoVersions={logoVersions}
      rulebooks={rulebooks}
      initialTab={tab}
      adminHref={consoleHref}
      staffHref={staffConsoleHref}
    />
  );
}
