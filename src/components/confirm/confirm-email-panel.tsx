"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Link2Off, Mail, ShieldAlert, User } from "lucide-react";
import { t, type Language } from "@/lib/i18n";
import type { CompletionView } from "@/lib/member-confirm";
import type { RequirementDefinition } from "@/lib/tournament";
import { MemberDetailsForm } from "@/components/form/member-details-form";
import { Button } from "@/components/ui/button";

/**
 * The page a member lands on from their emailed link.
 *
 * The captain enters only a teammate's university and address, so this page is
 * where the player completes the rest of their own details. Saving is the
 * confirmation: the link already proves control of the mailbox, so a second button
 * would only ask the same question twice.
 *
 * **Opening the page changes nothing.** The form is a POST, so a mail filter that
 * follows every URL cannot fill in — or confirm — a profile nobody submitted.
 */
export function ConfirmEmailPanel({
  token,
  language,
  initial,
  requirements,
  suggestedStudentId = null,
}: {
  token: string;
  language: Language;
  /** The member this link belongs to, or null when the token is unknown. */
  initial: CompletionView | null;
  /** The organiser-defined questions, so the form asks the current ones. */
  requirements: RequirementDefinition[];
  /** The number embedded in the address, when the university's format has one. */
  suggestedStudentId?: string | null;
}) {
  const [saved, setSaved] = React.useState(false);

  const submit = async (values: {
    fullName: string;
    gameTag: string;
    studentId: string;
    discord: string;
    phone: string;
    requirements: { id: string; value: string }[];
  }) => {
    const response = await fetch("/api/confirm-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, profile: values }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return {
        ok: false,
        error: typeof payload.error === "string" ? payload.error : t(language, "complete.error"),
        errors:
          payload.errors && typeof payload.errors === "object"
            ? (payload.errors as Record<string, string>)
            : undefined,
      };
    }

    setSaved(true);
    return { ok: true };
  };

  /* Unknown token: there is nothing to complete and no form to offer. */
  if (!initial) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-danger">
          <Link2Off className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl tracking-wide text-snow">
          {t(language, "confirm.invalidTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ash">
          {t(language, "confirm.invalidBody")}
        </p>
        <HomeLink language={language} />
      </div>
    );
  }

  if (initial.banned) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-danger">
          <ShieldAlert className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl tracking-wide text-snow">
          {t(language, "complete.bannedTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ash">
          {t(language, "complete.bannedBody")}
        </p>
        <HomeLink language={language} />
      </div>
    );
  }

  if (saved) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl tracking-wide text-snow">
          {t(language, "complete.savedTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ash">
          {t(language, "complete.savedBody", {
            name: initial.fullName || initial.email,
            team: initial.teamName,
          })}
        </p>
        <Button type="button" variant="outline" className="mt-6" onClick={() => setSaved(false)}>
          {t(language, "complete.save")}
        </Button>
        <HomeLink language={language} />
      </div>
    );
  }

  return (
    <div className="text-left">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-brand/40 bg-brand/10 text-brand">
          <User className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl tracking-wide text-snow">
          {t(language, "complete.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ash">
          {t(language, "complete.intro", { team: initial.teamName })}
        </p>
      </div>

      <CardSummary
        language={language}
        teamName={initial.teamName}
        university={initial.universityName}
        game={initial.gameName}
        email={initial.email}
      />

      <p className="mt-3 flex items-start gap-2 rounded-xl border border-brand/25 bg-brand/6 px-3 py-2 text-[0.6875rem] leading-relaxed text-ash">
        <Mail className="mt-px size-3.5 shrink-0 text-brand" />
        {t(language, "complete.pendingNote")}
      </p>

      <div className="mt-4">
        <MemberDetailsForm
          language={language}
          role={initial.role}
          seed={{
            fullName: initial.fullName,
            gameTag: initial.gameTag,
            studentId: initial.studentId || suggestedStudentId || "",
            discord: initial.discord,
            phone: initial.phone,
            requirements: initial.requirements,
          }}
          requirements={requirements}
          submitLabel={t(language, "complete.save")}
          onSubmit={submit}
        />
      </div>

      <p className="mt-4 text-center text-[0.6875rem] leading-relaxed text-ash">
        {t(language, "complete.footnote")}
      </p>
      <HomeLink language={language} />
    </div>
  );
}

/** What the team entered, read-only: none of it is the member's to change here. */
export function CardSummary({
  language,
  teamName,
  university,
  game,
  email,
}: {
  language: Language;
  teamName: string;
  university: string;
  game: string;
  email: string;
}) {
  const rows = [
    { label: t(language, "complete.teamLabel"), value: teamName, mono: false },
    { label: t(language, "complete.universityLabel"), value: university || "—", mono: false },
    { label: t(language, "complete.gameLabel"), value: game, mono: false },
    { label: t(language, "complete.emailLabel"), value: email, mono: true },
  ];

  return (
    <dl className="mt-5 space-y-1.5 rounded-xl border border-[rgba(79, 182, 208,0.16)] bg-wall-950/40 p-3 text-[0.6875rem]">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <dt className="text-ash">{row.label}</dt>
          <dd
            dir={row.mono ? "ltr" : undefined}
            className={
              row.mono
                ? "text-right font-mono text-brand"
                : "text-right text-snow"
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HomeLink({ language }: { language: Language }) {
  return (
    <p className="mt-6 text-center">
      <Link
        href={`/?lang=${language}`}
        className="text-[0.6875rem] text-brand underline underline-offset-2"
      >
        {t(language, "confirm.home")}
      </Link>
    </p>
  );
}
