import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminConsole } from "@/components/admin/admin-console";
import { CONSOLE_HEADER, staffPath } from "@/lib/admin-path";
import { loadConfig } from "@/lib/config-store";
import { sheetUrl } from "@/lib/sheets";
import { listGameLogoVersions } from "@/lib/store";

/**
 * The staff door.
 *
 * A separate page from the grand admin's, on a separate secret segment, so the two
 * audiences never see each other's way in. A captain handed this address is shown one
 * field — their email — and never a field asking for the deployment secret they must
 * not have; the grand admin is never asked to step past a form meant for somebody else.
 *
 * `/admin` and everything under it is refused by the middleware, which is what keeps
 * this route off the public map in the first place. The check below is the second half:
 * the request must carry **this page's** segment, not the grand admin's, which is why
 * the middleware forwards the segment that actually matched rather than a role.
 *
 * Signing in here grants nothing extra. The role in the session is what decides which
 * sections the console shows, and every route checks it again — so a staff session that
 * arrived at the grand admin's page would still see only the staff sections, and this
 * page's form could not produce an owner session even if it were coaxed into trying.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Staff sign-in",
  robots: { index: false, follow: false },
};

export default async function StaffSignInPage() {
  const presented = (await headers()).get(CONSOLE_HEADER);
  if (!presented || presented !== (await staffPath())) notFound();

  const { config, source } = await loadConfig();
  const logoVersions = await listGameLogoVersions().catch(() => ({}) as Record<string, number>);

  return (
    /* Pinned direction and language for the same reason as `/admin`: the console is
       English-only, but the document direction comes from the entrant form's stored
       language, which would mirror an English console for an Arabic-speaking organiser. */
    <div dir="ltr" lang="en">
      <AdminConsole
        initialConfig={config}
        configSource={source}
        initialLogoVersions={logoVersions}
        mode="staff"
        sheetUrl={sheetUrl()}
      />
    </div>
  );
}
