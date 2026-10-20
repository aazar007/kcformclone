import { NextResponse } from "next/server";
import { getRulebook } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * A game's rulebook, as a PDF for the viewer on the public page.
 *
 * Public on purpose: teams read this before they register, and they have no account
 * to authenticate with yet.
 *
 * Three details matter here.
 *
 * **`inline`, not `attachment`.** The browser has to render this inside the viewer's
 * frame; `attachment` would make it a download, which is not "reading the rulebook"
 * and would defeat the acknowledgement that depends on the document having been
 * opened. See `next.config.mjs` for the matching `X-Frame-Options` exception —
 * without it the frame is refused and the viewer shows nothing.
 *
 * **The filename is never the organiser's text unquoted.** The ASCII fallback is
 * built from the date and the game id; the readable title rides along in `filename*`
 * (RFC 5987), percent-encoded. A title containing a quote or a newline would
 * otherwise end the header early — header injection from a value typed into a form.
 *
 * **The game id is not validated against the config here.** A rulebook row can only
 * exist for a game the organisers uploaded one for, so an unknown id simply finds
 * nothing and returns 404; asking `loadConfig` as well would mean fetching the whole
 * tournament config on every byte-range request the PDF viewer makes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  if (!gameId) {
    return NextResponse.json({ error: "Missing game id" }, { status: 400 });
  }

  const row = await getRulebook(gameId).catch(() => null);

  if (!row) {
    return NextResponse.json(
      { error: "No rulebook has been published for that game." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = Buffer.from(row.bytes);
  const asciiName = `${gameId.replace(/[^a-z0-9-]/gi, "")}-rulebook-${row.updatedAt
    .toISOString()
    .slice(0, 10)}.pdf`;
  const prettyName = encodeURIComponent(`${row.title || `${gameId} rulebook`}.pdf`);

  return new NextResponse(body, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${prettyName}`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
