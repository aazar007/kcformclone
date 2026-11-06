"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Crown,
  KeyRound,
  Loader2,
  MailCheck,
  Save,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import type { TournamentConfig } from "@/lib/tournament";
import { digitsOnly } from "@/lib/i18n";
import { isMemberRole } from "@/lib/games";
import { roleLabelKey as roleLabelKeyName } from "@/lib/i18n";
import type { RegistrationDraft } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { RolePill } from "@/components/ui/field";
import { RegistrationForm } from "./registration-form";
import { MemberDetailsForm, type MemberDetailsValues } from "./member-details-form";
import { CardSummary } from "@/components/confirm/confirm-email-panel";
import { useLanguage } from "./language-provider";

/** How the decided role is written back to the person holding it. */
function roleLabelKey(role: Role) {
  switch (role) {
    case "LEADER":
      return "edit.roleLeader" as const;
    case "SUBSTITUTE":
      return "edit.roleSubstitute" as const;
    case "COACH":
      return "edit.roleCoach" as const;
    case "ORGANISER":
      return "edit.roleOrganiser" as const;
    default:
      return "edit.rolePlayer" as const;
  }
}

/** The role the server decided this caller holds, after verifying their address. */
type Role = "LEADER" | "PLAYER" | "SUBSTITUTE" | "COACH" | "ORGANISER";

interface OwnCard {
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  universityId: string;
  universityName: string;
  email: string;
  role: string;
  requirements: { id: string; label: string; value: string }[];
  completedAt: string | null;
}

type RosterRow = {
  id: string;
  position: number;
  fullName: string;
  role: string;
}

type OpenedSession = {
  role: Role;
  reference: string;
  teamName: string;
  gameName: string;
  proof: string;
  self: OwnCard;
  roster: RosterRow[] | null;
  requiresSetup: boolean;
}

/**
 * "Open my registration", in two steps and then by role.
 *
 * The reference code names a team; **the email address names a person on it**. The
 * pair is what decides the role, and a six-digit code mailed to that address is what
 * proves the caller owns it — without that, a reference pasted into a group chat
 * would hand every member's phone number to anyone who read the chat.
 *
 * After verification the server returns only what the role may see:
 *
 * - **Leader** — the roster's names and positions, which they arrange, and their own
 *   card. Never a teammate's personal details.
 * - **Player / substitute / coach** — their own card and nothing else.
 * - **Organiser** — the full editor, because the console credential outranks this flow.
 */
