import { NextResponse } from "next/server";
import { adminLogin, adminPepper, isOwnerRequest } from "@/lib/admin-auth";
import { hashCredentialAsync, passwordProblem } from "@/lib/admin-credential";
import { clearAdminCredential, getAdminCredential, setAdminCredential } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The grand admin's password — set, change or remove it.
 *
 * Owner-only, and **the current credential must be presented again** even though the caller
 * already holds an owner session. That is not paranoia about the session; it is about the
 * unlocked laptop. An organiser who walks away mid-shift leaves a console that can read
 * twelve teams' contact details, and this is the one action that must not be available to
 * whoever sits down next.
 *
 * The current credential may be either the password or `ADMIN_SECRET`, because both are
 * legitimate `owner` credentials and the root is what gets someone back in after a
 * forgotten password.
 */

/** Whether a password is set, and how old it is. Never the hash. */
export async function GET(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const stored = await getAdminCredential();
  return NextResponse.json(
    {
      ok: true,
      configured: Boolean(stored),
      updatedAt: stored?.updatedAt ?? null,
      updatedVia: stored?.updatedVia ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  let body: { current?: unknown; password?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as { current?: unknown; password?: unknown; confirm?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const current = typeof body.current === "string" ? body.current : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  /* Proving the current credential goes through the same locked-out path as a sign-in, so a
     session that has been left open cannot be used to grind this field either. */
  const proof = await adminLogin(request, current);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "That is not the current grand admin password or deployment secret." },
      { status: proof.retryAfterSeconds > 0 ? 429 : 401 },
    );
  }

  if (password !== confirm) {
    return NextResponse.json({ error: "The two entries do not match." }, { status: 400 });
  }

  /* The policy is enforced here and not only in the browser: the console's check is a
     courtesy, and a request can be made without it. */
  const problem = passwordProblem(password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  /* An empty pepper is not a misconfiguration — it is the default, meaning the hash depends
     only on the password and the database, so it verifies identically in every environment. */
  const pepper = adminPepper();

  try {
    await setAdminCredential(await hashCredentialAsync(password, pepper), "console");
  } catch (error) {
    console.error("[admin:password] could not store the password", error);
    return NextResponse.json(
      { error: "We could not save the password. Nothing was changed." },
      { status: 502 },
    );
  }

  /* The password itself is never logged, echoed, or returned — only the fact that it was
     stored. */
  return NextResponse.json(
    { ok: true, configured: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Forget the stored password, leaving `ADMIN_SECRET` as the only way in.
 *
 * Requires the current credential like the set path does, and for the same reason: this is
 * as much a credential change as setting one, and it is how someone backs out of a password
 * they no longer want.
 */
export async function DELETE(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  let body: { current?: unknown };
  try {
    body = (await request.json()) as { current?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const proof = await adminLogin(request, typeof body.current === "string" ? body.current : "");
  if (!proof.ok) {
    return NextResponse.json(
      { error: "That is not the current grand admin password or deployment secret." },
      { status: proof.retryAfterSeconds > 0 ? 429 : 401 },
    );
  }

  try {
    await clearAdminCredential();
  } catch (error) {
    console.error("[admin:password] could not clear the password", error);
    return NextResponse.json({ error: "We could not remove the password." }, { status: 502 });
  }

  return NextResponse.json(
    { ok: true, configured: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
