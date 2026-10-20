import { NextResponse } from "next/server";
import { SESSION_COOKIE, isSameOrigin, sessionCookieOptions } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** End the admin session: the cookie is expired on the way out. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
