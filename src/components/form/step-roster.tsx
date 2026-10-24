"use client";

import * as React from "react";
import {
  Building2,
  Check,
  Crown,
  Gamepad2,
  Hash,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { cn, digitsOnly, domainOf, formatPhone, normalisePhone } from "@/lib/utils";
import type { MemberRole } from "@/lib/games";
import { regionLabel } from "@/lib/regions";
import {
  gameById,
  rosterRulesFor,
  selectableUniversities,
  DEFAULT_TOURNAMENT,
  type RosterRules,
  type RequirementDefinition,
} from "@/lib/tournament";
import { countRoles, effectiveLeaderIndex, emptyMember, EMAIL_PATTERN, resolveRole, revealsImmediately, STUDENT_ID_MAX } from "@/lib/validation";
import { acceptedEmailDomains, emailMatchesUniversity } from "@/lib/universities";
import { Field, RolePill } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmailVerification } from "./email-verification";
import { DuplicateBadge } from "./duplicate-badge";
import { roleLabelKey } from "@/lib/i18n";
import { useLanguage } from "./language-provider";
import type { StepProps } from "./types";

/* ------------------------------------------------------------------ */
/* University picker — one per member                                   */
/* ------------------------------------------------------------------ */

/**
 * Only universities that may actually enter are listed. Institutions in a
 * province the organisers closed are removed rather than shown struck through:
 * a list of things you cannot pick is a puzzle, not a rule.
 */
