"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  Loader2,
  RotateCcw,
  Send,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isGender, type Gender } from "@/lib/games";
import {
  gameById,
  isGameAllowedForDivision,
  rosterRulesFor,
  type TournamentConfig,
} from "@/lib/tournament";
import type { RulebookVersions } from "@/lib/store";
import {
  EMPTY_DRAFT,
  STEPS,
  STEP_COUNT,
  countRoles,
  effectiveLeaderIndex,
  isStepValid,
  normaliseMember,
  resolveRole,
  resizeRoster,
  stepSummary,
  toPayload,
  validateDraft,
  type MemberDraft,
  type RegistrationDraft,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { RevealFieldErrors } from "@/components/ui/field";
import { KsuCrownMark } from "@/components/brand/ksu-crown-logo";
import { StepTeam } from "./step-team";
import { StepGame } from "./step-game";
import { StepRoster } from "./step-roster";
import { StepReview } from "./step-review";
import { SuccessPanel, type SubmissionResult } from "./success-panel";
import { useDuplicateWatch, type DuplicateWatch } from "./use-duplicate-watch";
import type { LiveRosterState } from "./types";
import { useLanguage } from "./language-provider";
import { STEP_BLURB_KEYS, STEP_TITLE_KEYS } from "@/lib/i18n";

/**
 * Duplicates the server has confirmed, worded as the form's own validation.
 *
 * Folded into the error map rather than shown separately so a taken name refuses
 * Continue and reveals itself exactly like any other problem — the captain should
 * not have to learn a second, parallel vocabulary for "this field is wrong".
 *
 * Only *taken* produces a message. "Checking" and "free" are states of a field
 * that is fine, and "idle" means nothing is known yet; none of them are errors.
 */
function duplicateErrorsFor(
  duplicates: DuplicateWatch,
  draft: RegistrationDraft,
  t: (key: DuplicateErrorKey) => string,
): Record<string, string> {
  const found: Record<string, string> = {};

  if (duplicates.teamName === "taken") {
    found.teamName = t("dupError.teamName");
  }

  draft.members.forEach((_, index) => {
    if (duplicates.member(index, "email") === "taken") {
      found[`member.${index}.email`] = t("dupError.email");
    }
    if (duplicates.member(index, "studentId") === "taken") {
      found[`member.${index}.studentId`] = t("dupError.studentId");
    }
  });

  return found;
}

type DuplicateErrorKey = "dupError.teamName" | "dupError.email" | "dupError.studentId";

/** v3: rosters carry roles and per-member verification, so old drafts are dropped. */
/*
 * Unfinished forms hold names, emails, student IDs and phone numbers, so they are
 * kept only for the browser session (gone when the tab or browser closes) and for
 * at most six hours — not in long-lived localStorage, where they would linger on a
 * shared device. The old localStorage copy is wiped on first load.
 */
const DRAFT_KEY = "ksu-crown.draft.v4";
const LEGACY_DRAFT_KEY = "ksu-crown.draft.v3";
/**
 * The credentials for the registration draft on the server.
 *
 * Kept beside the form so a reload does not orphan a draft whose links are already
 * in three players' inboxes — without this, returning to the page would create a
 * second draft and silently invalidate every link already sent.
 */
const DRAFT_LINK_KEY = "ksu-crown.draft-link.v1";
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

function readStoredDraft(): string | null {
  try {
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Storage may be blocked.
  }
  const raw = window.sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const wrapped = JSON.parse(raw) as { savedAt?: unknown; draft?: unknown };
    if (typeof wrapped.savedAt !== "number" || Date.now() - wrapped.savedAt > DRAFT_TTL_MS) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return JSON.stringify(wrapped.draft ?? null);
  } catch {
    window.sessionStorage.removeItem(DRAFT_KEY);
    return null;
  }
}

function readStoredDraftLink(): { id: string; secret: string } | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; secret?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.secret !== "string") return null;
    return { id: parsed.id, secret: parsed.secret };
  } catch {
    return null;
  }
}

function storeDraftLink(link: { id: string; secret: string } | null) {
  try {
    if (link) window.sessionStorage.setItem(DRAFT_LINK_KEY, JSON.stringify(link));
    else window.sessionStorage.removeItem(DRAFT_LINK_KEY);
  } catch {
    // Storage may be blocked; the draft then simply restarts on reload.
  }
}

function clearStoredDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
    window.sessionStorage.removeItem(DRAFT_LINK_KEY);
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Storage may be blocked.
  }
}

