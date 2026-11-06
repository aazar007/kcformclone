import type { Metadata } from "next";
import { headers } from "next/headers";
import { RegistrationWizard } from "@/components/form/registration-wizard";
import { adminSession } from "@/lib/admin-auth";
import { adminHref, staffHref } from "@/lib/admin-path";
import { loadConfig } from "@/lib/config-store";
import { listGameLogoVersions, listRulebookVersions, listSponsorLogoVersions, type RulebookVersions } from "@/lib/store";

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
  /*
   * **Everything this page needs, asked for at once.**
   *
   * These were three sequential `await`s, and each one is a round trip to a pooled
   * database — so the first byte of the page waited for the sum of three latencies
   * before any of it could be rendered. Nothing here depends on anything else on the
   * list, so the cost is the slowest query rather than the total.
   *
   * It matters most for the logos: the images themselves are streamed from
   * `/api/games/[gameId]/logo`, and the page cannot start those requests until it knows
   * which games have one, so every millisecond spent here delays the pictures as well.
   */
  const params = await searchParams;

  /* Whether this visitor is a signed-in organiser. Read here, on the server, from the
     HttpOnly session cookie — the browser is never asked whether it is an admin.
     It is passed down only to decide whether the form stays usable while the public
     window is shut; every write re-checks the same cookie on the API. */
  const requestHeaders = await headers();
  const organiserSession = await adminSession(
    new Request("http://internal.invalid/", { headers: requestHeaders }),
  );

  const [{ config }, logoVersions, sponsorLogoVersions, rulebooks, consoleHref, staffConsoleHref] =
    await Promise.all([
      loadConfig(),
      // A missing database must not stop the form rendering: the logos are simply absent,
      // and a submission reports its own, clearer failure.
      listGameLogoVersions().catch(() => ({}) as Record<string, number>),
      /* The same for sponsors. Read here rather than in the browser so the landing can
         preload the artwork, and so a sponsor without one is simply absent from the map
         instead of costing a 404. */
      listSponsorLogoVersions().catch(() => ({}) as Record<string, number>),
      /* Which games have a rulebook, and when each changed. Only the metadata is read here
         — the documents are streamed from /api/games/[gameId]/rulebook, so this page never
         carries a multi-megabyte payload. */
      listRulebookVersions().catch(() => ({})) as Promise<RulebookVersions>,
      /* Where the console actually lives. Resolved here, on the server, because the segments
         are derived from `ADMIN_SECRET` — and the browser is told only the finished paths,
         never the secret behind them. Two addresses, one per door: the shortcut that opens
         each is bound to its own. Either is null when the deployment has no console
         configured, in which case that exit is left out entirely rather than pointing at a
         URL that 404s. */
      adminHref(),
      staffHref(),
    ]);

  /* The confirmation email links here with `?tab=edit`, so a captain lands on
     the edit flow rather than being told to find it themselves. A shared team link
     also carries `ref`, so a player only has to add their own address. */
  const tab = params.tab === "edit" ? "edit" : "register";
  const reference = typeof params.ref === "string" ? params.ref.trim().toUpperCase() : "";

  return (
    <RegistrationWizard
      config={config}
      logoVersions={logoVersions}
      sponsorLogoVersions={sponsorLogoVersions}
      rulebooks={rulebooks}
      initialTab={tab}
      initialReference={reference}
      /* "View form" links to `?tab=register`, so an organiser lands on the form
         itself rather than the landing page. An explicit tab means the visitor has
         already chosen a destination. */
      skipLanding={params.tab === "register"}
      adminHref={consoleHref}
      staffHref={staffConsoleHref}
      organiserPreview={organiserSession !== null}
    />
  );
}
