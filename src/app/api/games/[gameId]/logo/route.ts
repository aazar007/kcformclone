import { NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { getGameLogo } from "@/lib/store";

/**
 * Serve a game's logo.
 *
 * The bytes live in the database rather than on disk because the app is deployed
 * to Vercel, where the filesystem is read-only and any file written at runtime
 * disappears with the instance. Reading through a route is the price of having
 * the logo survive a deploy.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!databaseConfigured()) {
    return new NextResponse(null, { status: 404 });
  }

  const { gameId } = await params;

  try {
    const logo = await getGameLogo(gameId);
    if (!logo) return new NextResponse(null, { status: 404 });

    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        "Content-Type": logo.mimeType,
        "Content-Length": String(logo.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        /* A year, immutable — which is only safe because callers version the URL
           with the logo's `updatedAt`. Replacing a logo produces a new URL, so
           nothing stale can be served; see `listGameLogoVersions`. */
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[games:logo]", error);
    return new NextResponse(null, { status: 502 });
  }
}
