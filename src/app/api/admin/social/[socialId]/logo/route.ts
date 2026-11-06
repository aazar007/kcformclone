import { NextResponse } from "next/server";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { databaseConfigured } from "@/lib/db";
import { ACCEPTED_IMAGE_TYPES, LOGO_MAX_BYTES, LOGO_SIZE, readImageSize } from "@/lib/image";
import { socialLogoKey } from "@/lib/logo-keys";
import { deleteSponsorLogo, upsertSponsorLogo } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Upload or remove a footer social account's logo.
 *
 * The channel logo route with the key namespaced: the bytes go in the same table under
 * `socialLogoKey`. Open to any signed-in admin — owner or staff — because the General
 * tab is shared. The 512×512 rule is enforced here on the server; the browser's resize
 * is a courtesy.
 *
 * The footer prints the logo alone, so an account without one is deliberately absent
 * from the public page rather than rendered as a text placeholder.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ socialId: string }> },
) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!(await databaseConfigured())) {
    return NextResponse.json({ error: "The database is not configured." }, { status: 503 });
  }

  const { socialId } = await params;
  const key = socialLogoKey(socialId);
  if (!key) {
    return NextResponse.json({ error: "Invalid social account id" }, { status: 400 });
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
    const logo = await upsertSponsorLogo({
      sponsorId: key,
      mimeType: size.mimeType,
      width: size.width,
      height: size.height,
      bytes,
    });

    return NextResponse.json({
      ok: true,
      socialId,
      width: size.width,
      height: size.height,
      bytes: bytes.byteLength,
      /* The client puts this in the image URL, so a replaced logo is a new URL rather
         than a stale one behind a one-year cache. */
      version: logo.updatedAt.getTime(),
    });
  } catch (error) {
    console.error("[admin:social-logo:upload]", error);
    return NextResponse.json({ error: "Could not store that logo." }, { status: 502 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ socialId: string }> },
) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  const { socialId } = await params;
  const key = socialLogoKey(socialId);
  if (!key) {
    return NextResponse.json({ error: "Invalid social account id" }, { status: 400 });
  }

  try {
    await deleteSponsorLogo(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin:social-logo:delete]", error);
    return NextResponse.json({ error: "Could not remove that logo." }, { status: 502 });
  }
}
