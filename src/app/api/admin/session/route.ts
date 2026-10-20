import { NextResponse } from "next/server";
import { adminSession, adminTwoStep, adminEmail, usingDevSecret } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Is there a live session, and whose is it? Lets the console restore itself after
 * a refresh without the browser ever holding the admin code.
 *
 * The role is returned so the console can render the right tabs on load — a staff
 * member refreshing must not be shown the settings tabs for a frame and have them
 * pulled away. That is cosmetic only; the routes behind those tabs refuse a staff
 * session regardless of what the page renders. Reading this never counts as a
 * failed login.
 */
export async function GET(request: Request) {
  const session = adminSession(request);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      ok: true,
      devSecret: usingDevSecret(),
      role: session.role,
      email: session.email,
      /* Whether the emailed confirmation step is in force, so a console restored from an
         existing session warns about it just as a fresh sign-in does. */
      twoStep: adminTwoStep(),
      twoStepAddress: adminEmail(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
