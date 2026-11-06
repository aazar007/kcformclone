import { NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { socialLogoKey } from "@/lib/logo-keys";
import { getSponsorLogo } from "@/lib/store";

/**
 * Serve a footer social account's logo.
 *
 * Social logos share the sponsor logo table under a `social:`-prefixed key (see
 * `socialLogoKey`), so there is no second table or migration. Everything else matches
 * the channel route: the bytes are read back through a handler because the deployment
 * filesystem is ephemeral, and every caller versions the URL with the row's `updatedAt`.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ socialId: string }> },
) {
  if (!(await databaseConfigured())) {
    return new NextResponse(null, { status: 404 });
  }

  const { socialId } = await params;
  const key = socialLogoKey(socialId);
  if (!key) return new NextResponse(null, { status: 404 });

  try {
    const logo = await getSponsorLogo(key);
    if (!logo) return new NextResponse(null, { status: 404 });

    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        "Content-Type": logo.mimeType,
        "Content-Length": String(logo.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=31536000, immutable, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[social:logo]", error);
    return new NextResponse(null, { status: 502 });
  }
}
