import { NextResponse } from "next/server";
import { completeMemberProfile, lookupMemberCompletion } from "@/lib/member-confirm";
import { loadConfig } from "@/lib/config-store";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { validateMemberCompletion } from "@/lib/validation";
import { isMemberRole } from "@/lib/games";
import { DuplicateValueError, findMemberClashes } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Save one member's own details from the link they were sent.
 *
 * A POST rather than a side effect of opening the page: university mail filters
 * follow every URL in a message, and a GET that saved would let them complete a
 * profile — and confirm an address — for somebody who never clicked.
 *
 * Saving is the confirmation. The link proves control of this mailbox, so one
 * button is enough; asking the player to confirm and then fill a form would ask
 * the same question twice. The token names exactly one member, and the update is
 * scoped to that row, so a click can never touch a sibling.
 */
export async function POST(request: Request) {
  const limited = rateLimit(await clientKey(request, "member-confirm"), 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const token = typeof (body as { token?: unknown })?.token === "string"
    ? (body as { token: string }).token
    : "";

  if (!token) {
    return NextResponse.json({ error: "This confirmation link is incomplete." }, { status: 400 });
  }

  try {
    /* The stored row is the authority for everything the member may not change:
       their address, their university and their role. Taking any of those from the
       request would let a player move themselves to another institution or become a
       coach to skip the student number. */
    const target = await lookupMemberCompletion(token);
    if (!target) {
      return NextResponse.json(
        { error: "This confirmation link is no longer valid." },
        { status: 404 },
      );
    }

    if (target.banned) {
      return NextResponse.json(
        { error: "This registration has been suspended by the organisers." },
        { status: 403 },
      );
    }

    const { config } = await loadConfig();
    const parsed = validateMemberCompletion(
      (body as { profile?: unknown })?.profile,
      config,
      { role: isMemberRole(target.role) ? target.role : "STARTER" },
    );
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Some details are invalid", errors: parsed.errors },
        { status: 400 },
      );
    }

    /* The student number is globally unique, so a player who types somebody else's
       would otherwise get a database error after a form they cannot see the reason
       for. Checked first to name the problem. Their own row is skipped. */
    if (parsed.data.studentId) {
      const clashes = await findMemberClashes([
        { email: "", studentId: parsed.data.studentId },
      ]);
      /* Their own row is not a clash — the check runs against the completed
         profile, and an address already on file belongs to them. */
      const other = clashes.find(
        (clash) => clash.email.toLowerCase() !== target.email.toLowerCase(),
      );
      if (other) {
        return NextResponse.json(
          {
            error: "Some details are invalid",
            errors: { studentId: "That student ID is already registered with another player" },
          },
          { status: 409 },
        );
      }
    }

    /* An academic address belongs to the university on the row, and the row is not
       editable here — but a roster may also be same-university-only, which the
       address already satisfies at registration. Nothing else to check. */

    const outcome = await completeMemberProfile(token, parsed.data);
    if (!outcome.ok) {
      return NextResponse.json(
        {
          error:
            outcome.reason === "banned"
              ? "This registration has been suspended by the organisers."
              : "This confirmation link is no longer valid.",
        },
        { status: outcome.reason === "banned" ? 403 : 404 },
      );
    }

    return NextResponse.json({ ...outcome, ok: true });
  } catch (error) {
    if (error instanceof DuplicateValueError) {
      return NextResponse.json(
        {
          error: "Some details are invalid",
          errors: { [error.violation.field]: error.violation.message },
        },
        { status: 409 },
      );
    }

    /* A race between two players claiming the same student number reaches the
       unique index rather than the pre-check. Reported as the same field error, so
       the second player is told what to change instead of seeing "try again". */
    const code = (error as { code?: unknown })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        {
          error: "Some details are invalid",
          errors: { studentId: "That student ID is already registered with another player" },
        },
        { status: 409 },
      );
    }

    console.error("[confirm-email]", error);
    return NextResponse.json(
      { error: "We could not save your details just now. Please try again." },
      { status: 502 },
    );
  }
}