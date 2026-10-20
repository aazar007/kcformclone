"use client";

import * as React from "react";
import { Building2, Check, Copy, Hash, MailCheck, RotateCcw, TriangleAlert, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KsuCrownMark } from "@/components/brand/ksu-crown-logo";
import { useLanguage } from "./language-provider";

export interface SubmissionResult {
  ok: boolean;
  reference: string;
  submittedAt: string;
  tournamentName: string;
  teamName: string;
  gameName: string;
  /** Every institution represented on this roster — there may be several. */
  universities: string[];
  memberCount: number;
  leaderName: string;
  /** False when the confirmation could not be emailed and must be quoted instead. */
  confirmationEmailSent?: boolean;
}

export function SuccessPanel({
  result,
  onStartOver,
}: {
  result: SubmissionResult;
  onStartOver: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const { t } = useLanguage();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the code is right there on screen.
    }
  };

  const universities = Array.isArray(result.universities) ? result.universities : [];

  return (
    <div className="panel animate-rise relative overflow-hidden rounded-3xl p-6 text-center sm:p-10">
      <span
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 100% at 50% 100%, rgba(92,240,247,0.22), transparent 70%)",
        }}
      />

      <div className="relative">
        <KsuCrownMark size="lg" className="mx-auto drop-shadow-[0_12px_30px_rgba(0,0,0,0.6)]" />

        <h2 className="mt-4 font-display text-2xl tracking-wide text-snow sm:text-3xl">
          {t("success.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ash">
          {t("success.body", {
            team: result.teamName,
            tournament: result.tournamentName || "",
          })}
        </p>

        {/* Reference code */}
        <div className="mx-auto mt-6 max-w-sm">
          <p className="text-[10px] font-bold tracking-[0.24em] text-ash uppercase">
            {t("success.referenceLabel")}
          </p>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "group mt-2 flex w-full items-center justify-center gap-3 rounded-2xl border px-5 py-4 transition-colors",
              copied
                ? "border-brand/70 bg-brand/12"
                : "border-brand/40 bg-wall-950/60 hover:border-brand/70",
            )}
          >
            <span
              dir="ltr"
              className="font-mono text-xl font-bold tracking-[0.18em] text-brand sm:text-2xl"
            >
              {result.reference}
            </span>
            {copied ? (
              <Check className="size-4 shrink-0 text-brand" />
            ) : (
              <Copy className="size-4 shrink-0 text-ash transition-colors group-hover:text-brand" />
            )}
          </button>
          <p className="mt-2 text-[11px] text-ash/70">
            {copied ? t("success.copied") : t("success.copy")}
          </p>
        </div>

        {/* Summary */}
        <dl className="mx-auto mt-8 grid max-w-lg gap-3 text-start sm:grid-cols-2">
          {[
            { icon: <Trophy className="size-3.5" />, label: t("success.game"), value: result.gameName },
            {
              icon: <Users className="size-3.5" />,
              label: t("success.roster"),
              value:
                result.memberCount === 1
                  ? t("success.membersOne")
                  : t("success.membersMany", { count: result.memberCount }),
            },
            {
              icon: <Building2 className="size-3.5" />,
              label: t(universities.length === 1 ? "success.university" : "success.universities"),
              value: universities.join(" · ") || "—",
            },
            { icon: <Hash className="size-3.5" />, label: t("success.leader"), value: result.leaderName },
          ].map((item) => (
            <div key={item.label} className="panel-inset rounded-xl p-3">
              <dt className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] text-ash uppercase">
                {item.icon}
                {item.label}
              </dt>
              <dd className="mt-1 truncate text-sm font-semibold text-snow">{item.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-ash">
          {t("success.nextSteps")}
        </p>

        {/* Say plainly whether the confirmation went out. Silence would let the
            captain assume an email is on its way when it never left. */}
        {result.confirmationEmailSent ? (
          <div className="mx-auto mt-4 max-w-md space-y-2">
            <p className="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/8 px-3 py-2.5 text-[11px] text-brand">
              <MailCheck className="size-3.5 shrink-0" />
              {t("success.emailSent")}
            </p>
            {/* The single most common reason a confirmation "never arrived".
                University filters file these aggressively, and a captain who finds
                an empty inbox assumes the registration failed — then registers
                again, which is how duplicate teams happen. */}
            <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-start text-[11px] leading-relaxed text-amber-200/90">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                <strong className="font-bold">{t("success.checkSpamTitle")}</strong>{" "}
                {t("success.checkSpamBody")}
              </span>
            </p>
          </div>
        ) : (
          <p className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-start text-[11px] text-amber-200">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>{t("success.emailFailed")}</span>
          </p>
        )}

        <Button variant="outline" className="mt-6" onClick={onStartOver}>
          <RotateCcw className="size-4" />
          {t("success.another")}
        </Button>
      </div>
    </div>
  );
}
