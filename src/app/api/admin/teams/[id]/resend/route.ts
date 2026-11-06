import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/app-url";
import {
  NOT_CONFIGURED_MESSAGE,
  UNAUTHORISED_MESSAGE,
  adminSecret,
  isAdminRequest,
} from "@/lib/admin-auth";
import {
  sendMemberCompletionRequest,
  sendRegistrationConfirmation,
} from "@/lib/confirmation-email";
import { databaseConfigured } from "@/lib/db";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "@/lib/i18n";
import { findTeamById } from "@/lib/store";

export const dynamic = "force-dynamic";

async function guard(request: Request) {
  if (!(await adminSecret())) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: UNAUTHORISED_MESSAGE }, { status: 401 });
  }
  if (!(await databaseConfigured())) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 503 });
  }
  return null;
}

/**
 * Re-send an email to one member, or to every teammate who completes their own
 * details.
 *
 * A resend is deliberately explicit — it rotates the member's token, so the
 * previous link stops working. That is the point: the usual reason to press this
 * is that the first message never arrived, or went to a mailbox the player no
 * longer reads.
 *
 * The team leader has no completion form; their message is the team receipt, so
 * that is what a resend sends for the leader's row.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guard(request);
  if (denied) return denied;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const memberId =
    typeof (body as { memberId?: unknown })?.memberId === "string"
      ? (body as { memberId: string }).memberId
      : "";
  const requestedLanguage = (body as { language?: unknown })?.language;
  const language: Language = isLanguage(requestedLanguage) ? requestedLanguage : DEFAULT_LANGUAGE;

  try {
    const team = await findTeamById(id);
    if (!team) {
      return NextResponse.json({ error: "That registration no longer exists." }, { status: 404 });
    }

    if (team.bannedAt) {
      return NextResponse.json(
        { error: "This team is suspended. Lift the ban before emailing its members." },
        { status: 409 },
      );
    }

    const baseUrl = await appBaseUrl(request);

    if (memberId) {
      const index = team.members.findIndex((member) => member.id === memberId);
      if (index === -1) {
        return NextResponse.json({ error: "That member is not on this team." }, { status: 404 });
      }
      const member = team.members[index];

      if (member.bannedAt) {
        return NextResponse.json(
          { error: "That member is suspended. Lift the ban before emailing them." },
          { status: 409 },
        );
      }

      const sent =
        index === team.leaderIndex
          ? await sendRegistrationConfirmation(team, baseUrl, language)
          : await sendMemberCompletionRequest(team, member, baseUrl, language);

      return NextResponse.json(
        sent
          ? { ok: true, sent: 1, to: member.email, leader: index === team.leaderIndex }
          : {
              ok: false,
              sent: 0,
              error: "The message could not be sent. Check the confirmation mail settings.",
            },
        { status: sent ? 200 : 502 },
      );
    }

    /* No member named: everyone who has a completion form. Confirmed members are
       included, because "resend" is also how a player gets back in to correct
       something after their first save. */
    const recipients = team.members.filter(
      (member, index) => index !== team.leaderIndex && Boolean(member.email) && !member.bannedAt,
    );

    if (recipients.length === 0) {
      return NextResponse.json(
        { ok: false, error: "This team has no teammates to email." },
        { status: 409 },
      );
    }

    /* Sequential rather than concurrent: an organiser pressed a button and is
       waiting for a count, and a roster is small. */
    let sent = 0;
    for (const member of recipients) {
      if (await sendMemberCompletionRequest(team, member, baseUrl, language)) sent += 1;
    }

    return NextResponse.json({ ok: sent > 0, sent, total: recipients.length });
  } catch (error) {
    console.error("[admin:team:resend]", error);
    return NextResponse.json({ error: "Could not send those emails." }, { status: 502 });
  }
}
