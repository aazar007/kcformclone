import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminConsole } from "@/components/admin/admin-console";
import { CONSOLE_HEADER, adminPath } from "@/lib/admin-path";
import { loadConfig } from "@/lib/config-store";
import { sheetUrl } from "@/lib/sheets";
import { listGameLogoVersions } from "@/lib/store";

/**
 * The organiser console — the grand admin's door.
 *
 * Reachable only through the middleware rewrite from the console's secret segment.
 * `/admin` is not an address anyone may use, so typing it — or reaching the route on
 * a request the middleware skips — is answered as a page that does not exist.
 *
 * That guard is here rather than resting on the middleware alone because the
 * middleware did *not* cover every request: its matcher excluded prefetch requests, so
 * a request carrying `Next-Router-Prefetch` arrived below it and rendered the whole
 * sign-in form at `/admin`. Anything that decides who may reach a route has to sit on
 * the route itself; a matcher is configuration, and configuration is exactly the thing
 * that gets edited later by someone who has not read this file.
 *
 * The check is **this page's** secret segment, so the staff address cannot open it and
 * vice versa. The gate below still lives on the API, which is what actually protects
 * the tournament settings.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Organiser Console",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const presented = (await headers()).get(CONSOLE_HEADER);
  if (!presented || presented !== (await adminPath())) notFound();

  const { config, source } = await loadConfig();
  const logoVersions = await listGameLogoVersions().catch(() => ({}) as Record<string, number>);

  return (
    /*
     * Forced left-to-right, and declared English.
     *
     * The console is English-only, but the document direction is set from the
     * language the *entrant* form is using, held in the browser. An organiser whose
     * browser is set to Arabic would otherwise get this English console mirrored —
     * labels right-aligned, fields reversed — which reads as broken rather than as
     * Arabic. Pinning the direction here keeps the console predictable while the
     * form stays bilingual.
     *
     * `lang="en"` is the same pin applied to language rather than direction, and it
     * does two things: a screen reader stops reading English text as Arabic, and the
     * Arabic typeface rule in `globals.css` — which keys off `lang` — no longer
     * applies here, so the console keeps the Latin faces it was designed with.
     */
    <div dir="ltr" lang="en">
      <AdminConsole
        initialConfig={config}
        configSource={source}
        initialLogoVersions={logoVersions}
        mode="owner"
        sheetUrl={await sheetUrl()}
      />
    </div>
  );
}
