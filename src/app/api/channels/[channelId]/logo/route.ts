import { NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { channelLogoKey, getSponsorLogo } from "@/lib/store";

/**
 * Serve a "where to watch" channel's logo.
 *
 * Channel logos share the sponsor logo table, under a `channel:`-prefixed key (see
 * `channelLogoKey`), so there is no second table or migration. Everything else is the
 * sponsor route: the bytes are read back through a handler because the deployment
 * filesystem is ephemeral, and every caller versions the URL with the row's `updatedAt`.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!(await databaseConfigured())) {
    return new NextResponse(null, { status: 404 });
  }

  const { channelId } = await params;
  const key = channelLogoKey(channelId);
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
    console.error("[channels:logo]", error);
    return new NextResponse(null, { status: 502 });
  }
}
