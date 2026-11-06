import { NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { getSponsorLogo } from "@/lib/store";

/**
 * Serve a sponsor's logo.
 *
 * The same route as `/api/games/[gameId]/logo`, for the same reason: the bytes live in
 * the database because the deployment filesystem is ephemeral, so they have to be read
 * back through a handler.
 *
 * `sponsorId` is a slug out of the config, so it is treated as untrusted input — it only
 * ever reaches a parameterised `findUnique`, and a value with no row behind it is a 404
 * like any other.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sponsorId: string }> },
) {
  if (!(await databaseConfigured())) {
    return new NextResponse(null, { status: 404 });
  }

  const { sponsorId } = await params;

  try {
    const logo = await getSponsorLogo(sponsorId);
    if (!logo) return new NextResponse(null, { status: 404 });

    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        "Content-Type": logo.mimeType,
        "Content-Length": String(logo.size),
        "X-Content-Type-Options": "nosniff",
        /* An image is not a document: if one were ever stored that a browser wanted to
           interpret as markup, this forbids it outright. Same header as the game logo. */
        "Content-Security-Policy": "default-src 'none'; sandbox",
        /* A year, immutable — safe only because every caller versions the URL with the
           logo's `updatedAt`, exactly as the game logos do. */
        "Cache-Control": "public, max-age=31536000, immutable, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[sponsors:logo]", error);
    return new NextResponse(null, { status: 502 });
  }
}
