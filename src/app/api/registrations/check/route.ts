/**
 * Live duplicate checking.
 *
 * The form asks this while the captain types, so a clash is reported beside the
 * field rather than after they have filled in the whole roster and pressed
 * submit. It is the early warning, not a second set of rules.
 *
 * What it will and will not say — this endpoint is public, so every answer is
 * something a stranger could ask for:
 *
 *   - A taken **team name** comes back with the stored spelling. Team names are
 *     shown publicly anyway, and the captain just typed something that normalises
 *     to it.
 *   - An **email** is only checked when the caller proves they control it (a
 *     signed `player-email` proof from the OTP step, or membership of the team they
 *     are editing). Without that, anyone could type any student's address and learn
 *     whether that person is registered.
 *   - A **student ID** is only checked alongside at least one proven email, so the
 *     endpoint cannot be used to sweep ID ranges anonymously.
 *   - The **reference** of an edited team only excludes that team when accompanied
 *     by the signed edit proof. A bare reference proves nothing, and honouring it
 *     would let a stranger who knows one compare identifiers with and without it.
 *
 * Values that are not authorised simply get no answer, which the form reads as
 * "nothing to say yet". The real, authoritative check runs on submit.
 */

import { NextResponse } from "next/server";
import type { DuplicateCheckResponse } from "@/lib/duplicate-check";
import { teamNamePolicyError } from "@/lib/name-policy";
import { normaliseEmail, otpConfigured, otpSkipVerify, verifyProof } from "@/lib/otp";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { findMemberClashes, findTeamByReference, findTeamNameClash } from "@/lib/store";
import { leaderEmail, teamVerifiedEmails } from "@/lib/team-draft";
import { teamNameKey } from "@/lib/team-name";

/** Enough for the largest supported roster, with headroom for a resubmit. */
const MAX_VALUES = 12;

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const dedupe = trimmed.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(trimmed);
    if (out.length >= MAX_VALUES) break;
  }
  return out;
}

export async function POST(request: Request) {
  /* Debounced typing still adds up, so the ceiling is loose enough for a real
     captain and tight enough that scraping the database one address at a time
     is not worth anyone's afternoon. */
  const limit = rateLimit(await clientKey(request, "duplicate-check"), 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Checking too quickly. Pause for a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const requestedEmails = stringList(body.emails);
  const requestedIds = stringList(body.studentIds);

  /* Resolved, never taken at face value. A reference only exempts its team when the
     caller also holds the signed edit proof for it; otherwise it exempts nothing. */
  const editingReference =
    typeof body.reference === "string" ? body.reference.trim().toUpperCase() : "";
  const editProof = typeof body.editProof === "string" ? body.editProof : "";
  let exceptTeamId: string | undefined;
  let teamEmails = new Set<string>();
  if (editingReference && editProof && (await otpConfigured())) {
    const team = await findTeamByReference(editingReference);
    const leader = team ? leaderEmail(team) : null;
    if (team && leader && (await verifyProof(editProof, normaliseEmail(leader), "edit-access", team.id))) {
      exceptTeamId = team.id;
      teamEmails = teamVerifiedEmails(team);
    }
  }

  /* Emails the caller has proven they control. */
  const proofs =
    body.emailProofs && typeof body.emailProofs === "object"
      ? (body.emailProofs as Record<string, unknown>)
      : {};
  const skip = await otpSkipVerify();
  const otpReady = await otpConfigured();
  const emails: string[] = [];
  for (const email of requestedEmails) {
    const key = normaliseEmail(email);
    if (skip || teamEmails.has(key)) {
      emails.push(email);
      continue;
    }
    const proof = proofs[key];
    if (otpReady && typeof proof === "string" && (await verifyProof(proof, key, "player-email"))) {
      emails.push(email);
    }
  }
  const studentIds = emails.length > 0 || exceptTeamId ? requestedIds : [];

  const members: DuplicateCheckResponse["members"] = [];
  const teamNameResult: DuplicateCheckResponse["teamName"] = { taken: false, label: null };

  /* A name the organisers' own rules reject can never be registered, so there is
     nothing to collide with — the captain sees the policy message instead, and we
     save a query. */
  if (teamName && !teamNamePolicyError(teamName)) {
    const clash = await findTeamNameClash(teamNameKey(teamName), exceptTeamId);
    if (clash) teamNameResult.taken = true;
    teamNameResult.label = clash;
  }

  if (emails.length > 0 || studentIds.length > 0) {
    /* One query for both field types: `findMemberClashes` already matches emails
       and student IDs together and reports which rule caught each person. */
    const rows = [
      ...emails.map((email) => ({ email, studentId: "" })),
      ...studentIds.map((studentId) => ({ email: "", studentId })),
    ];
    const clashes = await findMemberClashes(rows, exceptTeamId);

    for (const email of emails) {
      members.push({
        field: "email",
        value: email,
        taken: clashes.some((clash) => clash.field === "email" && clash.email.toLowerCase() === email.toLowerCase()),
      });
    }
    for (const studentId of studentIds) {
      members.push({
        field: "studentId",
        value: studentId,
        taken: clashes.some((clash) => clash.field === "studentId" && clash.studentId.toLowerCase() === studentId.toLowerCase()),
      });
    }
  }

  return NextResponse.json({ teamName: teamNameResult, members } satisfies DuplicateCheckResponse);
}
