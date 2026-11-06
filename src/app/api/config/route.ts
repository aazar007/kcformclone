import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config-store";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
import { channelLogoKey, socialLogoKey } from "@/lib/logo-keys";
import { pruneSponsorLogos } from "@/lib/store";
import { normaliseConfig } from "@/lib/tournament";

export const dynamic = "force-dynamic";

/**
 * The tournament config.
 *
 * `GET` is public — every visitor to the registration form needs the games,
 * requirements and allowed provinces. `PUT` is the admin write and is refused
 * unless the request carries the admin secret.
 */
export async function GET() {
  const { config, source } = await loadConfig();
  return NextResponse.json(
    { ok: true, config, source },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  // Accept either `{ config: {...} }` or the config object itself.
  const candidate =
    typeof body === "object" && body !== null && "config" in body
      ? (body as { config: unknown }).config
      : body;

  // Normalise before writing: the admin console is trusted, the network is not.
  const config = normaliseConfig(candidate);

  try {
    const saved = await saveConfig(config);

    /*
     * Remove logo bytes whose sponsor no longer exists.
     *
     * Sponsors live in a JSON column, so PostgreSQL cannot cascade a delete from them
     * into `SponsorLogo` — removing a sponsor, or renaming one (which re-slugs its id),
     * would otherwise leave its artwork in the table forever with no URL left to reach
     * it. Doing it here, on the one write that can change the list, is the cheapest place
     * that is guaranteed to run.
     *
     * Never fatal: the config is already saved, and a sweep that failed should not turn a
     * successful save into an error the organiser has to retry.
     */
    /* Channel and footer social logos share the table, so their keys are live ids as
       well — leaving them out would delete every channel and social logo on the next save. */
    const liveLogoIds = [
      ...config.sponsors.map((sponsor) => sponsor.id),
      ...config.watchLinks.flatMap((link) => channelLogoKey(link.id) ?? []),
      ...config.socialLinks.flatMap((link) => socialLogoKey(link.id) ?? []),
    ];
    await pruneSponsorLogos(liveLogoIds).catch((error) => {
      console.warn("[config:save] could not prune orphaned sponsor logos:", error);
    });

    return NextResponse.json({ ok: true, config: saved });
  } catch (error) {
    console.error("[config:save]", error);
    return NextResponse.json(
      {
        error: "Could not save the configuration to the database. Check DATABASE_URL and that the migrations have been applied, then try again.",
        detail: process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : undefined,
      },
      { status: 502 },
    );
  }
}
