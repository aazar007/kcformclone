"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { t, translateMessage, type Language } from "@/lib/i18n";
import type { RequirementDefinition } from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** What the form submits, in the shape both save endpoints expect. */
export interface MemberDetailsValues {
  fullName: string;
  gameTag: string;
  studentId: string;
  discord: string;
  phone: string;
  requirements: { id: string; value: string }[];
}

export interface MemberDetailsSeed {
  fullName?: string;
  gameTag?: string;
  studentId?: string;
  discord?: string;
  phone?: string;
  requirements?: { id: string; value: string }[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  errors?: Record<string, string>;
}

/**
 * **One card, one person.**
 *
 * The fields here are the ones a member owns: their name, their in-game tag, their
 * student number and their contact details. The university and the address are not
 * on the form at all — they were chosen by whoever registered the team, they decide
 * which addresses are acceptable, and letting the person behind them retype them
 * would be a way round both rules.
 *
 * Shared by the emailed completion link and the role-scoped edit flow, so a player
 * sees the same card whichever way they arrived and there is one definition of
 * "a complete profile".
 */
export function MemberDetailsForm({
  language,
  role,
  seed,
  requirements,
  submitLabel,
  onSubmit,
}: {
  language: Language;
  /** `COACH` skips the in-game tag and the student number, which they need not have. */
  role: string;
  seed: MemberDetailsSeed;
  requirements: RequirementDefinition[];
  submitLabel: string;
  onSubmit: (values: MemberDetailsValues) => Promise<SaveResult>;
}) {
  const isCoach = role === "COACH";

  const [form, setForm] = React.useState(() => ({
    fullName: seed.fullName ?? "",
    gameTag: seed.gameTag ?? "",
    studentId: seed.studentId ?? "",
    discord: seed.discord ?? "",
    phone: seed.phone ?? "",
    requirements: Object.fromEntries(
      (seed.requirements ?? []).map((answer) => [answer.id, answer.value]),
    ) as Record<string, string>,
  }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setRequirement = (id: string, value: string) =>
    setForm((current) => ({
      ...current,
      requirements: { ...current.requirements, [id]: value },
    }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setServerError(null);

    try {
      const result = await onSubmit({
        ...form,
        requirements: requirements.map((requirement) => ({
          id: requirement.id,
          value: form.requirements[requirement.id] ?? "",
        })),
      });

      if (!result.ok) {
        if (result.errors) {
          setErrors(
            Object.fromEntries(
              Object.entries(result.errors).map(([key, value]) => [
                key,
                translateMessage(value, language),
              ]),
            ),
          );
        }
        setServerError(result.error ?? t(language, "complete.error"));
      }
    } catch {
      setServerError(t(language, "complete.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 text-start">
      <Field
        label={t(language, "field.fullName")}
        htmlFor="member-name"
        required
        error={errors.fullName}
      >
        <Input
          id="member-name"
          value={form.fullName}
          maxLength={60}
          autoComplete="name"
          invalid={Boolean(errors.fullName)}
          onChange={(event) => update("fullName", event.target.value)}
        />
      </Field>

      {!isCoach && (
        <Field
          label={t(language, "field.gameTag")}
          htmlFor="member-tag"
          required
          error={errors.gameTag}
          hint={t(language, "field.gameTagHint")}
        >
          <Input
            id="member-tag"
            dir="ltr"
            value={form.gameTag}
            maxLength={32}
            autoComplete="off"
            invalid={Boolean(errors.gameTag)}
            onChange={(event) => update("gameTag", event.target.value)}
            className="font-mono text-[0.8125rem]"
          />
        </Field>
      )}

      {!isCoach && (
        <Field
          label={t(language, "field.studentId")}
          htmlFor="member-student"
          required
          error={errors.studentId}
          hint={t(language, "field.studentIdHint")}
        >
          <Input
            id="member-student"
            dir="ltr"
            inputMode="numeric"
            value={form.studentId}
            maxLength={20}
            invalid={Boolean(errors.studentId)}
            onChange={(event) => update("studentId", event.target.value)}
            className="font-mono text-[0.8125rem]"
          />
        </Field>
      )}

      <Field
        label={t(language, "field.discord")}
        htmlFor="member-discord"
        required
        error={errors.discord}
        hint={t(language, "field.discordHint")}
      >
        <Input
          id="member-discord"
          dir="ltr"
          value={form.discord}
          maxLength={37}
          invalid={Boolean(errors.discord)}
          onChange={(event) => update("discord", event.target.value)}
          className="font-mono text-[0.8125rem]"
        />
      </Field>

      <Field
        label={t(language, "field.phone")}
        htmlFor="member-phone"
        required
        error={errors.phone}
        hint={t(language, "field.phoneHint")}
      >
        <Input
          id="member-phone"
          dir="ltr"
          type="tel"
          inputMode="tel"
          value={form.phone}
          maxLength={17}
          invalid={Boolean(errors.phone)}
          onChange={(event) => update("phone", event.target.value)}
        />
      </Field>

      {requirements.map((requirement) => {
        const value = form.requirements[requirement.id] ?? "";
        const error = errors[`req.${requirement.id}`];

        if (requirement.type === "checkbox") {
          return (
            <div key={requirement.id} className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[rgba(79, 182, 208,0.14)] bg-wall-950/40 p-3 transition-colors hover:border-brand/40">
                <Checkbox
                  checked={value === "yes"}
                  onChange={(checked) => setRequirement(requirement.id, checked ? "yes" : "")}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-snow">
                    {requirement.label}
                    {requirement.required && <span className="text-brand">*</span>}
                  </span>
                  {requirement.hint && (
                    <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ash">
                      {requirement.hint}
                    </span>
                  )}
                </span>
              </label>
              {error && <p className="text-xs text-danger">{error}</p>}
            </div>
          );
        }

        if (requirement.type === "select") {
          return (
            <Field
              key={requirement.id}
              label={requirement.label}
              required={requirement.required}
              error={error}
              hint={requirement.hint}
            >
              <Select
                value={value}
                onValueChange={(next) => setRequirement(requirement.id, next)}
              >
                <SelectTrigger invalid={Boolean(error)}>
                  <SelectValue placeholder={requirement.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {(requirement.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          );
        }

        return (
          <Field
            key={requirement.id}
            label={requirement.label}
            required={requirement.required}
            error={error}
            hint={requirement.hint}
          >
            <Input
              value={value}
              type={requirement.type === "number" ? "number" : "text"}
              inputMode={requirement.type === "number" ? "numeric" : undefined}
              invalid={Boolean(error)}
              maxLength={requirement.maxLength ?? 200}
              placeholder={requirement.placeholder}
              onChange={(event) => setRequirement(requirement.id, event.target.value)}
            />
          </Field>
        );
      })}

      {serverError && (
        <p className="rounded-xl border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
          {serverError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t(language, "complete.saving")}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