/** Only worth announcing a restore when the draft holds real work. */
function draftHasContent(draft: Partial<RegistrationDraft>) {
  return Boolean(
    draft.teamName?.trim() ||
      draft.gender ||
      draft.gameId ||
      draft.members?.some(
        (member) =>
          member?.fullName?.trim() ||
          member?.email?.trim() ||
          member?.studentId?.trim() ||
          member?.gameTag?.trim() ||
          member?.discord?.trim() ||
          member?.phone?.trim(),
      ),
  );
}

export interface RegistrationFormProps {
  config: TournamentConfig;
  /** Game id → cache-busting version, for the cards that have a logo. */
  logoVersions: Record<string, number>;
  /** `create` posts a new team; `edit` replaces an existing one. */
  mode?: "create" | "edit";
  /** Required when `mode` is `edit`. */
  reference?: string;
  /** Signed proof that the caller may edit this registration. */
  editProof?: string;
  /** Pre-filled draft — an edit loads the stored team here. */
  initialDraft?: RegistrationDraft;
  /** Called when an edit is saved, so the shell can close the tab. */
  onSaved?: (teamName: string) => void;
  /**
   * Which games have a rulebook, keyed by game id.
   *
   * Passed in rather than read here, because the documents live in the database and
   * are fetched by the server component that renders the page. They do not decide
   * *whether* the rules are acknowledged — that is always required — only whether the
   * box stays locked until the right document has been shown.
   */
  rulebooks?: RulebookVersions;
  /**
   * Which games' rulebooks the viewer has rendered this session.
   *
   * Only unlocks the acknowledgement, and only for the team's own game — reading the
   * Rocket League rules says nothing about the EA FC rules. It is deliberately *not*
   * what is validated, because "the document appeared on screen" is not something the
   * server can ever confirm; the captain's own confirmation is what is recorded.
   */
  gamesRead?: ReadonlySet<string>;
  /**
   * Open the rulebook tab at a particular game.
   *
   * The Review step's acknowledgement links here, so a captain who is told to read
   * their game's rules lands on them rather than on a chooser.
   */
  onOpenRulebook?: (gameId: string) => void;
  /** Report the chosen game upward, so the rulebook tab can open on it. */
  onGameChange?: (gameId: string) => void;
}

/**
 * The registration wizard.
 *
 * One component drives both the public form and the edit tab: an edit is just the
 * same steps with the stored team pre-filled and a different HTTP verb at the
 * end. Keeping a single editor is what stops the two from disagreeing about the
 * rules.
 */
