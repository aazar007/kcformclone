"use client";

import * as React from "react";
import { ArrowUpRight, Building2, Check, Copy, Hash, MailCheck, MessageCircle, RotateCcw, TriangleAlert, Trophy, Users } from "lucide-react";
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
  /** How many non-leader members were queued their own confirmation link. */
  memberConfirmationsQueued?: number;
  /**
   * The link the leader shares with the team.
   *
   * It opens the role-scoped edit flow with the reference already filled in; each
   * player then enters their own address, which is what selects their card. Absent
   * only if the deployment could not work out its own address.
   */
  teamUrl?: string;
}

export function SuccessPanel({
  result,
  discordInviteUrl = "",
  onStartOver,
}: {
  result: SubmissionResult;
  /**
   * The tournament's community Discord, or empty when none is configured.
   *
   * Passed in rather than read from the result: it is tournament configuration, not
   * something the submission decided, and the organisers can change it without
   * touching any stored team.
   */
  discordInviteUrl?: string;
  onStartOver: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);
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

  const copyLink = async () => {
    if (!result.teamUrl) return;
    try {
      await navigator.clipboard.writeText(result.teamUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // The address is visible below, so it can still be selected by hand.
    }
  };

  const universities = Array.isArray(result.universities) ? result.universities : [];

  return (
    <div className="panel animate-rise relative overflow-hidden rounded-3xl p-6 text-center sm:p-10">
      <span
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 100% at 50% 100%, rgba(79, 182, 208,0.22), transparent 70%)",
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
          <p className="text-[0.625rem] font-bold tracking-[0.24em] text-ash uppercase">
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
          <p className="mt-2 text-[0.6875rem] text-ash/70">
            {copied ? t("success.copied") : t("success.copy")}
          </p>
        </div>

        {/* **The link the team needs next.**
            The leader is the only person who registers, so every other player has to
            be told where to go. Shown here, immediately, because this is the one
            moment the leader is certain to be looking — and copying it by hand out of
            a paragraph is exactly where a code gets mistyped. */}
        {result.teamUrl && (
          <div className="mx-auto mt-4 max-w-sm">
            <p className="text-[0.625rem] font-bold tracking-[0.24em] text-ash uppercase">
              {t("success.shareTitle")}
            </p>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-ash">
              {t("success.shareBody")}
            </p>
            <button
              type="button"
              onClick={copyLink}
              className={cn(
                "group mt-2 flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors",
                linkCopied
                  ? "border-brand/70 bg-brand/12"
                  : "border-[rgba(79, 182, 208,0.3)] bg-wall-950/60 hover:border-brand/60",
              )}
            >
              <span
                dir="ltr"
                className="min-w-0 flex-1 truncate text-start font-mono text-[0.625rem] text-brand"
              >
                {result.teamUrl}
              </span>
              {linkCopied ? (
                <Check className="size-3.5 shrink-0 text-brand" />
              ) : (
                <Copy className="size-3.5 shrink-0 text-ash transition-colors group-hover:text-brand" />
              )}
            </button>
            <p className="mt-1 text-[0.625rem] text-ash/70">
              {linkCopied ? t("success.shareCopied") : t("success.shareCopy")}
            </p>
          </div>
        )}

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
              <dt className="flex items-center gap-1.5 text-[0.625rem] font-bold tracking-[0.14em] text-ash uppercase">
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

        {/* **The Discord invite belongs here, not on the landing page.**
            It is the next thing a registered team has to do — join the room where
            schedules and lobbies are posted — and this is the screen they land on
            immediately after submitting. Rendered only when configured, so a
            tournament without a Discord shows no dead button. */}
        {discordInviteUrl && (
          <div className="mx-auto mt-5 max-w-md rounded-2xl border border-brand/35 bg-brand/8 px-4 py-4">
            <p className="flex items-center justify-center gap-2 text-[0.8125rem] font-bold text-brand">
              <MessageCircle className="size-4 shrink-0" />
              {t("success.discordTitle")}
            </p>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-ash">
              {t("success.discordBody")}
            </p>
            <a
              href={discordInviteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-wall-950 transition-transform hover:scale-[1.03] active:scale-95"
            >
              {t("success.discordCta")}
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        )}

        {/* Say plainly whether the confirmation went out. Silence would let the
            captain assume an email is on its way when it never left. */}
        {result.confirmationEmailSent ? (
          <div className="mx-auto mt-4 max-w-md space-y-2">
            <p className="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/8 px-3 py-2.5 text-[0.6875rem] text-brand">
              <MailCheck className="size-3.5 shrink-0" />
              {t("success.emailSent")}
            </p>
            {(result.memberConfirmationsQueued ?? 0) > 0 && (
              <p className="flex items-start justify-center gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-ash">
                <MailCheck className="mt-px size-3.5 shrink-0 text-brand" />
                {t("success.memberConfirmations")}
              </p>
            )}
            {/* The single most common reason a confirmation "never arrived".
                University filters file these aggressively, and a captain who finds
                an empty inbox assumes the registration failed — then registers
                again, which is how duplicate teams happen. Set louder than the
                receipt above it, because it is the part that needs acting on. */}
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/50 bg-amber-400/12 px-3 py-3 text-start leading-relaxed">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <span className="min-w-0">
                <strong className="block text-[0.8125rem] font-bold text-amber-100">
                  {t("success.checkSpamTitle")}
                </strong>{" "}
                <span className="text-[0.75rem] text-amber-100/80">{t("success.checkSpamBody")}</span>
              </span>
            </div>
          </div>
        ) : (
          <p className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-start text-[0.6875rem] text-amber-200">
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
