"use client";

import * as React from "react";
import {
  Building2,
  Crown,
  Gamepad2,
  Hash,
  Mail,
  MessageCircle,
  Phone,
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
import { countRoles, effectiveLeaderIndex, EMAIL_PATTERN, resizeRoster, resolveRole, revealsImmediately, STUDENT_ID_MAX, studentIdAfterEdit, studentIdFromEmail } from "@/lib/validation";
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
      {/* On a phone this row is the widest thing on the page, so the two halves have
          to be allowed to give way: the name truncates, and the city keeps a fixed
          share rather than collapsing to nothing when the name is long. */}
      <span className="flex w-full min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate">{university.name}</span>
        <span className="shrink-0 truncate text-[0.625rem] tracking-wider text-ash">
          {university.city} · {university.region}
        </span>
      </span>
    </SelectItem>
  );

  if (universities.length === 0) {
    return (
      <p className="rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2 text-[0.6875rem] text-amber-200">
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
        <p className="text-[0.6875rem] text-danger">
          {t("roster.universityGone")}
        </p>
      )}

      {selected && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-ash">
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
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[rgba(79, 182, 208,0.14)] bg-wall-950/40 p-3 transition-colors hover:border-brand/40">
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

function RoleSummary({ rules, counts }: { rules: RosterRules; counts: ReturnType<typeof countRoles> }) {
  const { t } = useLanguage();

  /* The whole phrase is translated rather than assembled from an English-shaped
     "{have} {label} · {want}", which produced hybrids like "1 starter · 1 needed"
     in the middle of an Arabic roster. A translator needs the sentence. */
  const pill = (key: string, text: string, ok: boolean) => (
    <span
      key={key}
      className={cn(
        "rounded-full border px-2.5 py-1 font-mono text-[0.625rem]",
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

  /* The line-up is fixed by the game; the bench and the coach are the captain's
     choice. Both controls rewrite the shape in one place, so the roster cannot end
     up in a form validation would refuse. */
  const setShape = (nextSubstitutes: number, nextCoach: boolean) => {
    update("members", resizeRoster(draft.members, rules, nextSubstitutes, nextCoach));
  };

  const filledCount = draft.members.filter((member, index) => {
    const isCoach = resolveRole(member, rules) === "COACH";
    /* What the captain owes: a university and an address for everyone, plus their
       own full details. A teammate's name, tag and contacts are completed by that
       player, so they must not hold the counter back. */
    const ready = (isCoach || Boolean(member.universityId)) && EMAIL_PATTERN.test(member.email.trim());
    if (effectiveLeaderIndex(draft, rules) !== index) return ready;
    return (
      ready &&
      member.fullName.trim() &&
      member.discord.trim() &&
      normalisePhone(member.phone)
    );
  }).length;

  const distinctUniversities = Array.from(
    new Set(draft.members.map((member) => member.universityId).filter(Boolean)),
  );

  /* The registrant is the leader and is always the first row, so nothing on this
     step has to decide it. */
  const leaderIndex = effectiveLeaderIndex(draft, rules);
  const coachAvailable = rules.maxCoaches > 0;

  return (
    <div className="space-y-8">
      {/* ------------------------------- Counter ------------------------------- */}
      <Field
        label={t("roster.label")}
        error={errors.members}
        hint={
          game
            ? undefined
            : t("roster.chooseGameFirst")
        }
        badge={
          <span className="ml-2 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[0.625rem] text-brand">
            {t("roster.complete", { done: filledCount, total: draft.members.length })}
          </span>
        }
      >
        <div className="space-y-3">
          <RoleSummary rules={rules} counts={counts} />

          <div className="grid gap-4 sm:grid-cols-2">
            {/* The starting line-up is not a choice. The game fields this many, so
                the roster always contains exactly this many — the captain picks who
                they are, not how many. */}
            <div className="panel-inset rounded-xl p-3">
              <p className="text-[0.625rem] font-bold tracking-[0.14em] text-ash uppercase">
                {t("roster.mainPlayers")}
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-snow">
                {rules.starters}
              </p>
              <p className="mt-0.5 text-[0.625rem] leading-relaxed text-ash">
                {t("roster.mainPlayersFixed", {
                  game: game?.name ?? t("roster.thisGame"),
                })}
              </p>
            </div>

            <div className="panel-inset space-y-3 rounded-xl p-3">
              {rules.maxSubstitutes > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="roster-substitutes"
                    className="text-[0.6875rem] font-semibold text-snow"
                  >
                    {t("roster.substitutesLabel")}
                  </label>
                  <Select
                    value={String(counts.substitutes)}
                    onValueChange={(value) => setShape(Number(value), counts.coaches > 0)}
                  >
                    {/* The count is rendered here rather than through `SelectValue`:
                        Radix only knows an item's label once its menu has been opened,
                        so a preselected "0" showed an empty box until the captain
                        happened to open it. */}
                    <SelectTrigger id="roster-substitutes" className="h-8 w-24 text-[0.6875rem]">
                      <span className="font-mono">{counts.substitutes}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: rules.maxSubstitutes + 1 }, (_, index) => (
                        <SelectItem key={index} value={String(index)}>
                          {index}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-[0.6875rem] text-ash">{t("roster.noSubstitutes")}</p>
              )}

              {coachAvailable ? (
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-[0.6875rem] font-semibold text-snow">
                    {t("roster.coachLabel")}
                  </span>
                  <Checkbox
                    checked={counts.coaches > 0}
                    onChange={(checked) => setShape(counts.substitutes, checked)}
                    aria-label={t("roster.coachLabel")}
                  />
                </label>
              ) : (
                <p className="text-[0.6875rem] text-ash">{t("roster.noCoach")}</p>
              )}
            </div>
          </div>

          <p className="text-[0.6875rem] text-ash">
            {t("roster.leaderIsRegistrant")}
          </p>
        </div>
      </Field>

      {/* --------------------------- University note --------------------------- */}
      <div className="panel-inset flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl p-3 text-[0.6875rem] text-ash">
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
          <span className="ms-auto rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[0.625rem] text-brand">
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
             validator uses, or it flags a correct address as wrong. Coaches may use any
             address, so the domain rule does not apply to them. */
          const domainMismatch =
            !isCoach &&
            emailDomain.length > 0 &&
            EMAIL_PATTERN.test(member.email.trim()) &&
            Boolean(university) &&
            !emailMatchesUniversity(member.email.trim(), university!);
          /* The send-code button waits for an address it can actually verify: a
             complete player address on the selected institution's domain, or any
             complete address for a coach. */
          const emailReady =
            EMAIL_PATTERN.test(member.email.trim()) &&
            (isCoach ? true : Boolean(university) && emailMatchesUniversity(member.email.trim(), university!));
          const verified =
            member.verifiedEmail.trim().toLowerCase() === member.email.trim().toLowerCase() &&
            member.email.trim().length > 0;
          /**
           * The student number this member's address carries, when the institution embeds
           * one. Used twice: to fill the field, and to say so underneath it — a number that
           * appeared on its own looks like a bug unless it is explained.
           */
          const idFromEmail = university ? studentIdFromEmail(member.email, university) : null;
          const idWasFilled = idFromEmail !== null && idFromEmail === member.studentId;

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

                {/* The first row is the registrant, so it is the leader. Shown, not
                    asked: there is no other row it could be. */}
                {isLeader && (
                  <span
                    className="flex items-center gap-2 rounded-xl border border-brand/60 bg-brand/10 px-3 py-1.5 text-brand"
                    title={t("roster.leaderAutomatic")}
                  >
                    <Crown className="size-3.5" />
                    <span className="text-[0.6875rem] font-bold tracking-wide">
                      {t("roster.teamLeader")}
                    </span>
                  </span>
                )}
              </header>

              <div className="grid gap-4 lg:grid-cols-2">
                {isLeader && (
                  <>
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
                    className="font-mono text-[0.8125rem]"
                  />
                </Field>
                  </>
                )}

                <Field
                  label={
                    <>
                      <Building2 className="size-3" />{" "}
                      {t(isCoach ? "field.universityCoachLabel" : "field.university")}
                    </>
                  }
                  htmlFor={`uni-${index}`}
                  required={!isCoach}
                  error={errors[`member.${index}.university`]}
                  hint={isCoach ? t("field.universityCoachHint") : undefined}
                  className="lg:col-span-2"
                >
                  <UniversitySelect
                    id={`uni-${index}`}
                    value={member.universityId}
                    universities={universities}
                    invalid={Boolean(errors[`member.${index}.university`])}
                    onChange={(value) => {
                      /* The rule for reading a number out of an address belongs to the
                         institution, so changing institution changes what the address already
                         typed means — SEU wants the leading `s`, KSU does not. Recompute here
                         rather than leave a number the new rule does not support. A number
                         typed by hand is left alone, as everywhere else. */
                      const nextUniversity = universities.find((entry) => entry.id === value);
                      setMember(index, {
                        universityId: value,
                        studentId: studentIdAfterEdit(
                          member.studentId,
                          { email: member.email, university },
                          { email: member.email, university: nextUniversity },
                        ),
                      });
                    }}
                  />
                </Field>

                <Field
                  label={
                    <>
                      <Mail className="size-3" /> {t(isCoach ? "field.emailCoachLabel" : "field.email")}
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
                  /* No red while the address is being typed, and no "Required" the
                     instant a university unlocks the field. A blur — or an actual
                     attempt to send the code — is when there is an answer to give. */
                  revealOnTouch
                  hint={t(isCoach ? "field.emailCoachHint" : "field.emailHint")}
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
                        /* **No player address without a university.** A player's address
                           is checked against the chosen institution's own domain, so with
                           nothing chosen there is no rule to check it against. Coaches are
                           exempt: they may use a personal address. */
                        disabled={!isCoach && !member.universityId}
                        invalid={Boolean(errors[`member.${index}.email`])}
                        autoComplete="off"
                        placeholder={
                          isCoach
                            ? t("field.emailCoachPlaceholder")
                            : member.universityId
                              ? t("field.emailPlaceholder")
                              : t("field.emailChooseUniversityFirst")
                        }
                        onChange={(event) => {
                          const email = event.target.value;

                          /*
                           * Fill the student number from the address the captain is already
                           * typing. Every institution on the list issues
                           * `<number>@<domain>` — two wrap it in literal text — so asking for
                           * the same digits a second time is busywork that also invites a
                           * typo.
                           *
                           * **It fills as they type, not when they finish.** The strict reader
                           * answers only for a complete address, so the number appeared in a
                           * single jump on the last keystroke — which looks like the fill is
                           * broken for the whole nine digits before it. The preview reader
                           * returns the digits so far, so the field grows number by number,
                           * right from the first one. It still refuses an address heading for
                           * another domain, and takes a provisional value back with it.
                           *
                           * **It never overwrites a number typed by hand.** The test is
                           * whether the current value is what the *previous* address implied:
                           * if it is (or the field is empty), this value came from the address
                           * and may be updated with it; if it is anything else, a person chose
                           * it and it is left alone. That needs no extra state, and it keeps
                           * working when the captain corrects the address after filling.
                           */
                          setMember(index, {
                            email,
                            studentId: studentIdAfterEdit(
                              member.studentId,
                              { email: member.email, university },
                              { email, university },
                            ),
                          });
                        }}
                        className="pe-24 font-mono text-[0.8125rem]"
                      />
                      <DuplicateBadge
                        state={duplicates.member(index, "email")}
                        taken={t("dup.alreadyUsed")}
                      />
                    </div>
                    {/* Only the team leader verifies with a code before submitting.
                        Everyone else is emailed a link after the captain submits, so
                        showing them a send-code button would be asking for work that
                        no longer exists. */}
                    {isLeader ? (
                      <EmailVerification
                        email={member.email}
                        verifiedEmail={member.verifiedEmail}
                        ready={emailReady}
                        onChange={(verifiedEmail, proof) =>
                          setMember(index, { verifiedEmail, emailProof: proof })
                        }
                      />
                    ) : null}
                  </div>
                </Field>

                {!isLeader && (
                  <div className="flex items-start gap-2 rounded-xl border border-brand/25 bg-brand/6 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-ash lg:col-span-2">
                    <User className="mt-px size-3.5 shrink-0 text-brand" />
                    <span>
                      {t(isCoach ? "roster.selfCompleteCoach" : "roster.selfComplete")}
                    </span>
                  </div>
                )}

                {isLeader && (
                  <>
                <Field
                  label={
                    <>
                      <Hash className="size-3" /> {t("field.studentId")}
                    </>
                  }
                  htmlFor={`id-${index}`}
                  required={!isCoach}
                  error={errors[`member.${index}.studentId`]}
                  hint={
                    isCoach
                      ? t("field.studentIdCoachHint")
                      : idWasFilled
                        ? t("field.studentIdFromEmail")
                        : t("field.studentIdHint")
                  }
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
                      className="pe-24 font-mono text-[0.8125rem]"
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
                    className="font-mono text-[0.8125rem]"
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
                    normalisePhone(member.phone) ? (
                      /* Only the number is LTR. The sentence around it is Arabic and
                         must read right-to-left; without isolating the number the
                         `+` and its digits were reordered by the bidi algorithm. */
                      <>
                        {t("field.phoneSavedPrefix")}{" "}
                        <span dir="ltr" className="inline-block font-mono">
                          {formatPhone(normalisePhone(member.phone)!)}
                        </span>
                      </>
                    ) : (
                      t("field.phoneHint")
                    )
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
                    className="font-mono text-[0.8125rem]"
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
                  </>
                )}
              </div>

              {/* Only the leader has work left to do here. Everyone else is emailed a
                  confirmation link after submission, and a coach has no code to enter. */}
              {isLeader && !verified && (
                <p className="mt-4 flex items-center gap-2 border-t border-[rgba(79, 182, 208,0.12)] pt-3 text-[0.6875rem] text-amber-300">
                  <Mail className="size-3.5 shrink-0" />
                  {t("roster.notFinishedLeader")}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {!game && (
        <p className="flex items-center gap-2 text-[0.6875rem] text-ash">
          <Users className="size-3.5" />
          {t("roster.pickGameFirst")}
        </p>
      )}
    </div>
  );
}