export function EditFlow({
  config,
  logoVersions,
  adminHref = null,
  initialReference = "",
}: {
  config: TournamentConfig;
  /** Game id → cache-busting version, for the cards that have a logo. */
  logoVersions: Record<string, number>;
  /**
   * The console's address, or null when the deployment has no console configured.
   *
   * A prop rather than a constant because `/admin` is no longer a real address — the
   * console answers on a segment derived from `ADMIN_SECRET` on the server.
   */
  adminHref?: string | null;
  /** A reference carried by a share link, so a player only has to add their address. */
  initialReference?: string;
}) {
  const { t, message, language } = useLanguage();
  const [stage, setStage] = React.useState<"identify" | "code" | "open">("identify");
  const [reference, setReference] = React.useState(initialReference.toUpperCase());
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [adminCode, setAdminCode] = React.useState("");
  const [asOrganiser, setAsOrganiser] = React.useState(false);
  const [session, setSession] = React.useState<OpenedSession | null>(null);
  const [organiserDraft, setOrganiserDraft] = React.useState<RegistrationDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, language }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        typeof payload.error === "string" ? message(payload.error) : t("edit.somethingWrong"),
      );
    }
    return payload;
  };

  const openSession = (payload: Record<string, unknown>) => {
    if (payload.stage !== "verified" || typeof payload.proof !== "string") {
      setError(t("edit.couldNotOpen"));
      return;
    }

    if (payload.role === "ORGANISER") {
      setOrganiserDraft((payload.draft as RegistrationDraft) ?? null);
      setSession({
        role: "ORGANISER",
        reference: String(payload.reference ?? ""),
        teamName: String(payload.teamName ?? ""),
        gameName: String(payload.gameName ?? ""),
        proof: payload.proof,
        self: {
          fullName: "",
          gameTag: "",
          studentId: "",
          discord: "",
          phone: "",
          universityId: "",
          universityName: "",
          email: "",
          role: "STARTER",
          requirements: [],
          completedAt: null,
        },
        roster: null,
        requiresSetup: false,
      });
      setStage("open");
      return;
    }

    const self = (payload.self ?? {}) as Partial<OwnCard>;
    setSession({
      role: (payload.role as Role) ?? "PLAYER",
      reference: String(payload.reference ?? ""),
      teamName: String(payload.teamName ?? ""),
      gameName: String(payload.gameName ?? ""),
      proof: payload.proof,
      self: {
        fullName: self.fullName ?? "",
        gameTag: self.gameTag ?? "",
        studentId: self.studentId ?? "",
        discord: self.discord ?? "",
        phone: self.phone ?? "",
        universityId: self.universityId ?? "",
        universityName: self.universityName ?? "",
        email: self.email ?? "",
        role: self.role ?? "STARTER",
        requirements: Array.isArray(self.requirements) ? self.requirements : [],
        completedAt: self.completedAt ?? null,
      },
      roster: Array.isArray(payload.roster) ? (payload.roster as RosterRow[]) : null,
      requiresSetup: payload.requiresSetup === true,
    });
    setStage("open");
  };

  const identify = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await call({ reference: reference.trim(), email: email.trim() });
      if (typeof payload.reference === "string") setReference(payload.reference);
      setStage("code");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openAsOrganiser = async () => {
    setBusy(true);
    setError(null);
    try {
      openSession(await call({ reference: reference.trim(), adminSecret: adminCode.trim() }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      openSession(await call({ reference: reference.trim(), email: email.trim(), code }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStage("identify");
    setReference(initialReference.toUpperCase());
    setEmail("");
    setCode("");
    setAdminCode("");
    setAsOrganiser(false);
    setSession(null);
    setOrganiserDraft(null);
    setError(null);
  };

  if (stage === "open" && session) {
    if (session.role === "ORGANISER" && organiserDraft) {
      return (
        <div className="space-y-4">
          <p className="mx-auto flex max-w-2xl items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-[0.6875rem] text-amber-100/90">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-amber-300" />
            <span>
              {t("edit.bannerOrganiser", {
                team: session.teamName || t("edit.bannerTeamFallback"),
              })}
            </span>
          </p>
          <RegistrationForm
            key={reference}
            config={config}
            logoVersions={logoVersions}
            mode="edit"
            reference={reference.trim().toUpperCase()}
            editProof={session.proof}
            initialDraft={organiserDraft}
            onSaved={reset}
          />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {session.role === "LEADER" ? (
          <LeaderPanel session={session} config={config} onClose={reset} />
        ) : (
          <MemberPanel session={session} config={config} onClose={reset} />
        )}
      </div>
    );
  }

  return (
    <div className="panel mx-auto max-w-lg rounded-3xl p-6 sm:p-8">
      <header className="mb-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-brand/40 bg-brand/10 text-brand">
          <KeyRound className="size-5" />
        </span>
        <h2 className="mt-3 font-display text-lg tracking-wide text-snow uppercase">
          {t("edit.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ash">
          {stage === "identify"
            ? t("edit.introIdentify")
            : asOrganiser
              ? t("edit.introOrganiser")
              : t("edit.introCode", { email: email || t("edit.emailFallback") })}
        </p>
      </header>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-danger/45 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {stage === "identify" ? (
        <div className="space-y-4">
          <Field
            label={t("edit.referenceLabel")}
            htmlFor="edit-reference"
            required
            hint={t("edit.hintReference")}
          >
            <Input
              id="edit-reference"
              dir="ltr"
              value={reference}
              autoComplete="off"
              placeholder={t("edit.referencePlaceholder")}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              className="font-mono tracking-[0.14em]"
            />
          </Field>

          <Field
            label={t("edit.emailLabel")}
            htmlFor="edit-email"
            required
            hint={t("edit.emailHint")}
          >
            <Input
              id="edit-email"
              dir="ltr"
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              placeholder={t("edit.emailPlaceholder")}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && reference.trim() && email.trim()) {
                  event.preventDefault();
                  void identify();
                }
              }}
              className="font-mono text-[0.8125rem]"
            />
          </Field>

          <Button
            type="button"
            className="w-full"
            disabled={busy || !reference.trim() || !email.trim()}
            onClick={() => void identify()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
            {t("edit.sendCode")}
          </Button>

          {/* An organiser helping a team out cannot read a student's inbox. The
              console credential is already the master key, so accepting it here
              grants strictly less than `/admin` does. */}
          <div className="border-t border-[rgba(79, 182, 208,0.12)] pt-3">
            {asOrganiser ? (
              <div className="space-y-2">
                <Field label={t("edit.adminLabel")} htmlFor="edit-admin" required>
                  <Input
                    id="edit-admin"
                    dir="ltr"
                    type="password"
                    autoComplete="off"
                    value={adminCode}
                    placeholder={t("edit.adminPlaceholder")}
                    onChange={(event) => setAdminCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && adminCode.trim()) {
                        event.preventDefault();
                        void openAsOrganiser();
                      }
                    }}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={busy || !adminCode.trim()}
                    onClick={() => void openAsOrganiser()}
                  >
                    {t("edit.adminOpen")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAsOrganiser(false);
                      setAdminCode("");
                    }}
                  >
                    {t("common.back")}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAsOrganiser(true)}
                className="mx-auto flex items-center gap-1.5 text-[0.6875rem] text-ash transition-colors hover:text-brand"
              >
                <ShieldCheck className="size-3" />
                {t("edit.adminToggle")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/8 px-3 py-2.5 text-[0.6875rem] text-ash">
            <MailCheck className="size-3.5 shrink-0 text-brand" />
            <span>{t("edit.codeSentTo", { email })}</span>
          </div>

          {/* The likeliest reason a code "never arrived" is a university filter, and a
              reader who concludes the site is broken tries again — which spends another
              send. Said with weight, in the same callout the other two forms use. */}
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/50 bg-amber-400/12 px-3 py-3 text-start leading-relaxed">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <span className="min-w-0">
              <strong className="block text-[0.8125rem] font-bold text-amber-100">
                {t("edit.checkSpam")}
              </strong>{" "}
              <span className="text-[0.75rem] text-amber-100/80">{t("edit.checkSpamBody")}</span>
            </span>
          </div>

          <Field label={t("edit.codeLabel")} htmlFor="edit-code" required>
            <Input
              id="edit-code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              placeholder="000000"
              onChange={(event) => setCode(digitsOnly(event.target.value).slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && code.length > 0) {
                  event.preventDefault();
                  void submitCode();
                }
              }}
              className="text-center font-mono text-lg tracking-[0.4em]"
            />
          </Field>

          <Button
            type="button"
            className="w-full"
            disabled={busy || code.length < 6}
            onClick={() => void submitCode()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {t("edit.open")}
          </Button>

          <button
            type="button"
            onClick={reset}
            className="mx-auto block text-[0.6875rem] text-ash transition-colors hover:text-brand"
          >
            {t("edit.startAgain")}
          </button>
        </div>
      )}

      {adminHref && (
        <p className="mt-6 text-center text-[0.625rem] text-ash/60">
          {t("edit.organiserHint")}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The leader's view                                                   */
/* ------------------------------------------------------------------ */

/**
 * What a team leader sees: the roster's **names and positions**, and their own card.
 *
 * No teammate's email, phone or student number appears here — not because the leader
 * has not asked, but because those facts belong to the person they are about. What
 * the leader contributes is the order, which is what a roster is.
 */
function LeaderPanel({
  session,
  config,
  onClose,
}: {
  session: OpenedSession;
  config: TournamentConfig;
  onClose: () => void;
}) {
  const { t, message, language } = useLanguage();
  const [rows, setRows] = React.useState<RosterRow[]>(() =>
    [...(session.roster ?? [])].sort((a, b) => a.position - b.position),
  );
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [profileSaved, setProfileSaved] = React.useState(false);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setNotice(null);
  };

  const saveOrder = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/registrations/roster", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: session.proof, order: rows.map((row) => row.id) }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? message(payload.error) : t("edit.somethingWrong"),
        );
        return;
      }
      setNotice(t("edit.orderSaved"));
    } catch {
      setError(t("edit.somethingWrong"));
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async (values: MemberDetailsValues) => {
    const response = await fetch("/api/registrations/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: session.proof, profile: values }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        error: typeof payload.error === "string" ? payload.error : t("complete.error"),
        errors:
          payload.errors && typeof payload.errors === "object"
            ? (payload.errors as Record<string, string>)
            : undefined,
      };
    }
    setProfileSaved(true);
    return { ok: true };
  };

  return (
    <div className="panel rounded-3xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-[rgba(79, 182, 208,0.12)] pb-4">
        <span className="flex size-10 items-center justify-center rounded-xl border border-brand/45 bg-brand/10 text-brand">
          <Crown className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg tracking-wide text-snow">
            {session.teamName || t("edit.bannerTeamFallback")}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-ash">
            <span className="font-mono">{session.reference}</span>
            <span className="text-ash/40">·</span>
            <span>{session.gameName}</span>
            <span className="text-ash/40">·</span>
            <span className="text-brand">{t("edit.roleLeader")}</span>
          </p>
        </div>
      </header>

      <section className="mt-5">
        <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-snow">
          <Users className="size-3.5 text-brand" />
          {t("edit.rosterTitle")}
        </h3>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-ash">
          {t("edit.rosterHint")}
        </p>

        <ol className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgba(79, 182, 208,0.14)] bg-wall-950/40 px-3 py-2"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-wall-700 font-mono text-[0.625rem] text-ash">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-snow">
                {row.fullName.trim() || t("edit.namePending")}
              </span>
              <RolePill
                role={isMemberRole(row.role) ? row.role : "STARTER"}
                label={t(roleLabelKeyName(row.role))}
              />
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={t("edit.moveUp")}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={t("edit.moveDown")}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ol>

        {error && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-danger/45 bg-danger/10 px-3 py-2 text-[0.6875rem] text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/8 px-3 py-2 text-[0.6875rem] text-emerald-300">
            <Check className="size-3.5" />
            {notice}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          disabled={saving || rows.length === 0}
          onClick={() => void saveOrder()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("edit.saveOrder")}
        </Button>
      </section>

      <section className="mt-6 border-t border-[rgba(79, 182, 208,0.12)] pt-5">
        <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-snow">
          <User className="size-3.5 text-brand" />
          {t("edit.yourCard")}
        </h3>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-ash">
          {t("edit.yourCardHint")}
        </p>

        <CardSummary
          language={language}
          teamName={session.teamName}
          university={session.self.universityName}
          game={session.gameName}
          email={session.self.email}
        />

        {profileSaved ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/8 px-3 py-2 text-[0.6875rem] text-emerald-300">
            <Check className="size-3.5" />
            {t("edit.profileSaved")}
          </p>
        ) : null}

        <div className="mt-3">
          <MemberDetailsForm
            language={language}
            role={session.self.role}
            seed={{
              fullName: session.self.fullName,
              gameTag: session.self.gameTag,
              studentId: session.self.studentId,
              discord: session.self.discord,
              phone: session.self.phone,
              requirements: session.self.requirements,
            }}
            requirements={config.requirements}
            submitLabel={t("edit.saveProfile")}
            onSubmit={saveProfile}
          />
        </div>
      </section>

      <Button type="button" variant="ghost" className="mt-4 w-full" onClick={onClose}>
        {t("common.done")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A player's view                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a player, substitute or coach sees: **their own card, and nothing else**.
 *
 * Not a filtered roster — there is no roster in the response at all, so a curious
 * teammate cannot learn a phone number by looking at what the page left in the DOM.
 */
function MemberPanel({
  session,
  config,
  onClose,
}: {
  session: OpenedSession;
  config: TournamentConfig;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const [saved, setSaved] = React.useState(false);

  const saveProfile = async (values: MemberDetailsValues) => {
    const response = await fetch("/api/registrations/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: session.proof, profile: values }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        error: typeof payload.error === "string" ? payload.error : t("complete.error"),
        errors:
          payload.errors && typeof payload.errors === "object"
            ? (payload.errors as Record<string, string>)
            : undefined,
      };
    }
    setSaved(true);
    return { ok: true };
  };

  return (
    <div className="panel mx-auto max-w-lg rounded-3xl p-6 sm:p-8">
      <header className="text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-brand/40 bg-brand/10 text-brand">
          <User className="size-5" />
        </span>
        <h2 className="mt-3 font-display text-lg tracking-wide text-snow">
          {session.requiresSetup ? t("edit.setupTitle") : t("edit.cardTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ash">
          {session.requiresSetup
            ? t("edit.setupIntro", { team: session.teamName })
            : t("edit.cardIntro", { team: session.teamName })}
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/8 px-2.5 py-1 text-[0.625rem] font-bold tracking-wide text-brand">
          <ShieldCheck className="size-3" />
          {t(roleLabelKey(session.role))}
        </p>
      </header>

      <CardSummary
        language={language}
        teamName={session.teamName}
        university={session.self.universityName}
        game={session.gameName}
        email={session.self.email}
      />

      {saved ? (
        <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-400/8 p-4 text-center">
          <Check className="mx-auto size-6 text-emerald-300" />
          <p className="mt-2 text-xs font-semibold text-emerald-200">
            {t("edit.profileSaved")}
          </p>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-ash">
            {t("edit.profileSavedBody", { team: session.teamName })}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <MemberDetailsForm
          language={language}
          role={session.self.role}
          seed={{
            fullName: session.self.fullName,
            gameTag: session.self.gameTag,
            studentId: session.self.studentId,
            discord: session.self.discord,
            phone: session.self.phone,
            requirements: session.self.requirements,
          }}
          requirements={config.requirements}
          submitLabel={t("edit.saveProfile")}
          onSubmit={saveProfile}
        />
      </div>

      <p className="mt-4 text-center text-[0.6875rem] leading-relaxed text-ash">
        {t("edit.onlyYourCard")}
      </p>

      <Button type="button" variant="ghost" className="mt-4 w-full" onClick={onClose}>
        {t("common.done")}
      </Button>
    </div>
  );
}

