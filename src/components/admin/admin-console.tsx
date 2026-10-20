"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  FileText,
  Gamepad2,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  Building2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normaliseConfig, type TournamentConfig } from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { TournamentLogo } from "@/components/brand/ksu-crown-logo";
import { WaveWall } from "@/components/brand/wave-wall";
import { SecretGate } from "./secret-gate";
import { GeneralSection } from "./general-section";
import { GamesSection } from "./games-section";
import { RequirementsSection } from "./requirements-section";
import { ProvincesSection } from "./provinces-section";
import { UniversitiesSection } from "./universities-section";
import { RegistrationsSection } from "./registrations-section";
import { RulebookSection } from "./rulebook-section";
import { StaffSection } from "./staff-section";
import { PasswordSection } from "./password-section";
import { Pill } from "./controls";

/**
 * Marker for "signed in". The admin code itself is never kept in the page: after a
 * correct code the server sets an HttpOnly session cookie, which the browser sends
 * by itself and scripts cannot read.
 */
const SIGNED_IN = "session";

/**
 * The console's sections.
 *
 * `ownerOnly` marks a section reserved to the grand admin. There are exactly **two**, and
 * they are the two that guard the grand admin's own position rather than the tournament:
 *
 * - **Staff access** — handing out access is how access spreads, so it stays with one
 *   person. A granted helper runs the tournament; they do not decide who else may.
 * - **Password** — whoever holds that credential *is* the grand admin. A staff session must
 *   not be able to read, change or remove it, which is also why the route behind the tab
 *   checks `isOwnerRequest` rather than trusting this flag.
 *
 * Everything else is shared, because a helper needs all of it to run the tournament.
 * Keeping the flag on the list rather than deleting the mechanism means widening or
 * narrowing it is a one-word change.
 *
 * **This is cosmetic.** `visibleTabs` hides a tab; the routes refuse on their own. A section
 * added here without its route being guarded would be hidden and still wide open, so the
 * two must change together — `npm test` asserts the split in both places.
 *
 * The flag decides what is *rendered* — the routes behind each section enforce the
 * same split, so hiding a tab is a convenience, never the security boundary.
 */
