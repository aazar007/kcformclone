import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config-store";
import { NOT_CONFIGURED_MESSAGE, UNAUTHORISED_MESSAGE, adminSecret, isAdminRequest } from "@/lib/admin-auth";
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
  if (!adminSecret()) {
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
