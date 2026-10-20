"use client";

import * as React from "react";
import { AlertCircle, KeyRound, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import type { TournamentConfig } from "@/lib/tournament";
import { digitsOnly } from "@/lib/i18n";
import type { RegistrationDraft } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { RegistrationForm } from "./registration-form";
import { useLanguage } from "./language-provider";

/**
 * "Edit my registration", in two steps.
 *
 * The captain types the reference code they were given, then the six-digit code
 * that arrives in the team leader's inbox. Only then is the stored team loaded
 * into the normal wizard.
 *
 * The reference code alone is deliberately not enough: it is short, it gets
 * pasted around team chats, and the data behind it includes every member's phone
 * number and student ID.
 */
export function EditFlow({
  config,
  logoVersions,
  adminHref = null,
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
}) {
  const { t, message, language } = useLanguage();
  const [stage, setStage] = React.useState<"reference" | "code" | "editing">("reference");
  const [reference, setReference] = React.useState("");
  const [code, setCode] = React.useState("");
  const [adminCode, setAdminCode] = React.useState("");
  /** True when the organiser is opening it with the admin code, not an OTP. */
  const [asOrganiser, setAsOrganiser] = React.useState(false);
  const [openedAsOrganiser, setOpenedAsOrganiser] = React.useState(false);
  const [teamName, setTeamName] = React.useState("");
  const [maskedEmail, setMaskedEmail] = React.useState("");
  const [proof, setProof] = React.useState("");
  const [draft, setDraft] = React.useState<RegistrationDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* The language rides with every call, so the code we email is written in the
         language the captain is reading. */
      body: JSON.stringify({ ...body, language }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      /*
       * No special case for a failed send any more.
       *
       * The server used to answer 502 with the provider's reason for a *real*
       * reference and 200 for an unknown one, which made the endpoint a reliable
       * "does this reference exist" oracle whenever mail was down. It now answers the
       * same way either way, so there is nothing to branch on — and a captain who gets
       * no code can still reach their team through the organiser route, which is offered
       * at the reference step regardless.
       */
      throw new Error(
        typeof payload.error === "string" ? message(payload.error) : t("edit.somethingWrong"),
      );
    }
    return payload;
  };

  /** Shared by the emailed-code and admin-code paths — the server decides which. */
  const applyVerified = (payload: Record<string, unknown>, organiser: boolean) => {
    if (payload.stage !== "verified" || typeof payload.proof !== "string" || !payload.draft) {
      setError(t("edit.couldNotOpen"));
      return;
    }
    setProof(payload.proof);
    // The team name arrives only once the code is proven.
    if (typeof payload.teamName === "string") setTeamName(payload.teamName);
    setDraft(payload.draft as RegistrationDraft);
    setOpenedAsOrganiser(organiser);
    setStage("editing");
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await call({ reference: reference.trim() });
      setTeamName(typeof payload.teamName === "string" ? payload.teamName : "");
      setMaskedEmail(typeof payload.maskedEmail === "string" ? payload.maskedEmail : "");
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
      const payload = await call({ reference: reference.trim(), adminSecret: adminCode.trim() });
      applyVerified(payload, true);
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
      const payload = await call({ reference: reference.trim(), code });
      applyVerified(payload, false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === "editing" && draft) {
    return (
      <div className="space-y-4">
        {openedAsOrganiser && (
          <p className="mx-auto flex max-w-2xl items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-[11px] text-amber-100/90">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-amber-300" />
            <span>
              {t("edit.bannerOrganiser", {
                team: teamName || t("edit.bannerTeamFallback"),
              })}
            </span>
          </p>
        )}
        <RegistrationForm
          key={reference}
          config={config}
          logoVersions={logoVersions}
          mode="edit"
          reference={reference.trim().toUpperCase()}
          editProof={proof}
          initialDraft={draft}
          onSaved={() => {
            setStage("reference");
            setReference("");
            setCode("");
            setAdminCode("");
            setAsOrganiser(false);
            setOpenedAsOrganiser(false);
            setProof("");
            setDraft(null);
            setTeamName("");
          }}
        />
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
          {stage === "reference"
            ? t("edit.introReference")
            : asOrganiser
              ? t("edit.introOrganiser")
              : t("edit.introCode", { email: maskedEmail || t("edit.emailFallback") })}        </p>
      </header>

      {stage === "reference" ? (
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && reference.trim()) {
                event.preventDefault();
                void requestCode();
              }
            }}
            className="font-mono tracking-[0.14em]"
          />
        </Field>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/8 px-3 py-2.5 text-[11px] text-ash">
            <MailCheck className="size-3.5 shrink-0 text-brand" />
            <span>
              {t("edit.leaderInboxNote")}
              {teamName && <span className="ms-1 text-snow">{teamName}</span>}
            </span>
          </div>

          {asOrganiser ? (
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
                className="font-mono"
              />
            </Field>
          ) : (
            <Field label={t("edit.codeLabel")} htmlFor="edit-code" required>
              <Input
                id="edit-code"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                placeholder="000000"
                onChange={(event) => setCode(digitsOnly(event.target.value).slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && code.length === 6) {
                    event.preventDefault();
                    void submitCode();
                  }
                }}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </Field>
          )}

          {/*
           * `edit.checkSpam` and `edit.checkSpamBody` were in both dictionaries and
           * rendered nowhere — the one place the site forgot the hint that the other
           * two places show. Waiting for a code that a university filter has filed is
           * the commonest "it never arrived", and this is where someone waits.
           */}
          {!asOrganiser && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/90">
              <MailCheck className="mt-px size-3.5 shrink-0" />
              <span>
                <strong className="font-bold">{t("edit.checkSpam")}</strong> {" "}
                {t("edit.checkSpamBody")}
              </span>
            </p>
          )}

          {/* The code goes to the *leader's* inbox, usually a student's university
              address — which an organiser has no way to read. This is their way in. */}
          <button
            type="button"
            onClick={() => {
              setAsOrganiser((current) => !current);
              setError(null);
            }}
            className="mx-auto flex items-center gap-1.5 text-[11px] text-ash underline-offset-2 transition-colors hover:text-brand hover:underline"
          >
            <ShieldCheck className="size-3" />
            {asOrganiser
              ? t("edit.useEmailCode")
              : t("edit.organiserAsk")}
          </button>
        </div>
      )}

          {error && (
            <div className="mt-4 space-y-2 rounded-xl border border-danger/40 bg-danger/10 p-3">
              <p className="flex items-start gap-2 text-xs text-danger">
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                {error}
              </p>
            </div>
          )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {stage === "code" && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStage("reference");
              setCode("");
              setError(null);
            }}
          >
            {t("common.back")}
          </Button>
        )}

        <Button
          type="button"
          className="ms-auto min-w-40"
          disabled={
            busy ||
            (stage === "reference"
              ? !reference.trim()
              : asOrganiser
                ? !adminCode.trim()
                : code.length !== 6)
          }
          onClick={() =>
            void (stage === "reference" ? requestCode() : asOrganiser ? openAsOrganiser() : submitCode())
          }
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {stage === "reference" ? t("edit.sending") : t("edit.checking")}
            </>
          ) : stage === "reference" ? (
            <>
              <MailCheck className="size-4" />
              {t("edit.getCode")}
            </>
          ) : (
            <>
              <ShieldCheck className="size-4" />
              {t("edit.open")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
