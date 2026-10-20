import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { deleteRulebook, getRulebookMeta, upsertRulebook } from "@/lib/store";
import { loadConfig } from "@/lib/config-store";
import { gameById } from "@/lib/tournament";

export const dynamic = "force-dynamic";

/**
 * A game's rulebook, managed from the console.
 *
 * Open to any signed-in admin, not just the grand admin: dealing with the rulebooks
 * is part of running the tournament, and the organisers asked for staff to have
 * everything except the ability to add more staff. The one thing reserved is the
 * staff list itself.
 *
 * Stored as bytes in the database rather than on disk, for the same reason the game
 * logos are: Vercel's filesystem is ephemeral, so a file written at runtime would not
 * survive the next deploy.
 */

/**
 * Ceiling for one document.
 *
 * Generous — a rules PDF with pitch diagrams is easily a few megabytes — but not
 * unbounded, because it is read into memory. A dozen megabytes is far more than a
 * rules document needs and still safe to hold.
 */
const RULEBOOK_MAX_BYTES = 12 * 1024 * 1024;

/** A PDF begins with `%PDF-`. Checking it costs nothing and stops a renamed image or
 *  an HTML file being stored and served back as `application/pdf`. */
function looksLikePdf(bytes: Buffer) {
  return bytes.byteLength > 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Resolve the game, so a rulebook cannot be filed against a game that does not
 *  exist — which would then never be reachable from the form. */
async function knownGame(gameId: string) {
  const { config } = await loadConfig();
  return gameById(config, gameId);
}

export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const { gameId } = await params;
  const meta = await getRulebookMeta(gameId);
  return NextResponse.json(
    meta
      ? {
          exists: true,
          title: meta.title,
          size: meta.size,
          updatedAt: meta.updatedAt,
          /* The viewer appends this to the PDF URL. The route is served no-store, so
             this is not about browser caching — it is about changing the `src` after
             an upload, which is what makes an already-open iframe reload. */
          version: meta.updatedAt.getTime(),
        }
      : { exists: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "The database is not configured." }, { status: 503 });
  }

  const { gameId } = await params;
  if (!(await knownGame(gameId))) {
    return NextResponse.json({ error: "That is not a game in this tournament." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("rulebook");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was included" }, { status: 400 });
  }

  if (file.size > RULEBOOK_MAX_BYTES) {
    const mb = (RULEBOOK_MAX_BYTES / (1024 * 1024)).toFixed(0);
    return NextResponse.json({ error: `That file is larger than ${mb} MB` }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return NextResponse.json(
      { error: "That is not a PDF. Export the rulebook as PDF and try again." },
      { status: 415 },
    );
  }

  const rawTitle = form.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim().slice(0, 120) : "";

  try {
    const saved = await upsertRulebook({ gameId, mimeType: "application/pdf", bytes, title });
    return NextResponse.json({
      ok: true,
      gameId,
      title: saved.title,
      size: saved.size,
      updatedAt: saved.updatedAt,
      version: saved.updatedAt.getTime(),
    });
  } catch (error) {
    console.error("[admin:rulebook:upload]", error);
    return NextResponse.json({ error: "Could not store the rulebook." }, { status: 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const { gameId } = await params;
  await deleteRulebook(gameId);
  return NextResponse.json({ ok: true, gameId }, { headers: { "Cache-Control": "no-store" } });
}