function UniversitySelect({
  id,
  value,
  universities,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  universities: ReturnType<typeof selectableUniversities>;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const government = universities.filter((university) => university.sector === "Government");
  const privateUnis = universities.filter((university) => university.sector === "Private");
  const selected = universities.find((university) => university.id === value);

  const option = (university: (typeof universities)[number]) => (
    <SelectItem key={university.id} value={university.id}>
      <span className="flex w-full items-center justify-between gap-3">
        <span className="truncate">{university.name}</span>
        <span className="shrink-0 text-[10px] tracking-wider text-ash">
          {university.city} · {university.region}
        </span>
      </span>
    </SelectItem>
  );

  if (universities.length === 0) {
    return (
      <p className="rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-200">
        {t("roster.noUniversities")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} invalid={invalid}>
          <SelectValue placeholder={t("roster.selectUniversity")} />
        </SelectTrigger>
        <SelectContent>
          {government.length > 0 && (
            <SelectGroup>
              {government.map(option)}
            </SelectGroup>
          )}
          {privateUnis.length > 0 && (
            <SelectGroup>
              {privateUnis.map(option)}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      {value && !selected && (
        <p className="text-[11px] text-danger">
          {t("roster.universityGone")}
        </p>
      )}

      {selected && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ash">
          <Building2 className="size-3 shrink-0 text-brand" />
          <span>{selected.city}</span>
          <span className="text-ash/50">·</span>
          <span className="text-brand">{selected.region}</span>
          {selected && acceptedEmailDomains(selected)[0] && (
            <>
              <span className="text-ash/50">·</span>
              <span className="font-mono">@{acceptedEmailDomains(selected)[0]}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Organiser-defined requirement fields                                */
/* ------------------------------------------------------------------ */

function RequirementField({
  requirement,
  value,
  error,
  onChange,
}: {
  requirement: RequirementDefinition;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();

  if (requirement.type === "checkbox") {
    return (
      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[rgba(148,196,208,0.14)] bg-wall-950/40 p-3 transition-colors hover:border-brand/40">
          <Checkbox
            checked={value === "yes"}
            onChange={(checked) => onChange(checked ? "yes" : "")}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-snow">
              {requirement.label}
              {requirement.required && <span className="text-brand">*</span>}
            </span>
            {requirement.hint && (
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ash">
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
        label={requirement.label}
        required={requirement.required}
        error={error}
        hint={requirement.hint}
      >
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger invalid={Boolean(error)}>
            <SelectValue placeholder={requirement.placeholder ?? t("requirement.choose")} />
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
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Role controls                                                       */
/* ------------------------------------------------------------------ */

/** Which roles the organisers have opened up, starters always included. */
function roleOptions(rules: RosterRules): MemberRole[] {
  const roles: MemberRole[] = ["STARTER"];
  if (rules.maxSubstitutes > 0) roles.push("SUBSTITUTE");
  if (rules.maxCoaches > 0) roles.push("COACH");
  return roles;
}

function RoleSummary({ rules, counts }: { rules: RosterRules; counts: ReturnType<typeof countRoles> }) {
  const { t } = useLanguage();

  /* The whole phrase is translated rather than assembled from an English-shaped
     "{have} {label} · {want}", which produced hybrids like "1 starter · 1 needed"
     in the middle of an Arabic roster. A translator needs the sentence. */
  const pill = (key: string, text: string, ok: boolean) => (
    <span
      key={key}
      className={cn(
        "rounded-full border px-2.5 py-1 font-mono text-[10px]",
        ok ? "border-brand/35 bg-brand/8 text-brand" : "border-danger/40 bg-danger/8 text-danger",
      )}
    >
      {text}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pill(
        "starters",
        t(counts.starters === 1 ? "roster.starterNeeded" : "roster.startersNeeded", {
          have: counts.starters,
          want: rules.starters,
        }),
        counts.starters === rules.starters,
      )}
      {rules.maxSubstitutes > 0 &&
        pill(
          "subs",
          t("roster.subs", { have: counts.substitutes, want: rules.maxSubstitutes }),
          counts.substitutes <= rules.maxSubstitutes,
        )}
      {rules.maxCoaches > 0 &&
        pill(
          "coaches",
          t("roster.coaches", { have: counts.coaches, want: rules.maxCoaches }),
          counts.coaches <= rules.maxCoaches,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roster step                                                         */
/* ------------------------------------------------------------------ */

export function StepRoster({
  config,
  draft,
  duplicates,
  update,
  setMember,
  setRequirement,
  errors,
}: StepProps) {
  const { t, language } = useLanguage();
  const game = gameById(config, draft.gameId);
  const rules = rosterRulesFor(config, game);
  const universities = selectableUniversities(config, draft.gender);
  const counts = countRoles(draft.members, rules);
  const options = roleOptions(rules);

  /* The game tag's label and hint are the organiser's to change — `Game tag` and a
     sentence about Epic IDs ship as the defaults. An untouched default is still
     English, so it is read from the dictionary instead, and a value the organisers
     have actually typed is left exactly as they wrote it. */
  const gameTagLabel =
    config.gameTagLabel === DEFAULT_TOURNAMENT.gameTagLabel
      ? t("field.gameTag")
      : config.gameTagLabel;
  const gameTagHint =
    config.gameTagHint === DEFAULT_TOURNAMENT.gameTagHint
      ? t("field.gameTagHint")
      : config.gameTagHint;

  /* Provinces are stored as English keys — the identity of a province, not its
     name — so they have to be spelled out for the reader here. The Arabic comma is
     a different character, not a font detail. */
  const regionsLabel = config.allowedRegions
    .map((region) => regionLabel(region, language))
    .join(language === "ar" ? "، " : ", ");

  const removeMember = (index: number) => {
    const next = draft.members.filter((_, i) => i !== index);
    if (next.length === 0) return;

    update("members", next);
    if (next.length === 1) {
      /* Down to one person: that person leads, whoever was ticked before. Storing it
         keeps the saved draft honest — `effectiveLeaderIndex` would resolve it anyway,
         so this is consistency rather than the rule itself. */
      update("leaderIndex", 0);
    } else if (draft.leaderIndex === index) update("leaderIndex", null);
    else if (draft.leaderIndex !== null && draft.leaderIndex > index) {
      update("leaderIndex", draft.leaderIndex - 1);
    }
  };

  const appendMember = (role: MemberRole) => {
    if (draft.members.length >= rules.maxTotal) return;
    update("members", [...draft.members, emptyMember(role)]);
  };

  const filledCount = draft.members.filter(
    (member) =>
      member.fullName.trim() &&
      member.universityId &&
      EMAIL_PATTERN.test(member.email.trim()) &&
      member.discord.trim() &&
      normalisePhone(member.phone),
  ).length;

  const distinctUniversities = Array.from(
    new Set(draft.members.map((member) => member.universityId).filter(Boolean)),
  );

  const atCapacity = draft.members.length >= rules.maxTotal;

  /* Who leads, and whether that was a decision anyone had to make.

     A 1v1 title has one eligible member, so leadership is automatic — the box on that
     row would otherwise sit unticked while validation refused to submit, on a team with
     nobody else to nominate. */
  const leaderIndex = effectiveLeaderIndex(draft, rules);
  const leaderIsAutomatic =
    draft.members.filter((member) => resolveRole(member, rules) !== "COACH").length === 1;

  /** Starters still needed to field a legal squad. */
  const startersRemaining = Math.max(0, rules.starters - counts.starters);

  return (
    <div className="space-y-8">
      {/* ------------------------------- Counter ------------------------------- */}
      <Field
        label={t("roster.label")}
        error={errors.members}
        hint={
          game
            ? rules.starters === 1
              ? t("roster.gameFieldsPlayerOne", { game: game.name, format: game.format })
              : t("roster.gameFieldsPlayers", { game: game.name, count: rules.starters, format: game.format })
            : t("roster.chooseGameFirst")
        }
        badge={
          <span className="ml-2 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10px] text-brand">
            {t("roster.complete", { done: filledCount, total: draft.members.length })}
          </span>
        }
      >
        <div className="space-y-3">
          <RoleSummary rules={rules} counts={counts} />

          <div className="flex flex-wrap items-center gap-2">
            {/* Starters come first, and this button is always offered while the
                squad is short — including when the organisers have opened up no
                other role, which would otherwise leave no way to add anyone. */}
            <Button
              type="button"
              size="sm"
              variant={startersRemaining > 0 ? "primary" : "outline"}
              disabled={startersRemaining === 0 || atCapacity}
              onClick={() => appendMember("STARTER")}
            >
              <Plus className="size-3.5" />
              {startersRemaining > 0
                ? t(
                    startersRemaining === 1 ? "roster.addStarterOne" : "roster.addStarter",
                    { count: startersRemaining },
                  )
                : t("roster.startersComplete")}
            </Button>

            {rules.maxSubstitutes > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={counts.substitutes >= rules.maxSubstitutes || atCapacity}
                onClick={() => appendMember("SUBSTITUTE")}
              >
                <Plus className="size-3.5" />
                {t("roster.addSubstitute")}
              </Button>
            )}
            {rules.maxCoaches > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={counts.coaches >= rules.maxCoaches || atCapacity}
                onClick={() => appendMember("COACH")}
              >
                <Plus className="size-3.5" />
                {t("roster.addCoach")}
              </Button>
            )}
          </div>

          {/* The two ways a roster can stall, each said plainly. */}
          {startersRemaining > 0 && atCapacity && (
            <p className="text-[11px] text-amber-300">
              {t("roster.needMore", { max: rules.maxTotal })}
            </p>
          )}
          {startersRemaining > 0 && !atCapacity && (
            <p className="text-[11px] text-amber-300">
              {t("roster.fieldsAtLeast", { game: game?.name ?? t("roster.thisGame"), count: rules.starters, missing: startersRemaining })}
            </p>
          )}
          {startersRemaining === 0 && rules.maxSubstitutes === 0 && rules.maxCoaches === 0 && (
            <p className="text-[11px] text-ash">
              {t("roster.startersOnly")}
            </p>
          )}
        </div>
      </Field>

      {/* --------------------------- University note --------------------------- */}
      <div className="panel-inset flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl p-3 text-[11px] text-ash">
        <Building2 className="size-3.5 shrink-0 text-brand" />
        {/* The keys for these read like English literals and were skipped for years
            because of it: `roster.universityMixed` and friends existed in both
            dictionaries and nothing ever called them, so an Arabic captain read
            this panel in English. */}
        {config.allowMixedUniversities ? (
          <span>
            {t("roster.universityMixed")}
            {config.allowedRegions.length > 0 &&
              t("roster.onlyRegions", { regions: regionsLabel })}
          </span>
        ) : (
          <span>
            {t("roster.universitySame")}
            {config.allowedRegions.length > 0 &&
              t("roster.onlyRegions", { regions: regionsLabel })}
          </span>
        )}
        {distinctUniversities.length > 1 && (
          <span className="ms-auto rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10px] text-brand">
            {t("roster.universitiesCount", { count: distinctUniversities.length })}
          </span>
        )}
      </div>

      {errors["members.university"] && (
        <p className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
          {errors["members.university"]}
        </p>
      )}

      {/* ------------------------------- Members ------------------------------- */}
      <div className="space-y-3">
        {draft.members.map((member, index) => {
          const role = resolveRole(member, rules);
          const isCoach = role === "COACH";
          const isLeader = leaderIndex === index;
          const emailDomain = domainOf(member.email.trim());
          const university = universities.find((entry) => entry.id === member.universityId);
          /* The institutional domain is not always what a student holds — KSU issues
             `student.ksu.edu.sa` — so the live hint has to test the same accepted set the
             validator uses, or it flags a correct address as wrong. */
          const domainMismatch =
            emailDomain.length > 0 &&
            EMAIL_PATTERN.test(member.email.trim()) &&
            Boolean(university) &&
            !emailMatchesUniversity(member.email.trim(), university!);
          const verified =
            member.verifiedEmail.trim().toLowerCase() === member.email.trim().toLowerCase() &&
            member.email.trim().length > 0;

          return (
            <section
              key={index}
              className={cn(
                "animate-rise panel rounded-2xl p-4 sm:p-5",
                role === "SUBSTITUTE" && "border-chrome-4/25",
                isCoach && "border-violet-400/25",
                isLeader && "border-brand/45",
              )}
            >
              <header className="mb-4 flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-sm",
                    role === "STARTER"
                      ? "bg-gradient-to-b from-brand-bright to-brand-deep text-wall-950"
                      : isCoach
                        ? "bg-gradient-to-b from-violet-300 to-violet-500 text-wall-900"
                        : "bg-gradient-to-b from-chrome-2 to-chrome-4 text-wall-900",
                  )}
                >
                  {index + 1}
                </span>

                <p className="text-sm font-bold tracking-wide text-snow">
                  {t(isCoach ? "roster.coachN" : "roster.playerN", { n: index + 1 })}
                </p>

                <RolePill role={role} label={t(roleLabelKey(role))} />

                {/* Organisers decide whether these roles exist at all. */}
                {options.length > 1 && (
                  <Select
                    value={role}
                    onValueChange={(value) => setMember(index, { role: value as MemberRole })}
                  >
                    <SelectTrigger
                      aria-label={t("roster.roleFor", { role: t(isCoach ? "roster.coach" : "roster.playerN", { n: index + 1 }), n: index + 1 })}
                      className="h-8 w-36 text-[11px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(roleLabelKey(option))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div className="ms-auto flex items-center gap-2">
                  {/* Leader is a checkbox on the roster, not a separate step.

                      Except when there is nobody else it could be. On a 1v1 title the
                      single player *is* the leader, and a tickable box there would be
                      an invitation to untick the only legal answer — so it is shown as
                      decided instead: same crown, no control. That is also why the
                      stored `leaderIndex` does not have to be set for such a roster to
                      validate; see `effectiveLeaderIndex`. */}
                  {!isCoach &&
                    (leaderIsAutomatic ? (
                      <span
                        className="flex items-center gap-2 rounded-xl border border-brand/60 bg-brand/10 px-3 py-1.5 text-brand"
                        title={t("roster.leaderAutomatic")}
                      >
                        <Crown className="size-3.5" />
                        <span className="text-[11px] font-bold tracking-wide">
                          {t("roster.teamLeader")}
                        </span>
                        <Check className="size-3.5" />
                      </span>
                    ) : (
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors",
                          isLeader
                            ? "border-brand/60 bg-brand/10 text-brand"
                            : "border-[rgba(148,196,208,0.2)] text-ash hover:border-brand/40 hover:text-snow",
                        )}
                      >
                        <Checkbox
                          checked={isLeader}
                          onChange={(checked) => update("leaderIndex", checked ? index : null)}
                          aria-label={t("roster.makeLeader", { n: index + 1 })}
                        />
                        <Crown className="size-3.5" />
                        <span className="text-[11px] font-bold tracking-wide">
                          {t("roster.teamLeader")}
                        </span>
                      </label>
                    ))}

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t(isCoach ? "roster.removeCoach" : "roster.removePlayer", { n: index + 1 })}
                    disabled={draft.members.length <= 1}
                    onClick={() => removeMember(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </header>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field
                  label={
                    <>
                      <User className="size-3" /> {t("field.fullName")}
                    </>
                  }
                  htmlFor={`name-${index}`}
                  required
                  error={errors[`member.${index}.fullName`]}
                  /* Digits or a refused word appear as they are typed — a name is
                     checked, and saying so immediately is the only way to show it. */
                  immediate={revealsImmediately("fullName", member.fullName, config.blockedTerms)}
                  hint={t("field.fullNameHint")}
                >
                  <Input
                    id={`name-${index}`}
                    value={member.fullName}
                    invalid={Boolean(errors[`member.${index}.fullName`])}
                    maxLength={60}
                    autoComplete="off"
                    placeholder={t("field.fullNamePlaceholder")}
                    onChange={(event) => setMember(index, { fullName: event.target.value })}
                  />
                </Field>

                <Field
                  label={
                    <>
                      <Gamepad2 className="size-3" /> {gameTagLabel}
                    </>
                  }
                  htmlFor={`tag-${index}`}
                  required={!isCoach}
                  error={errors[`member.${index}.gameTag`]}
                  immediate={revealsImmediately("gameTag", member.gameTag, config.blockedTerms)}
                  hint={isCoach ? t("field.gameTagCoachHint") : gameTagHint}
                >
                  <Input
                    id={`tag-${index}`}
                    dir="ltr"
                    value={member.gameTag}
                    invalid={Boolean(errors[`member.${index}.gameTag`])}
                    autoComplete="off"
                    maxLength={32}
                    placeholder={t("field.gameTagPlaceholder")}
                    onChange={(event) => setMember(index, { gameTag: event.target.value })}
                    className="font-mono text-[13px]"
                  />
                </Field>

                <Field
                  label={
                    <>
                      <Building2 className="size-3" /> {t("field.university")}
                    </>
                  }
                  htmlFor={`uni-${index}`}
                  required
                  error={errors[`member.${index}.university`]}
                  className="lg:col-span-2"
                >
                  <UniversitySelect
                    id={`uni-${index}`}
                    value={member.universityId}
                    universities={universities}
                    invalid={Boolean(errors[`member.${index}.university`])}
                    onChange={(value) => setMember(index, { universityId: value })}
                  />
                </Field>

                <Field
                  label={
                    <>
                      <Mail className="size-3" /> {t("field.email")}
                    </>
                  }
                  htmlFor={`email-${index}`}
                  required
                  error={errors[`member.${index}.email`]}
                  warning={
                    domainMismatch
                      ? t("field.domainMismatch", {
                          domain: university ? acceptedEmailDomains(university)[0] : "",
                        })
                      : undefined
                  }
                  immediate={revealsImmediately("email", member.email)}
                  hint={t("field.emailHint")}
                  className="lg:col-span-2"
                >
                  <div className="space-y-2">
                    {/* `dir="ltr"` on the wrapper, not just the input.
                        The input holds a Latin value and pads its *inline end*; the
                        badge sits at `end-3`. Those only agree when both resolve `end`
                        the same way — left to the ambient RTL the badge landed on the
                        left, printed over the address it was reporting on. */}
                    <div dir="ltr" className="relative">
                      <Input
                        id={`email-${index}`}
                        type="email"
                        inputMode="email"
                        dir="ltr"
                        value={member.email}
                        /* **No address without a university.** The address is checked
                           against the chosen institution's own domain, so with nothing
                           chosen there is no rule to check it against — and whatever is
                           typed would have to be rejected later, after a code had perhaps
                           already been sent. Locking the field makes the order of the two
                           answers obvious instead of explaining a failure afterwards. */
                        disabled={!member.universityId}
                        invalid={Boolean(errors[`member.${index}.email`])}
                        autoComplete="off"
                        placeholder={
                          member.universityId
                            ? t("field.emailPlaceholder")
                            : t("field.emailChooseUniversityFirst")
                        }
                        onChange={(event) => setMember(index, { email: event.target.value })}
                        className="pe-24 font-mono text-[13px]"
                      />
                      <DuplicateBadge
                        state={duplicates.member(index, "email")}
                        taken={t("dup.alreadyUsed")}
                      />
                    </div>
                    <EmailVerification
                      email={member.email}
                      verifiedEmail={member.verifiedEmail}
                      disabled={!member.universityId}
                      onChange={(verifiedEmail, proof) =>
                        setMember(index, { verifiedEmail, emailProof: proof })
                      }
                    />
                  </div>
                </Field>

                <Field
                  label={
                    <>
                      <Hash className="size-3" /> {t("field.studentId")}
                    </>
                  }
                  htmlFor={`id-${index}`}
                  required={!isCoach}
                  error={errors[`member.${index}.studentId`]}
                  hint={isCoach ? t("field.studentIdCoachHint") : t("field.studentIdHint")}
                >
                  {/* Same reason as the email field above — the number is Latin and
                      its badge must sit at its right in both languages. */}
                  <div dir="ltr" className="relative">
                    <Input
                      id={`id-${index}`}
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={STUDENT_ID_MAX}
                      value={member.studentId}
                      invalid={Boolean(errors[`member.${index}.studentId`])}
                      autoComplete="off"
                      placeholder={t("field.studentIdPlaceholder")}
                      /* Digits only, folded on the way in.
                         This field is a student number and nothing else, so a letter
                         or a dash is a mistake worth preventing rather than
                         reporting later. `digitsOnly` also folds Arabic-Indic
                         numerals, which is what an Arabic keyboard produces —
                         without that a student on an Arabic keyboard could not type
                         their own number at all, because `/\D/` is ASCII-only. */
                      onChange={(event) =>
                        setMember(index, {
                          studentId: digitsOnly(event.target.value).slice(0, STUDENT_ID_MAX),
                        })
                      }
                      className="pe-24 font-mono text-[13px]"
                    />
                    <DuplicateBadge
                      state={duplicates.member(index, "studentId")}
                      taken={t("dup.alreadyUsed")}
                    />
                  </div>
                </Field>

                <Field
                  label={
                    <>
                      <MessageCircle className="size-3" /> {t("field.discord")}
                    </>
                  }
                  htmlFor={`discord-${index}`}
                  required
                  error={errors[`member.${index}.discord`]}
                  hint={t("field.discordHint")}
                >
                  <Input
                    id={`discord-${index}`}
                    dir="ltr"
                    value={member.discord}
                    invalid={Boolean(errors[`member.${index}.discord`])}
                    autoComplete="off"
                    placeholder={t("field.discordPlaceholder")}
                    onChange={(event) => setMember(index, { discord: event.target.value })}
                    className="font-mono text-[13px]"
                  />
                </Field>

                <Field
                  label={
                    <>
                      <Phone className="size-3" /> {t("field.phone")}
                    </>
                  }
                  htmlFor={`phone-${index}`}
                  required
                  error={errors[`member.${index}.phone`]}
                  hint={
                    normalisePhone(member.phone)
                      ? t("field.phoneSaved", { phone: formatPhone(normalisePhone(member.phone)!) })
                      : t("field.phoneHint")
                  }
                >
                  <Input
                    id={`phone-${index}`}
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    value={member.phone}
                    invalid={Boolean(errors[`member.${index}.phone`])}
                    autoComplete="off"
                    placeholder={t("field.phonePlaceholder")}
                    onChange={(event) => setMember(index, { phone: event.target.value })}
                    onBlur={() => {
                      const normalised = normalisePhone(member.phone);
                      if (normalised) setMember(index, { phone: normalised });
                    }}
                    className="font-mono text-[13px]"
                  />
                </Field>

                {config.requirements.map((requirement) => (
                  <div
                    key={requirement.id}
                    className={cn(requirement.type === "checkbox" && "lg:col-span-2")}
                  >
                    <RequirementField
                      requirement={requirement}
                      value={member.requirements[requirement.id] ?? ""}
                      error={errors[`member.${index}.req.${requirement.id}`]}
                      onChange={(value) => setRequirement(index, requirement.id, value)}
                    />
                  </div>
                ))}
              </div>

              {!verified && (
                <p className="mt-4 flex items-center gap-2 border-t border-[rgba(148,196,208,0.12)] pt-3 text-[11px] text-amber-300">
                  <Mail className="size-3.5 shrink-0" />
                  {t("roster.notFinished")}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {!game && (
        <p className="flex items-center gap-2 text-[11px] text-ash">
          <Users className="size-3.5" />
          {t("roster.pickGameFirst")}
        </p>
      )}
    </div>
  );
}