export function RegistrationForm({
  config,
  logoVersions,
  mode = "create",
  reference,
  editProof,
  initialDraft,
  onSaved,
  rulebooks = {},
  gamesRead,
  onOpenRulebook,
  onGameChange,
}: RegistrationFormProps) {
  const editing = mode === "edit";
  const { t, message, language, errors: translateErrorMap } = useLanguage();

  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<RegistrationDraft>(initialDraft ?? EMPTY_DRAFT);
  const [hydrated, setHydrated] = React.useState(editing);
  const [restored, setRestored] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [conflicts, setConflicts] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<SubmissionResult | null>(null);
  const [savedName, setSavedName] = React.useState<string | null>(null);
  /**
   * Steps the captain has tried to move past, whose errors should therefore be
   * on show. Without this, an untouched form would greet them with a page of red.
   */
  const [attempted, setAttempted] = React.useState<ReadonlySet<number>>(new Set());
  /**
   * Set when switching game silently changed the roster size.
   *
   * Stores the *facts* rather than a finished sentence: a rendered string would be
   * frozen in whatever language was current at the moment the game changed, and
   * this is state that outlives that change — it is dismissed by hand, so it can sit
   * on screen across anything else that happens. Rendering it at display time means
   * it always reads in the language the captain is actually using.
   */
  /**
   * The registration draft: the server-side record that lets teammates fill in
   * their own details *before* the captain submits, and that the review step polls
   * so those answers appear as they arrive.
   *
   * The browser holds the id and the secret; the database holds only the hash of
   * the secret, so the pair is a capability — losing it means starting a new draft,
   * not losing a registration.
   */
  const [draftLink, setDraftLink] = React.useState<{ id: string; secret: string } | null>(null);
  const [live, setLive] = React.useState<LiveRosterState>({
    status: "idle",
    expected: 0,
    completed: 0,
    pendingPositions: [],
    error: null,
    refresh: () => {},
  });
  /** Set by the first press of Submit while players are still answering. */
  const [pendingConfirmed, setPendingConfirmed] = React.useState(false);
  /**
   * Whether a draft has already been requested for this visit to the review step.
   *
   * The rail lets the captain jump straight to Review, skipping the Continue press
   * that normally starts the draft — so the review step has to be able to start it
   * too. This ref is what stops those two paths from both firing and creating two
   * drafts (and sending two rounds of email) for one roster.
   */
  const draftRequested = React.useRef(false);
  const [rosterNotice, setRosterNotice] = React.useState<{
    game: string;
    from: number;
    to: number;
  } | null>(null);

  const panelRef = React.useRef<HTMLDivElement>(null);

  /* The config arrives from the server and never changes mid-session, but the
     restore effect must not re-run if it ever does — read it through a ref. */
  const configRef = React.useRef(config);
  React.useEffect(() => {
    configRef.current = config;
  }, [config]);

  /* ------------------------------------------------------------------ */
  /* Draft persistence — restoring only applies to a fresh registration   */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    if (editing) return;

    const active = configRef.current;
    try {
      const storedDraft = readStoredDraft();
      if (storedDraft) {
        const parsed = JSON.parse(storedDraft) as Partial<RegistrationDraft>;
        if (parsed && typeof parsed === "object") {
          const stored = Array.isArray(parsed.members) ? parsed.members : [];
          const gameId = typeof parsed.gameId === "string" ? parsed.gameId : "";

          /* Size the restored roster by the restored game's rules, not by the
             tournament cap. Restoring "however many rows were saved" is how a
             saved OverWatch squad could come back at five people after the
             captain had switched to a 1v1 game. */
          const rules = rosterRulesFor(active, gameById(active, gameId));
          /* Restore the shape the controls describe — a fixed line-up, the bench that
             was chosen, and a coach if one was — rather than "however many rows were
             saved". A saved roster from before the controls existed therefore comes
             back legal instead of one row too long. */
          const restored = stored.map((member) => normaliseMember(member, active));
          const restoredCounts = countRoles(restored, rules);
          const restoredMembers = resizeRoster(
            restored,
            rules,
            restoredCounts.substitutes,
            restoredCounts.coaches > 0,
          );

          setDraft({
            teamName: typeof parsed.teamName === "string" ? parsed.teamName : "",
            gender: isGender(parsed.gender) ? parsed.gender : "",
            gameId,
            members: restoredMembers,
            /* The registrant is the leader, always the first row. */
            leaderIndex: restoredMembers.length > 0 ? 0 : null,
            // Consent is deliberately not restored: it is given per submission.
            consentGiven: false,
            rulesAccepted: false,
          });
          // An untouched draft would otherwise announce a restore on first load.
          if (draftHasContent(parsed)) setRestored(true);
        }
      }
    } catch {
      // A corrupt draft should never block a fresh registration.
    } finally {
      setHydrated(true);
    }
  }, [editing]);

  React.useEffect(() => {
    if (editing || !hydrated || result) return;
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), draft }));
    } catch {
      // Storage may be full or blocked; the form still works in memory.
    }
  }, [draft, hydrated, result, editing]);

  /* ------------------------------------------------------------------ */
  /* State updates with cross-field side effects                          */
  /* ------------------------------------------------------------------ */

  const update = React.useCallback(
    <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => {
      setDraft((current) => {
        const next: RegistrationDraft = { ...current, [key]: value };

        // Switching division can invalidate the chosen game.
        if (key === "gender") {
          const gender = value as Gender | "";
          if (next.gameId && !isGameAllowedForDivision(config, next.gameId, gender)) {
            next.gameId = "";
          }
        }

        // Switching game rebuilds the roster for that game's squad rules.
        if (key === "gameId") {
          const game = gameById(config, value as string);
          if (game) {
            const rules = rosterRulesFor(config, game);
            const rulesBefore = rosterRulesFor(config, gameById(config, current.gameId));
            const previousLength = next.members.length;

            /* The line-up is the new game's to decide; the bench and the coach are
               kept where the new game still allows them, because the captain asked
               for them and imposing a reset would silently discard a choice. Any
               row the smaller game cannot hold is dropped, and `resizeRoster`
               clamps both counts. */
            const before = countRoles(next.members, rulesBefore);
            next.members = resizeRoster(next.members, rules, before.substitutes, before.coaches > 0);

            /* The registrant is the leader, and is always the first row. */
            next.leaderIndex = next.members.length > 0 ? 0 : null;

            const removed = Math.max(0, previousLength - rules.starters);

            if (removed > 0) {
              /* Just the numbers. The sentence is built when it is shown, so it
                 follows the language rather than the moment of the change. */
              setRosterNotice({
                game: game.name,
                from: previousLength,
                to: rules.starters,
              });
            } else {
              setRosterNotice(null);
            }
          }
        }

        return next;
      });
    },
    /* `config` only. Nothing translated is produced in here — that was the bug: this
       callback used to build the roster notice with `t` and never listed it, so it
       kept whichever `t` existed when it was created and the notice came out in the
       old language. Messages are now rendered where they are shown. */
    [config],
  );

  /** Patch one roster slot — every per-member field goes through here. */
  const setMember = React.useCallback((index: number, patch: Partial<MemberDraft>) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member, i) => (i === index ? { ...member, ...patch } : member)),
    }));
  }, []);

  /** Answer one organiser-defined requirement for one member. */
  const setRequirement = React.useCallback((index: number, requirementId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member, i) =>
        i === index
          ? { ...member, requirements: { ...member.requirements, [requirementId]: value } }
          : member,
      ),
    }));
  }, []);

  /* Tell the shell which game is chosen, so the rulebook tab opens on the right
     document rather than on whichever one happens to be first. The shell deliberately
     does not read the draft itself — one callback beats two components reading the
     same browser storage and disagreeing. */
  React.useEffect(() => {
    if (draft.gameId) onGameChange?.(draft.gameId);
  }, [draft.gameId, onGameChange]);

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */

  const { errors, warnings } = React.useMemo(() => validateDraft(draft, config), [draft, config]);

  /* Asked once for the whole draft, debounced — see the hook for why it is not
     per field. */
  /* `reference` is passed only while editing. A captain reopening their own
     registration was being told their own team name and their own members'
     addresses were taken, because the live check had no way to know the values
     were already theirs. */
  const duplicates = useDuplicateWatch(draft, {
    exceptReference: editing ? reference ?? "" : "",
    editProof: editing ? editProof ?? "" : "",
  });

  const duplicateErrors = duplicateErrorsFor(duplicates, draft, t);

  /* Validation wins any collision: an address that is both malformed and taken is
     reported as malformed, because that one they can actually fix. */
  const allErrors = { ...duplicateErrors, ...errors };

  const canAdvance = isStepValid(step, allErrors);
  const isReview = step === STEP_COUNT - 1;
  const formValid = Object.keys(allErrors).length === 0;

  /* Every step renders `errors[...]` directly, so the map is translated once here
     rather than in each of the four steps. */
  const shownErrors = translateErrorMap(allErrors);

  /* The one-line reason the current step is blocked, shown in the footer. Read once
     rather than twice — it is rendered as a condition and as the text — and kept
     raw, because the footer is where it gets translated. */
  const stepSummaryText = stepSummary(step, allErrors);

  const goToStep = React.useCallback((next: number) => {
    setStep(Math.max(0, Math.min(STEP_COUNT - 1, next)));
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  /* ------------------------------------------------------------------ */
  /* Draft: teammates complete their own details before submitting       */
  /* ------------------------------------------------------------------ */

  /**
   * Hand the roster to the server and email every teammate their link.
   *
   * Called when the captain leaves the roster step, which is the whole point of
   * the ordering: the players answer while the captain is still on the review
   * step, so the roster is complete by the time they press Submit. It is safe to
   * call again — a refresh reuses the same draft and keeps anyone who has already
   * answered, so going back to fix a role does not re-ask three players.
   *
   * Failure is never fatal: the review step still opens, and says plainly that the
   * links could not be sent.
   */
  const startDraft = React.useCallback(async () => {
    if (editing) return;

    const rules = rosterRulesFor(config, gameById(config, draft.gameId));
    const leaderIndex = effectiveLeaderIndex(draft, rules) ?? 0;
    setLive((current) => ({ ...current, status: "sending", error: null }));

    try {
      const response = await fetch("/api/registrations/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftLink?.id,
          secret: draftLink?.secret,
          teamName: draft.teamName,
          gameId: draft.gameId,
          gender: draft.gender,
          leaderIndex,
          language,
          members: draft.members.map((member) => ({
            role: resolveRole(member, rules),
            universityId: member.universityId,
            email: member.email.trim(),
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok || body.ok !== true) {
        setLive((current) => ({
          ...current,
          status: "error",
          error: message(
            typeof body.error === "string" ? body.error : t("live.error"),
          ),
        }));
        return;
      }

      const id = typeof body.draftId === "string" ? body.draftId : "";
      const secret = typeof body.secret === "string" ? body.secret : "";
      if (id && secret) setDraftLink({ id, secret });

      /* Nothing has been answered yet, so every teammate starts pending. The first
         poll replaces this with the truth; without it the panel would claim
         everybody had finished for the four seconds before that. */
      setLive((current) => ({
        ...current,
        status: "live",
        error: null,
        expected: Math.max(0, draft.members.length - 1),
        completed: 0,
        pendingPositions: draft.members
          .map((_, index) => index)
          .filter((index) => index !== leaderIndex),
      }));
    } catch {
      setLive((current) => ({ ...current, status: "error", error: t("live.unreachable") }));
    }
    /* `draft` and `rules` are read fresh each call; the callback is recreated when
       either changes, which is what keeps the roster it sends current. */
  }, [editing, draft, config, draftLink, language, message, t]);

  /* Refresh the live picture now — used after the captain presses "Refresh". */
  const refreshLive = React.useCallback(async () => {
    if (!draftLink) return;
    try {
      const response = await fetch(
        `/api/registrations/draft/${encodeURIComponent(draftLink.id)}?secret=${encodeURIComponent(draftLink.secret)}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || body.ok !== true) return;

      const serverDraft = body.draft as
        | { members?: { position: number; completed: boolean; email: string; fullName: string; gameTag: string; studentId: string; discord: string; phone: string; requirements: { id: string; value: string }[] }[]; leaderIndex?: number }
        | undefined;
      const members = serverDraft?.members ?? [];
      const leaderIndexValue = typeof serverDraft?.leaderIndex === "number" ? serverDraft.leaderIndex : 0;

      /* Fold what has arrived into the roster on screen: the captain should see a
         name appear, not a "someone finished" badge they have to act on. Matching
         is by position *and* address, so a row the captain has since retyped is
         never overwritten with someone else's details. */
      setDraft((current) => {
        let changed = false;
        const members_ = current.members.map((member, index) => {
          const answered = members.find((entry) => entry.position === index);
          if (!answered?.completed) return member;
          if (answered.email.toLowerCase() !== member.email.trim().toLowerCase()) return member;

          /* Polling must not rewrite the draft on every tick: an unchanged roster
             returns the same objects, so React bails out and the session-storage
             autosave does not run every four seconds. */
          if (
            member.fullName === answered.fullName &&
            member.gameTag === answered.gameTag &&
            member.studentId === answered.studentId &&
            member.discord === answered.discord &&
            member.phone === answered.phone
          ) {
            return member;
          }

          changed = true;
          return {
            ...member,
            fullName: answered.fullName,
            gameTag: answered.gameTag,
            studentId: answered.studentId,
            discord: answered.discord,
            phone: answered.phone,
            requirements: {
              ...member.requirements,
              ...Object.fromEntries(answered.requirements.map((entry) => [entry.id, entry.value])),
            },
          };
        });

        return changed ? { ...current, members: members_ } : current;
      });

      const expected = members.filter((entry) => entry.position !== leaderIndexValue).length;
      const completed = members.filter(
        (entry) => entry.position !== leaderIndexValue && entry.completed,
      ).length;

      setLive((current) => ({
        ...current,
        status: "live",
        expected,
        completed,
        pendingPositions: members
          .filter((entry) => entry.position !== leaderIndexValue && !entry.completed)
          .map((entry) => entry.position),
        error: null,
      }));
    } catch {
      // A dropped poll is not worth a message; the next one will report the truth.
    }
  }, [draftLink]);

  /* Remember the credentials for as long as the form is open, so a reload rejoins
     the same draft instead of invalidating the links already sent. */
  React.useEffect(() => {
    storeDraftLink(draftLink);
  }, [draftLink]);

  /* Restored once, lazily: only in the browser, and only for a form that is not
     editing somebody else's registration. */
  React.useEffect(() => {
    if (editing) return;
    const stored = readStoredDraftLink();
    if (stored) setDraftLink(stored);
  }, [editing]);

  /* The state carries the answers; the action is attached at render time so the
     object handed to the review step is always current. */
  const liveState: LiveRosterState = {
    ...live,
    /* Without a draft there is nothing to poll — the retry is another attempt to
       create it, so the "already asked" guard is released first. */
    refresh: () => {
      if (draftLink) {
        void refreshLive();
        return;
      }
      draftRequested.current = false;
      void startDraft();
    },
  };

  /* Reached Review without passing through Continue — start the draft here instead,
     once. A failure leaves `draftLink` empty but the ref set, so this does not spin:
     the panel offers a retry, which resets the ref. */
  React.useEffect(() => {
    if (editing || result || step !== STEP_COUNT - 1 || draftLink || draftRequested.current) return;
    draftRequested.current = true;
    void startDraft();
  }, [editing, result, step, draftLink, startDraft]);

  /* Poll while the review step is open. Four seconds is fast enough to feel live
     and slow enough that a class of captains on one Wi-Fi does not look like an
     attack. */
  React.useEffect(() => {
    if (editing || !draftLink || result || step !== STEP_COUNT - 1) return;
    void refreshLive();
    const timer = setInterval(() => void refreshLive(), 4000);
    return () => clearInterval(timer);
  }, [editing, draftLink, result, step, refreshLive]);

  /**
   * Move on, or — if this step is not finished — reveal what is missing.
   *
   * The refusal and the reveal have to happen together: a disabled Continue
   * button on its own leaves the captain hunting for the problem, and revealing
   * on every render would put them back in front of a form that is already
   * complaining before they have typed anything.
   */
  const advance = () => {
    /* Confirm the duplicate answers against the database before acting on them.
       A remembered "taken" is what blocks the captain here, and it could be
       describing a team an organiser has since deleted. */
    duplicates.refresh();

    if (!canAdvance) {
      setAttempted((current) => new Set(current).add(step));
      return;
    }

    /* Leaving the roster is the moment the teammates can be asked: everything the
       captain owes them (role, university, address) is now known, and the players
       answer while the review step is open. Started here rather than on a timer so
       it always describes the roster that was actually accepted. */
    if (step === 2) {
      draftRequested.current = true;
      void startDraft();
    }

    goToStep(step + 1);
  };

  /* ------------------------------------------------------------------ */
  /* Submit                                                              */
  /* ------------------------------------------------------------------ */

  const submit = async () => {
    /* The submit button is never disabled, so an invalid form reaches this handler.
       Reveal what is missing — almost always the consent box the captain has not been
       asked about yet — rather than posting nothing and leaving the button apparently
       dead. This is the review step's counterpart to `advance()` on earlier steps,
       where pressing Continue is how the captain asks "what is missing?". */
    if (!formValid) {
      setAttempted((current) => new Set(current).add(step));
      return;
    }

    /* Players were asked before submission, so by now most rosters are complete.
       When one has not answered yet the captain is told once — pressing Submit
       again registers anyway. Blocking outright would let one unread email strand
       a whole team, and the links stay valid either way. */
    const pendingPlayers = live.status === "live" ? live.pendingPositions.length : 0;
    if (pendingPlayers > 0 && !pendingConfirmed) {
      setPendingConfirmed(true);
      return;
    }

    setSubmitting(true);
    setServerError(null);
    setConflicts([]);
    try {
      const payload = toPayload(draft, config);
      const url = editing
        ? `/api/registrations/${encodeURIComponent(reference ?? "")}`
        : "/api/registrations";

      const response = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        /* `language` rides alongside the payload so the confirmation email is written
         in the language the captain used. Validation ignores keys it does not know. */
        /* The draft credentials ride along so the server can fold in the details the
           teammates entered, and carry their completion tokens into the stored team.
           They are a capability: the id alone opens nothing. */
        body: JSON.stringify(
          editing
            ? { proof: editProof, payload, language }
            : {
                ...payload,
                language,
                draftId: draftLink?.id,
                draftSecret: draftLink?.secret,
              },
        ),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setServerError(typeof body.error === "string" ? message(body.error) : t("error.submitFailed"));
        if (Array.isArray(body.alreadyRegistered)) {
          setConflicts(
            (body.alreadyRegistered as { email?: string; teamName?: string; field?: string }[]).map(
              (row) =>
                t("conflict.row", {
                  value: row.email ?? "",
                  team: row.teamName ?? "",
                }),
            ),
          );
        }
        return;
      }

      clearStoredDraft();

      if (editing) {
        setSavedName(typeof body.teamName === "string" ? body.teamName : "your team");
        onSaved?.(typeof body.teamName === "string" ? body.teamName : "");
      } else {
        setResult(body as unknown as SubmissionResult);
      }
    } catch {
      setServerError(t("error.unreachable"));
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    clearStoredDraft();
    setDraft(EMPTY_DRAFT);
    setResult(null);
    setRestored(false);
    setServerError(null);
    setConflicts([]);
    setStep(0);

    /* A new team is a new draft: keeping the previous credentials would write the
       next roster over the one whose links are already in players' inboxes. */
    draftRequested.current = false;
    setDraftLink(null);
    setPendingConfirmed(false);
    setLive({
      status: "idle",
      expected: 0,
      completed: 0,
      pendingPositions: [],
      error: null,
      refresh: () => {},
    });
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  const stepProps = {
    config,
    logoVersions,
    draft,
    duplicates,
    update,
    setMember,
    setRequirement,
    /* Translated on the way in, so every step renders words rather than the keys
       or English strings that validation produced. */
    errors: shownErrors,
    warnings,
    goToStep,
    /* A step's errors stay quiet until the captain has tried to move past it. */
    revealed: attempted.has(step),
    rulebooks,
    gamesRead,
    onOpenRulebook,
    live: liveState,
  };
  const stepBody = [
    <StepTeam key="team" {...stepProps} />,
    <StepGame key="game" {...stepProps} />,
    <StepRoster key="roster" {...stepProps} />,
    <StepReview key="review" {...stepProps} />,
  ][step];

  if (savedName) {
    return <SavedPanel teamName={savedName} reference={reference ?? ""} onClose={() => onSaved?.("")} />;
  }
  return (
    <div ref={panelRef} className="scroll-mt-8">
      {result ? (
        <SuccessPanel result={result} discordInviteUrl={config.discordInviteUrl} onStartOver={startOver} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15.5rem_1fr]">
          {/* --------------------------- Step rail --------------------------- */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-3 lg:hidden">
              <div className="mb-2 flex items-center justify-between text-[0.6875rem] font-bold tracking-[0.14em] text-ash uppercase">
                <span>{t("wizard.stepOf", { step: step + 1, total: STEP_COUNT })}</span>
                <span className="text-brand">{t(STEP_TITLE_KEYS[step])}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-wall-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-bright to-brand-deep transition-all duration-300"
                  style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
                />
              </div>
            </div>

            <nav
              className="panel hidden rounded-2xl p-3 lg:block"
              aria-label={t("wizard.railLabel")}
            >
              <ol className="space-y-1">
                {STEPS.map((entry, index) => {
                  const done = index < step && isStepValid(index, allErrors);
                  const active = index === step;
                  const reachable = index <= step || isStepValid(index - 1, allErrors);
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={!reachable}
                        onClick={() => goToStep(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
                          active
                            ? "bg-brand/12 text-brand"
                            : reachable
                              ? "text-ash hover:bg-wall-700/60 hover:text-snow"
                              : "cursor-not-allowed text-ash/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[0.6875rem] transition-colors",
                            active
                              ? "border-brand bg-brand text-wall-950"
                              : done
                                ? "border-brand/50 bg-brand/15 text-brand"
                                : "border-[rgba(79, 182, 208,0.22)] text-ash",
                          )}
                        >
                          {done ? <Check className="size-3.5" /> : index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold tracking-wide">
                            {t(STEP_TITLE_KEYS[index])}
                          </span>
                          <span className="block truncate text-[0.625rem] text-ash/70">
                            {t(STEP_BLURB_KEYS[index])}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 border-t border-[rgba(79, 182, 208,0.12)] pt-3">
                <div className="flex items-center gap-2 px-3 text-[0.6875rem] text-ash">
                  <KsuCrownMark size="sm" className="opacity-70" />
                  <span>
                    {formValid
                      ? t("wizard.ready")
                      : t("wizard.fieldsToGo", { count: Object.keys(allErrors).length })}
                  </span>
                </div>
              </div>
            </nav>
          </aside>

          {/* ---------------------------- Content ---------------------------- */}
          <main className="min-w-0">
            <div className="panel overflow-hidden rounded-3xl">
              <div className="relative border-b border-[rgba(79, 182, 208,0.12)] px-5 py-4 sm:px-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-display tracking-wide text-snow">
                      {t(STEP_TITLE_KEYS[step])}
                    </h2>
                    <p className="mt-0.5 text-xs text-ash">{t(STEP_BLURB_KEYS[step])}</p>
                  </div>
                  <span className="font-mono text-[0.6875rem] text-ash">
                    {String(step + 1).padStart(2, "0")} / {String(STEP_COUNT).padStart(2, "0")}
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
              </div>

              {restored && step === 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-brand/25 bg-brand/8 px-5 py-3 sm:px-7">
                  <RotateCcw className="size-4 shrink-0 text-brand" />
                  <p className="text-xs text-ash">{t("success.draftRestored")}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ms-auto h-7 px-2 text-[0.6875rem]"
                    onClick={startOver}
                  >
                    <X className="size-3" />
                    {t("common.startOver")}
                  </Button>
                </div>
              )}

              <div className="px-5 py-6 sm:px-7 sm:py-8">
                {/* Repeated inside the form, because the landing page is one screen
                    back by the time the captain is filling this in. */}
                {!editing && step === 0 && (
                  <p className="mb-5 flex items-start gap-2 rounded-xl border border-amber-400/45 bg-amber-400/10 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-amber-100/90">
                    <AlertCircle className="mt-px size-3.5 shrink-0 text-amber-300" />
                    <span>{t("home.leaderWarning")}</span>
                  </p>
                )}
                {/* Switching game can resize the roster; say so rather than
                    letting members vanish quietly. */}
                {rosterNotice && (
                  <div className="mb-5 flex flex-wrap items-start gap-3 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5">
                    <Users className="mt-px size-3.5 shrink-0 text-amber-300" />
                    <p className="min-w-0 flex-1 text-[0.6875rem] leading-relaxed text-amber-100/90">
                      {t(rosterNotice.to === 1 ? "roster.trimmedOne" : "roster.trimmed", {
                        game: rosterNotice.game,
                        count: rosterNotice.to,
                        from: rosterNotice.from,
                        to: rosterNotice.to,
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRosterNotice(null)}
                      aria-label={t("common.dismiss")}
                      className="shrink-0 text-amber-300/70 transition-colors hover:text-amber-200"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}

                {/* Errors stay hidden until a field is left or the step is
                    attempted, so an untouched form is never already red. */}
                <RevealFieldErrors when={attempted.has(step)}>{stepBody}</RevealFieldErrors>
              </div>

              <div className="border-t border-[rgba(79, 182, 208,0.12)] bg-wall-950/40 px-5 py-4 sm:px-7">
                {serverError && (
                  <div className="mb-4 rounded-xl border border-danger/45 bg-danger/10 p-3">
                    <p className="flex items-start gap-2 text-xs text-danger">
                      <AlertCircle className="mt-px size-3.5 shrink-0" />
                      <span>{serverError}</span>
                    </p>
                    {conflicts.length > 0 && (
                      <ul className="mt-2 space-y-1 ps-5">
                        {conflicts.map((conflict) => (
                          <li key={conflict} className="text-[0.6875rem] text-danger/80">
                            • {conflict}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Only once they have tried to move on. Showing this the moment
                    the step opens would be the form complaining before it has been
                    told anything.

                    `message(…)` is essential here: `stepSummary` returns a
                    validation message straight out of `validateDraft`, which emits
                    English because it also runs on the server. Rendered raw, the
                    footer of the Arabic game step read "Choose a game" in English
                    while the identical field error beside it — which goes through
                    `translateErrorMap` — read "اختر لعبة". */}
                {!canAdvance && attempted.has(step) && stepSummaryText && (
                  <p className="mb-3 flex items-center gap-2 text-[0.6875rem] text-amber-300">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {message(stepSummaryText)}
                  </p>
                )}

                {/* The players were asked before this step, so an incomplete roster
                    here is a player who has not answered yet. Said once, with the
                    consequence spelled out: pressing Submit again registers anyway. */}
                {isReview && pendingConfirmed && live.pendingPositions.length > 0 && (
                  <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/8 px-3 py-2">
                    <p className="flex items-start gap-2 text-[0.6875rem] leading-relaxed text-amber-100/90">
                      <AlertCircle className="mt-px size-3.5 shrink-0 text-amber-300" />
                      {live.pendingPositions.length === 1
                        ? t("live.submitWarning", {
                            pending: 1,
                            total: live.expected,
                          })
                        : t("live.submitWarning", {
                            pending: live.pendingPositions.length,
                            total: live.expected,
                          })}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goToStep(step - 1)}
                    disabled={step === 0}
                  >
                    <ChevronLeft className="size-4 rtl:rotate-180" />
                    {t("common.back")}
                  </Button>

                  {isReview ? (
                    /* Never disabled, exactly like the Continue button above: pressing
                       it on an incomplete form is how the captain asks what is missing.
                       `submit` reveals the errors and returns rather than posting. */
                    <Button
                      type="button"
                      variant="chrome"
                      className="ms-auto min-w-48"
                      onClick={submit}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {editing ? t("common.saving") : t("common.submitting")}
                        </>
                      ) : (
                        <>
                          <Send className="size-4 rtl:rotate-180" />
                          {editing ? t("common.save") : t("common.submit")}
                        </>
                      )}
                    </Button>
                  ) : (
                    /* Deliberately never disabled: pressing it on an unfinished
                       step is how the captain asks "what is missing?" — disabling
                       it would leave them staring at a dead button. */
                    <Button type="button" className="ms-auto min-w-40" onClick={advance}>
                      {t("common.continue")}
                      <ArrowRight className="size-4 rtl:rotate-180" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

/** Shown after an edit is saved. */
function SavedPanel({
  teamName,
  reference,
  onClose,
}: {
  teamName: string;
  reference: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="panel animate-rise rounded-3xl p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
        <Check className="size-6" />
      </span>
      <h2 className="mt-4 font-display text-xl tracking-wide text-snow">{t("edit.saved")}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ash">
        {t("edit.savedBody", { team: teamName, reference })}
      </p>
      <Button variant="outline" className="mt-6" onClick={onClose}>
        <RotateCcw className="size-4" />
        {t("common.done")}
      </Button>
    </div>
  );
}
