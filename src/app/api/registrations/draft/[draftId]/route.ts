import { NextResponse } from "next/server";
import { readDraft } from "@/lib/draft-store";
import { databaseConfigured } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The live state of a registration in progress.
 *
 * The review step polls this while the captain waits, so a teammate who fills in
 * their details appears in the roster as it happens rather than after a reload.
 * The secret is what authorises the read — the draft id alone is not enough.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  if (!(await databaseConfigured())) {
    return NextResponse.json({ error: "Registration is temporarily unavailable." }, { status: 503 });
  }

  /* Polling, so the budget is per minute rather than per ten. */
  const limited = rateLimit(await clientKey(request, "draft-read"), 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many refreshes. Pause for a moment." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const { draftId } = await params;
  const secret = new URL(request.url).searchParams.get("secret") ?? "";

  try {
    const draft = await readDraft(draftId, secret);
    if (!draft) {
      return NextResponse.json({ error: "That registration is no longer open." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, draft },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[registrations:draft:read]", error);
    return NextResponse.json({ error: "We could not read that registration." }, { status: 502 });
  }
}
