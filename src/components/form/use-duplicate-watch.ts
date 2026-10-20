"use client";

import * as React from "react";
import { checkDuplicates } from "@/lib/duplicate-check";
import { teamNamePolicyError } from "@/lib/name-policy";
import { teamNameKey } from "@/lib/team-name";
import { EMAIL_PATTERN, type RegistrationDraft } from "@/lib/validation";

/**
 * Live duplicate checking for the form.
 *
 * One debounced request covers the whole draft — the team name plus every
 * completed email and student ID — rather than one request per keystroke per
 * field. The endpoint is rate limited, and batching is what keeps a captain
 * comfortably inside it.
 *
 * Answers are remembered by *value*, not by roster position, for two reasons: a
 * member can be reordered or removed without an answer following the wrong row,
 * and a value already answered is not asked about again, so nothing flickers
 * back to "checking" when an unrelated field changes.
 *
 * This is a courtesy, never the authority. A stale "free" is always caught by the
 * real check on submit, and a failed request shows nothing rather than claiming
 * the value is available.
 */

/**
 * Long enough that a typing burst is one request, short enough to feel immediate.
 *
 * Kept short deliberately: the answer is what tells a captain their team name is
 * taken, and a visible pause between typing and being told reads as the check not
 * working at all.
 */
const DEBOUNCE_MS = 400;

/**
 * The shortest value worth asking about.
 *
 * Two, because the organisers asked for it: a clash detected after two characters
 * is a clash the captain can fix while still thinking about the name they chose,
 * rather than after they have filled in the whole form.
 */
const MIN_TEAM_NAME = 2;
const MIN_STUDENT_ID = 2;

/** Past this, so many answers are remembered that stale ones outnumber useful
 *  ones — cheaper to forget them than to reason about them. */
const MAX_REMEMBERED = 200;

export type DuplicateState = "idle" | "checking" | "free" | "taken";

export interface DuplicateWatch {
  /** State of the team name currently typed. */
  teamName: DuplicateState;
  /** State of one roster slot's email or student ID. */
  member: (index: number, field: "email" | "studentId") => DuplicateState;
  /**
   * Ask again about everything on the draft, right now.
   *
   * Remembered answers are what stop the indicator flickering, but they also
   * mean a "taken" could outlive the registration that caused it — an organiser
   * deleting a team while a captain has the form open is not far-fetched. The
   * wizard calls this whenever a step is continued, so the answer behind a block
   * is always confirmed against the database at the moment it matters.
   */
  refresh: () => void;
}

/** Whether a value is complete enough that the server has anything to say. */
function isCheckable(field: "email" | "studentId" | "teamName", raw: string): boolean {
  if (field === "teamName") {
    /* A name the organisers' rules reject can never be registered, so the server
       has nothing to compare it against — the captain sees the policy message
       instead. */
    return raw.length >= MIN_TEAM_NAME && !teamNamePolicyError(raw);
  }
  if (field === "email") return EMAIL_PATTERN.test(raw);
  return raw.length >= MIN_STUDENT_ID;
}

/** The values worth asking about, read straight off the draft. */
function queryFor(draft: RegistrationDraft, reference: string, editProof: string) {
  const emails: string[] = [];
  const studentIds: string[] = [];
  const emailProofs: Record<string, string> = {};

  for (const member of draft.members) {
    const email = member.email.trim();
    if (isCheckable("email", email)) {
      emails.push(email);
      if (member.emailProof) emailProofs[email.toLowerCase()] = member.emailProof;
    }
    const studentId = member.studentId.trim();
    if (isCheckable("studentId", studentId)) studentIds.push(studentId);
  }

  const teamName = draft.teamName.trim();
  return {
    teamName: isCheckable("teamName", teamName) ? teamName : "",
    emails,
    studentIds,
    /* Travels with every request so the server can leave the edited team out of
       both queries. Without it the captain's own values read as someone else's. */
    reference,
    editProof: reference ? editProof : "",
    emailProofs,
  };
}

function teamKey(raw: string) {
  /* Normalised, so retyping "Team Falcons" as "Falcons" reuses the answer rather
     than asking a question whose answer is already known. */
  return `team:${teamNameKey(raw)}`;
}

function memberKey(field: "email" | "studentId", value: string) {
  return `${field}:${value.toLowerCase()}`;
}

export function useDuplicateWatch(
  draft: RegistrationDraft,
  options: {
    /**
     * Reference of the team being edited, if any.
     *
     * Set only on the edit path. A new registration has nothing to exclude, and
     * passing a reference there would be a way to silence the check.
     */
    exceptReference?: string;
    /** Signed proof for `exceptReference`; the server ignores the reference without it. */
    editProof?: string;
  } = {},
): DuplicateWatch {
  const { exceptReference = "", editProof = "" } = options;
  const [answers, setAnswers] = React.useState<Record<string, boolean>>({});
  const [pending, setPending] = React.useState(false);
  /** Bumped by `refresh`; the only thing that makes an answered value re-ask. */
  const [nonce, setNonce] = React.useState(0);

  const query = React.useMemo(
    () => queryFor(draft, exceptReference, editProof),
    [draft.teamName, draft.members, exceptReference, editProof],
  );
  /* Keyed on the values rather than the draft object, so editing a phone number
     neither cancels an in-flight check nor re-runs one already answered. */
  const key = JSON.stringify(query);

  React.useEffect(() => {
    const current = JSON.parse(key) as ReturnType<typeof queryFor>;
    if (!current.teamName && current.emails.length === 0 && current.studentIds.length === 0) {
      setPending(false);
      return;
    }

    const controller = new AbortController();
    setPending(true);

    const timer = window.setTimeout(() => {
      void checkDuplicates(current, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setPending(false);
        if (!result) return;

        setAnswers((previous) => {
          const next = Object.keys(previous).length > MAX_REMEMBERED ? {} : { ...previous };
          if (current.teamName) next[teamKey(current.teamName)] = result.teamName.taken;
          for (const entry of result.members) {
            next[memberKey(entry.field, entry.value)] = entry.taken;
          }
          return next;
        });
      });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    /* `nonce` is not read in the body — it is here purely so `refresh` can force a
       re-run. `key` covers every value, so nothing else needs to.
       eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [key, nonce]);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  const stateFor = (lookup: string | null): DuplicateState => {
    if (lookup === null) return "idle";
    const answer = answers[lookup];
    if (answer !== undefined) return answer ? "taken" : "free";
    return pending ? "checking" : "idle";
  };

  const rawName = draft.teamName.trim();

  return {
    teamName: stateFor(isCheckable("teamName", rawName) ? teamKey(rawName) : null),
    /* Rebuilt each render, but it is a couple of string operations — cheaper than
       the memo bookkeeping that would avoid it, and it always sees the current
       roster rather than a captured snapshot of it. */
    member: (index, field) => {
      const raw = (draft.members[index]?.[field] ?? "").trim();
      return stateFor(isCheckable(field, raw) ? memberKey(field, raw) : null);
    },
    refresh,
  };
}
