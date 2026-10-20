import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { ACCEPTED_IMAGE_TYPES, LOGO_MAX_BYTES, LOGO_SIZE, readImageSize } from "@/lib/image";
import { deleteGameLogo, upsertGameLogo } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Upload a game logo.
 *
 * The exact 512×512 requirement is enforced here rather than in the browser: the
 * browser's check is a courtesy to the organiser, the server's is the rule. Files
 * that are the wrong size are rejected with the size they actually are, so the
 * fix is obvious.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
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
  if (!gameId) {
    return NextResponse.json({ error: "Missing game id" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was included" }, { status: 400 });
  }

  if (file.size > LOGO_MAX_BYTES) {
    const mb = (LOGO_MAX_BYTES / (1024 * 1024)).toFixed(0);
    return NextResponse.json({ error: `That image is larger than ${mb} MB` }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const size = readImageSize(bytes);

  if (!size) {
    return NextResponse.json(
      { error: `Unsupported image. Use ${ACCEPTED_IMAGE_TYPES.join(", ")}.` },
      { status: 415 },
    );
  }

  if (size.width !== LOGO_SIZE || size.height !== LOGO_SIZE) {
    return NextResponse.json(
      {
        error: `Logos must be exactly ${LOGO_SIZE}×${LOGO_SIZE} — that image is ${size.width}×${size.height}.`,
        width: size.width,
        height: size.height,
      },
      { status: 422 },
    );
  }

  try {
    const logo = await upsertGameLogo({
      gameId,
      mimeType: size.mimeType,
      width: size.width,
      height: size.height,
      bytes,
    });

    return NextResponse.json({
      ok: true,
      gameId,
      width: size.width,
      height: size.height,
      bytes: bytes.byteLength,
      /* The client puts this in the image URL. Without it the long-lived cache on
         /api/games/[id]/logo would keep serving the previous logo. */
      version: logo.updatedAt.getTime(),
    });
  } catch (error) {
    console.error("[admin:logo:upload]", error);
    return NextResponse.json({ error: "Could not store that logo." }, { status: 502 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!adminSecret()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const { gameId } = await params;

  try {
    await deleteGameLogo(gameId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin:logo:delete]", error);
    return NextResponse.json({ error: "Could not remove that logo." }, { status: 502 });
  }
}