const TABS = [
  { id: "general", label: "General", icon: Settings, ownerOnly: false },
  { id: "games", label: "Games", icon: Gamepad2, ownerOnly: false },
  { id: "requirements", label: "Requirements", icon: ListChecks, ownerOnly: false },
  { id: "provinces", label: "Provinces", icon: MapPin, ownerOnly: false },
  { id: "universities", label: "Universities", icon: Building2, ownerOnly: false },
  { id: "rulebook", label: "Rulebook", icon: FileText, ownerOnly: false },
  { id: "staff", label: "Staff access", icon: KeyRound, ownerOnly: true },
  { id: "password", label: "Password", icon: Lock, ownerOnly: true },
  { id: "registrations", label: "Registrations", icon: Users, ownerOnly: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Notice = { tone: "ok" | "error"; text: string };

export function AdminConsole({
  initialConfig,
  configSource,
  initialLogoVersions,
  mode = "owner",
  sheetUrl = null,
}: {
  initialConfig: TournamentConfig;
  configSource: "default" | "stored";
  /** Game id → cache-busting version, for the games that have a logo. */
  initialLogoVersions: Record<string, number>;
  /**
   * The spreadsheet's own address, resolved on the server, or null when it is not
   * configured.
   *
   * Passed in rather than fetched because it is an operator setting, not app state: there is
   * nothing to load, and a client fetch would mean the console could hang on a dependency
   * that has nothing to do with the tournament. Null simply means no link is rendered.
   *
   * It is **not** `SHEET_WEBHOOK_URL` — that is the Apps Script endpoint, and the
   * spreadsheet's address cannot be derived from it.
   */
  sheetUrl?: string | null;
  /**
   * Which door the reader came through — the grand admin's address or the staff one.
   *
   * It decides only which sign-in form is offered. It does **not** grant anything: the
   * role is read back from the signed session cookie, so a staff session that somehow
   * arrived on the grand admin's page still sees only the staff sections, and the staff
   * form could not produce an owner session whatever this prop said.
   */
  mode?: "owner" | "staff";
}) {
  const [secret, setSecret] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<"owner" | "staff">(mode);
  const [staffEmail, setStaffEmail] = React.useState<string | null>(null);
  const [devSecret, setDevSecret] = React.useState(false);
  /**
   * Whether the emailed confirmation step is actually in force.
   *
   * Shown as a permanent warning when it is not. The sign-in is allowed either way — the
   * console used to refuse instead, which locked an organiser out of production over an
   * unset `ADMIN_EMAIL` — so this banner is the only thing distinguishing "two-step is on"
   * from "I meant to turn it on and forgot".
   */
  const [twoStep, setTwoStep] = React.useState<boolean | null>(null);
  const [restoring, setRestoring] = React.useState(true);

  const [config, setConfig] = React.useState(initialConfig);
  const [saved, setSaved] = React.useState(initialConfig);
  const [logoVersions, setLogoVersions] =
    React.useState<Record<string, number>>(initialLogoVersions);
  /* Opened where this door's reader can work. A staff visitor landing on a settings
     section first would be bounced off it a moment later by the effect below, which
     reads as the console flickering rather than as a restriction. */
  const [tab, setTab] = React.useState<TabId>(mode === "staff" ? "registrations" : "general");
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  const dirty = React.useMemo(
    () => JSON.stringify(config) !== JSON.stringify(saved),
    [config, saved],
  );

  const lock = React.useCallback(() => {
    // Ask the server to end the session cookie; the console locks either way.
    void fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setSecret(null);
    setDevSecret(false);
    setRole("owner");
    setStaffEmail(null);
  }, []);

  /* A refresh should not force the code in again — the server says whether the
     session cookie is still good, so an expired or rotated code cannot leave the
     console looking unlocked. */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store" });
        if (cancelled) return;
        if (response.ok) {
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          setDevSecret(Boolean(payload.devSecret));
          setTwoStep(payload.twoStep === true);
          setRole(payload.role === "staff" ? "staff" : "owner");
          setStaffEmail(typeof payload.email === "string" ? payload.email : null);
          setSecret(SIGNED_IN);
        }
      } catch {
        // Not signed in, or the server is unreachable: show the gate.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = React.useCallback(
    (
      session: { role: "owner" | "staff"; email: string | null },
      usingDev: boolean,
      /**
       * Whether the emailed confirmation step is in force, when the sign-in response said.
       *
       * Optional because the staff door has nothing to report: it signs in *by* an emailed
       * code, so the grand admin's second factor is not its concern. Only set when the server
       * told us, so an absent value can never be mistaken for "the step is off".
       */
      twoStepValue?: boolean,
    ) => {
      // The server has already set the session cookie; the typed code is dropped here.
      setDevSecret(usingDev);
      if (typeof twoStepValue === "boolean") setTwoStep(twoStepValue);
      setRole(session.role);
      setStaffEmail(session.email);
      setSecret(SIGNED_IN);
    },
    [],
  );

  /** The sections this session may see. Cosmetic — the routes check again. */
  const visibleTabs = React.useMemo(
    () => TABS.filter((entry) => role === "owner" || !entry.ownerOnly),
    [role],
  );

  /* A staff session must never sit on a section it cannot see — after a refresh, or
     if the role ever changes under it. Without this the content area renders nothing
     and the console looks broken rather than restricted. */
  React.useEffect(() => {
    if (role === "staff" && (tab === "staff" || tab === "password")) setTab("registrations");
  }, [role, tab]);

  const patch = React.useCallback(
    <K extends keyof TournamentConfig>(key: K, value: TournamentConfig[K]) => {
      setConfig((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const save = async () => {
    if (!secret) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 401) {
        lock();
        return;
      }
      if (!response.ok) {
        setNotice({
          tone: "error",
          text: typeof payload.error === "string" ? payload.error : "Could not save the settings.",
        });
        return;
      }

      const next = normaliseConfig(payload.config);
      setConfig(next);
      setSaved(next);
      setNotice({ tone: "ok", text: "Saved — the registration form now uses these settings." });
    } catch {
      setNotice({ tone: "error", text: "We could not reach the server. Nothing was saved." });
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------------ */

  if (restoring) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <WaveWall />
        <span className="relative flex items-center gap-2 text-xs text-ash">
          <Loader2 className="size-4 animate-spin" />
          Loading the organiser console…
        </span>
      </div>
    );
  }

  if (!secret) {
    return (
      <SecretGate
        tournamentName={config.tournamentName}
        mode={mode}
        onUnlock={unlock}
      />
    );
  }

  const sectionProps = { config, patch };

  return (
    <div className="relative min-h-screen">
      <WaveWall />

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        {/* ---------------------------- Header ---------------------------- */}
        <header className="panel mb-6 rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-5">
            <TournamentLogo name={config.tournamentName} tagline="Organiser Console" size="md" />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {devSecret && (
                <span className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold tracking-wide text-amber-300 uppercase">
                  <ShieldAlert className="size-3.5" />
                  Development code
                </span>
              )}
              <Pill tone={configSource === "stored" ? "brand" : "warn"}>
                {configSource === "stored" ? "Saved settings" : "Built-in defaults"}
              </Pill>
              <Button asChild size="sm" variant="outline">
                <Link href="/">View form</Link>
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={lock}>
                <LogOut className="size-3.5" />
                Lock
              </Button>
            </div>
          </div>

          {devSecret && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/8 p-3 text-[11px] leading-relaxed text-amber-100/90">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-300" />
              <span>
                The development code is in use because <span className="font-mono">ADMIN_SECRET</span>{" "}
                is not set. Set it on the server before going live.
              </span>
            </p>
          )}

          {/* The second factor is off. Stated plainly and permanently, because nothing else
              would tell an organiser that the step they asked for is not running — and
              because the sign-in no longer refuses, by design. */}
          {role === "owner" && twoStep === false && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/8 p-3 text-[11px] leading-relaxed text-amber-100/90">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-300" />
              <span>
                <strong className="text-amber-100">No emailed confirmation step.</strong>{" "}
                <span className="font-mono">ADMIN_EMAIL</span> is not set, so whoever has the
                password gets straight in — it is the only credential being checked. Set{" "}
                <span className="font-mono">ADMIN_EMAIL</span> on the server to turn the step
                on.
              </span>
            </p>
          )}

          {role === "owner" ? (
            <p className="mt-4 text-[11px] leading-relaxed text-ash">
              Changes are stored in the registration database and picked up by the public form on its
              next page load. The Google Sheet is now an optional export, not a source of truth.
            </p>
          ) : (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-ash">
              <Pill tone="brand">Staff access</Pill>
              <span>
                Signed in as <span className="font-mono text-snow" dir="ltr">{staffEmail}</span> —
                you can work on the registrations. The tournament settings, the rulebook and who else
                has access are the grand admin&apos;s.
              </span>
            </p>
          )}
        </header>

        {/* ----------------------------- Tabs ----------------------------- */}
        <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Admin sections">
          {visibleTabs.map((entry) => {
            const Icon = entry.icon;
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold tracking-wide transition-colors",
                  active
                    ? "border-brand/60 bg-brand/12 text-brand"
                    : "border-[rgba(148,196,208,0.16)] text-ash hover:border-brand/40 hover:text-snow",
                )}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </button>
            );
          })}
        </nav>

        {/* ---------------------------- Content ---------------------------- */}
        <main className="pb-28">
          {tab === "general" && <GeneralSection {...sectionProps} />}
          {tab === "games" && (
            <GamesSection
              {...sectionProps}
              secret={secret ?? ""}
              logoVersions={logoVersions}
              onLogoVersionsChange={setLogoVersions}
            />
          )}
          {tab === "requirements" && <RequirementsSection {...sectionProps} />}
          {tab === "provinces" && <ProvincesSection {...sectionProps} />}
          {tab === "universities" && <UniversitiesSection {...sectionProps} />}
          {tab === "rulebook" && <RulebookSection config={config} />}
          {tab === "staff" && <StaffSection />}
          {tab === "password" && <PasswordSection />}
          {tab === "registrations" && (
            <RegistrationsSection secret={secret} config={config} sheetUrl={sheetUrl} />
          )}
        </main>
      </div>

      {/* --------------------------- Save bar --------------------------- */}
      {/* Only the grand admin has anything to save: every section that uses this bar
          is owner-only, and a Save press from a staff session would be refused by the
          API and sign them out. */}
      {role === "owner" && tab !== "registrations" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(148,196,208,0.16)] bg-wall-900/92 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            {notice ? (
              <span
                className={cn(
                  "flex items-center gap-2 text-[11px]",
                  notice.tone === "ok" ? "text-brand" : "text-danger",
                )}
              >
                {notice.tone === "ok" ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                {notice.text}
              </span>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-[11px] text-amber-300">
                <AlertTriangle className="size-3.5" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[11px] text-ash">
                <Check className="size-3.5" />
                Everything is saved
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!dirty || saving}
                onClick={() => {
                  setConfig(saved);
                  setNotice(null);
                }}
              >
                <RotateCcw className="size-3.5" />
                Discard
              </Button>
              <Button type="button" size="sm" disabled={!dirty || saving} onClick={save}>
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-3.5" />
                    Save changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
