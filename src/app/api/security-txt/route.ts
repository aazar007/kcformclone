import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * `/.well-known/security.txt` — an RFC 9116 disclosure file, **only when a contact exists**.
 *
 * RFC 9116 requires a `Contact:` field and an `Expires:` field. Inventing an address to
 * satisfy the spec would be worse than publishing nothing: a researcher following it would
 * reach a stranger, and the file would be claiming a disclosure channel that does not work.
 *
 * So the address comes from configuration, and with no configuration this answers 404 —
 * indistinguishable from a site that does not publish one. Set:
 *
 *   SECURITY_CONTACT="mailto:security@example.org"
 *   SECURITY_CONTACT="https://example.org/report"   (an https URL is also valid)
 *   SECURITY_EXPIRES="2027-12-31T23:59:59.000Z"      (optional; defaults to a year out)
 *
 * `Expires` is required because a stale security.txt is a trap: it promises a channel that
 * may have been abandoned. Regenerate by bumping the date, or let it roll a year at a time.
 */
export async function GET() {
  const contact = (await getEnv("SECURITY_CONTACT"))?.trim();
  if (!contact) {
    return new NextResponse("Not found", { status: 404 });
  }

  /* RFC 9116 §2.5.5: `Contact` must be a URI (mailto: or https:). Anything else is refused
     rather than emitted as a broken line. */
  if (!/^(mailto:|https:\/\/)/i.test(contact)) {
    console.error(
      "[security-txt] SECURITY_CONTACT must be a mailto: or https:// URI; not publishing a file",
    );
    return new NextResponse("Not found", { status: 404 });
  }

  const configuredExpiry = (await getEnv("SECURITY_EXPIRES"))?.trim();
  const expires =
    configuredExpiry ??
    /* One year out, always in the future: an `Expires` in the past tells parsers to ignore
       the file, which fails silently. */
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const lines = [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    "# Preferred-Languages: en, ar",
    "Canonical: /.well-known/security.txt",
    "# Please include the URL and the steps to reproduce. Do not include other people's",
    "# personal data in a report; this site holds registrations belonging to students.",
  ];

  /* `text/plain` is what the RFC asks for; `no-store` because the expiry is computed. */
  return new NextResponse(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
