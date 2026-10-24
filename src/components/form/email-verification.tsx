"use client";

import * as React from "react";
import { Check, Loader2, MailCheck, PencilLine, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { digitsOnly } from "@/lib/i18n";
import { EMAIL_PATTERN } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "./language-provider";

/**
 * Proving a roster member owns the address they typed.
 *
 * Every player must be verified, so the check lives next to the field rather than
 * behind a separate step: the captain types an address, presses "Send code",
 * reads the mail and types six digits. Once it matches, the API hands back a
 * signed receipt that travels with the submission.
 *
 * Editing the address afterwards clears the verification, because the receipt
 * names the address it was issued for.
 */
export function EmailVerification({
  email,
  verifiedEmail,
  disabled = false,
  onChange,
}: {
  email: string;
  verifiedEmail: string;
  /**
   * True while the member has no university chosen.
   *
   * The address has to belong to that institution's own domain, so a code sent before the
   * choice is made is a code sent to an address that may have to be replaced — and email is
   * the slowest thing in this flow to redo. Disabled rather than merely rejected keeps the
   * order of the two answers obvious.
   */
  disabled?: boolean;
  onChange: (verifiedEmail: string, proof: string) => void;
}) {
  const [phase, setPhase] = React.useState<"idle" | "code">("idle");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  /**
   * Set when the server told us the message never left it.
   *
   * Distinct from every other error here, because nothing the student does will
   * change it: the sending account is being refused by the provider. The retry
   * button stays (a throttle can lift) but it stops promising that it will work.
   */
  const [deliveryFailed, setDeliveryFailed] = React.useState(false);
  const { t, message, language } = useLanguage();

  const normalised = email.trim().toLowerCase();
  const usable = EMAIL_PATTERN.test(normalised);
  const verified = normalised.length > 0 && verifiedEmail.trim().toLowerCase() === normalised;

  // A different address is a different check.
  React.useEffect(() => {
    setPhase("idle");
    setCode("");
    setError(null);
    setNotice(null);
    setDeliveryFailed(false);
  }, [normalised]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setDeliveryFailed(false);
    try {
      const response = await fetch("/api/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalised, language }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? message(payload.error) : t("verify.couldNotSend"),
        );
        setDeliveryFailed(payload.deliveryFailed === true);
        return;
      }

      /* `OTP_SKIP_VERIFY` (local testing) skips the email — the request comes back
         with this flag and no code was sent. Verify the address directly instead of
         asking for a code nobody will receive. */
      if (payload.skipVerify === true) {
        await verifyWithoutCode();
        return;
      }

      setPhase("code");
      setNotice(
        payload.logged
          ? t("verify.logged")
          : t("verify.sent", { email: normalised }),
      );
    } catch {
      setError(t("verify.unreachable"));
    } finally {
      setBusy(false);
    }
  };

  const verifyWithoutCode = async () => {
    try {
      const response = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalised, language }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? message(payload.error) : t("verify.couldNotSend"),
        );
        return;
      }

      onChange(normalised, typeof payload.proof === "string" ? payload.proof : "");
      setPhase("idle");
      setCode("");
      setNotice(null);
    } catch {
      setError(t("verify.unreachable"));
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalised, code, language }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? message(payload.error) : "That code is not correct.",
        );
        return;
      }

      onChange(normalised, typeof payload.proof === "string" ? payload.proof : "");
      setPhase("idle");
      setCode("");
      setNotice(null);
    } catch {
      setError(t("verify.unreachable"));
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-emerald-300">
          <ShieldCheck className="size-3.5" />
          {t("verify.confirmed")}
        </span>
        <span className="text-[11px] text-ash" dir="ltr">
          {normalised}
        </span>
        <button
          type="button"
          onClick={() => onChange("", "")}
          className="ms-auto flex items-center gap-1 text-[11px] text-ash underline-offset-2 transition-colors hover:text-brand hover:underline"
        >
          <PencilLine className="size-3" />
          {t("verify.useDifferent")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {phase === "idle" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!usable || busy || disabled}
          onClick={() => void requestCode()}
          title={disabled ? t("field.emailChooseUniversityFirst") : undefined}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}
          {/* Honest label: after a relay refusal, retrying is a long shot rather
              than the obvious next step. */}
          {deliveryFailed ? t("verify.sendAgain") : t("verify.send")}
        </Button>
      ) : (
        /* `dir="ltr"` on the row, not just the input.
         *
         * The code is a Latin token read left-to-right, so in Arabic the confirm
         * control belongs *after* it — to its right. Left to the ambient RTL
         * direction the row mirrors itself and the tick ends up on the far side
         * from the digits it confirms. */
        <div dir="ltr" className="flex flex-wrap items-center gap-2">
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            placeholder={t("verify.codePlaceholder")}
            aria-label={t("verify.codeLabel")}
            /* Folded on the way in: an Arabic keyboard types ١٢٣, and the email
             * now shows 123, so showing what the person meant to type keeps the
             * two in step and keeps `code.length` honest. */
            onChange={(event) => setCode(digitsOnly(event.target.value).slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === 6) {
                event.preventDefault();
                void submitCode();
              }
            }}
            className="w-32 font-mono text-[13px] tracking-[0.2em]"
          />
          <Button
            type="button"
            size="sm"
            disabled={code.length !== 6 || busy}
            onClick={() => void submitCode()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("verify.verify")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void requestCode()}
          >
            {t("verify.resend")}
          </Button>
        </div>
      )}

      {error && <p className="text-[11px] text-danger">{error}</p>}
      {!error && notice && (
        <p className={cn("text-[11px]", notice.startsWith("SMTP") ? "text-amber-300" : "text-ash")}>
          {notice}
        </p>
      )}

      {/*
       * The single most common reason a code "never arrives". University mail
       * filters file these aggressively, and a student who finds an empty inbox
       * assumes the site is broken and gives up — so the advice is shown where
       * they are already waiting, not buried in a help page.
       */}
      {phase === "code" && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <MailCheck className="mt-px size-3.5 shrink-0" />
          <span>
            {t("verify.notThere")}{" "}
            <strong className="font-bold">{t("verify.checkSpam")}</strong> {t("verify.spamBody")}
          </span>
        </p>
      )}

      {!error && !notice && phase === "idle" && !usable && (
        <p className="text-[11px] text-ash/70">{t("verify.enterValidFirst")}</p>
      )}
    </div>
  );
}
