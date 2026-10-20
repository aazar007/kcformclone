"use client";

import * as React from "react";
import {
  AlertCircle,
  BookOpen,
  Building2,
  Crown,
  Gamepad2,
  Gamepad,
  Hash,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  User,
  Users,
} from "lucide-react";
import { cn, formatPhone, normalisePhone } from "@/lib/utils";

import { gameById, rosterRulesFor, selectableUniversities } from "@/lib/tournament";
import { countRoles, resolveRole } from "@/lib/validation";
import { normaliseTeamName } from "@/lib/team-name";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RolePill } from "@/components/ui/field";
import { ValidationSummary } from "./validation-summary";
import { useLanguage } from "./language-provider";
import type { Language } from "@/lib/i18n";
import { arabicDigits } from "@/lib/i18n";
import { roleLabelKey } from "@/lib/i18n";
import type { StepProps } from "./types";

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 text-ash">{icon}</span>
      <span className="w-36 shrink-0 text-[11px] font-bold tracking-[0.12em] text-ash uppercase">
        {label}
      </span>
      <span className={cn("min-w-0 flex-1 text-sm text-snow break-words", mono && "font-mono text-[13px]")}>
        {value}
      </span>
    </div>
  );
}

function Card({
  title,
  icon,
  step,
  onEdit,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  step: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();

  return (
    <section className="panel rounded-2xl p-5">
      <header className="mb-3 flex items-center justify-between gap-3 border-b border-[rgba(148,196,208,0.12)] pb-3">
        <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] text-brand uppercase">
          {icon}
          {title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => onEdit(step)}
        >
          <Pencil className="size-3" />
          {t("review.edit")}
        </Button>
      </header>
      <div className="divide-y divide-[rgba(148,196,208,0.08)]">{children}</div>
    </section>
  );
}

/**
 * Split a translated sentence around one placeholder and drop a node into it.
 *
 * The alternative — writing the sentence as JSX with the link in the middle — pins
 * the word order to English, which is how the consent paragraph ended up rendering
 * in English for Arabic readers. This way the translator controls where the link
 * falls, and a language that puts it elsewhere simply moves the placeholder.
 */
function withLink(
  template: string,
  placeholder: string,
  node: React.ReactNode,
): React.ReactNode {
  const parts = template.split(placeholder);
  if (parts.length === 1) return template;

  return parts.map((part, index) => (
    <React.Fragment key={index}>
      {part}
      {index < parts.length - 1 ? node : null}
    </React.Fragment>
  ));
}

/**
 * The privacy link, carrying the current language.
 *
 * The notice is rendered by the server, which cannot see the language the form is
 * being used in — that choice lives in the browser. Putting it in the URL is what
 * lets the same click open the Arabic notice for an Arabic reader and the English
 * one for an English reader.
 *
 * Existing query parameters on the configured URL are preserved rather than
 * replaced, so an organiser pointing this at their own page with its own parameters
 * does not lose them.
 */
function policyHref(policyUrl: string, language: Language): string {
  const [path, query] = policyUrl.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("lang", language);
  return `${path}?${params.toString()}`;
}

export function StepReview({
  config,
  draft,
  update,
  errors,
  warnings,
  goToStep,
  revealed,
  rulebooks,
  gamesRead,
  onOpenRulebook,
}: StepProps) {
  const { t, language } = useLanguage();
  const game = gameById(config, draft.gameId);
  const squadSize = game?.squadSize ?? 1;
  const rules = rosterRulesFor(config, game);
  const counts = countRoles(draft.members, rules);
  const universities = selectableUniversities(config, draft.gender);
  const leader = draft.leaderIndex !== null ? draft.members[draft.leaderIndex] : null;
  const teamName = normaliseTeamName(draft.teamName);

  const universityNames = Array.from(
    new Set(
      draft.members
        .map((member) => universities.find((entry) => entry.id === member.universityId)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  );

  return (
    <div className="space-y-5">
      <ValidationSummary errors={errors} warnings={warnings} onGoToStep={goToStep} revealed={revealed} />

      <Card title={t("review.team")} icon={<Users className="size-3.5" />} step={0} onEdit={goToStep}>
        <Row
          icon={<Users className="size-3.5" />}
          label={t("review.teamName")}
          value={teamName || "—"}
        />
        <Row
          icon={<Gamepad2 className="size-3.5" />}
          label={t("review.division")}
          value={draft.gender ? t(draft.gender === "female" ? "division.female" : "division.male") : "—"}
        />
      </Card>

      <Card title={t("review.gameLabel")} icon={<Gamepad2 className="size-3.5" />} step={1} onEdit={goToStep}>
        <Row
          icon={<Gamepad2 className="size-3.5" />}
          label={t("review.gameLabel")}
          value={
            game ? (
              <span className="flex flex-wrap items-center gap-2">
                {game.name}
                <span className="font-mono text-[11px] text-ash">
                  {/* The game step renders this same line through the dictionary; the
                      review step had it written out in English, so the Arabic review
                      screen read "1v1 · 1 on field". */}
                  {t("game.onField", { format: game.format, count: squadSize })}
                </span>
              </span>
            ) : (
              "—"
            )
          }
        />
        <Row
          icon={<Users className="size-3.5" />}
          label={t("review.rosterSize")}
          value={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">
                {draft.members.length} / {rules.maxTotal}
              </span>
              <span className="text-[11px] text-ash">
                {counts.starters === 1
                  ? t("review.starterOne")
                  : t("review.startersMany", { count: counts.starters })}
                {/* Built from the dictionary rather than concatenating English words
                    with a plural `s`. The Arabic review step read
                    "1 أساسي · 2 substitutes · 1 coach" because this one line was
                    assembled by hand while every other count in the form used a key. */}
                {counts.substitutes > 0 &&
                  ` · ${
                    counts.substitutes === 1
                      ? t("review.subOne")
                      : t("review.subsMany", { count: counts.substitutes })
                  }`}
                {counts.coaches > 0 &&
                  ` · ${
                    counts.coaches === 1
                      ? t("review.coachOne")
                      : t("review.coachesMany", { count: counts.coaches })
                  }`}
              </span>
            </span>
          }
        />
      </Card>

      <Card
        title={t("review.rosterN", { count: draft.members.length })}
        icon={<User className="size-3.5" />}
        step={2}
        onEdit={goToStep}
      >
        {draft.members.map((member, index) => {
          const role = resolveRole(member, rules);
          const isLeader = draft.leaderIndex === index;
          const university = universities.find((entry) => entry.id === member.universityId);
          const phone = normalisePhone(member.phone);
          const verified =
            member.verifiedEmail.trim().toLowerCase() === member.email.trim().toLowerCase() &&
            member.email.trim().length > 0;

          return (
            <div key={index} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs",
                    isLeader
                      ? "bg-gradient-to-b from-brand-bright to-brand-deep text-wall-950"
                      : "bg-wall-700 text-ash",
                  )}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-snow">
                    {member.fullName.trim() || "—"}
                  </span>
                  {isLeader && <Crown className="size-3.5 shrink-0 text-brand" />}
                </span>
                {member.gameTag.trim() && (
                  <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10px] text-brand">
                    {member.gameTag.trim()}
                  </span>
                )}
                <span className="ms-auto flex items-center gap-2">
                  <span className="text-[10px] tracking-wider text-ash uppercase">
                    {t(roleLabelKey(role))}
                  </span>
                  <RolePill role={role} label={t(roleLabelKey(role))} />
                </span>
              </div>

              <dl className="mt-2 grid gap-x-4 gap-y-1.5 ps-10 sm:grid-cols-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-3 shrink-0 text-ash" />
                  <dt className="sr-only">{t("review.university")}</dt>
                  <dd className="min-w-0 truncate text-[12px] text-snow">
                    {university?.name ?? "—"}
                    {university && (
                      <span className="ms-2 text-[11px] text-ash">{university.region}</span>
                    )}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-3 shrink-0 text-ash" />
                  <dt className="sr-only">{t("review.email")}</dt>
                  <dd className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[12px] text-ash">
                      {member.email.trim() || "—"}
                    </span>
                    {verified ? (
                      <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-300 uppercase">
                        {t("review.emailConfirmed")}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-danger uppercase">
                        {t("review.emailNotConfirmed")}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Hash className="size-3 shrink-0 text-ash" />
                  <dt className="sr-only">{t("review.studentId")}</dt>
                  <dd className="min-w-0 truncate font-mono text-[12px] text-ash">
                    {member.studentId.trim() || "—"}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <MessageCircle className="size-3 shrink-0 text-ash" />
                  <dt className="sr-only">{t("review.discord")}</dt>
                  <dd className="min-w-0 truncate font-mono text-[12px] text-ash">
                    {member.discord.trim() || "—"}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Phone className="size-3 shrink-0 text-ash" />
                  <dt className="sr-only">{t("review.phone")}</dt>
                  <dd className="min-w-0 truncate font-mono text-[12px] text-ash">
                    {phone ? formatPhone(phone) : member.phone.trim() || "—"}
                  </dd>
                </div>
                {config.requirements
                  .filter((requirement) => member.requirements[requirement.id])
                  .map((requirement) => (
                    <div key={requirement.id} className="flex min-w-0 items-center gap-2">
                      <Gamepad className="size-3 shrink-0 text-ash" />
                      <dt className="sr-only">{requirement.label}</dt>
                      <dd className="min-w-0 truncate text-[12px] text-ash">
                        <span className="text-ash/70">{requirement.label}:</span>{" "}
                        {member.requirements[requirement.id]}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          );
        })}
      </Card>

      <Card
        title={t("review.universities")}
        icon={<Building2 className="size-3.5" />}
        step={2}
        onEdit={goToStep}
      >
        {universityNames.length === 0 ? (
          <Row icon={<Building2 className="size-3.5" />} label={t("review.institutions")} value="—" />
        ) : (
          universityNames.map((name) => (
            <Row
              key={name}
              icon={<Building2 className="size-3.5" />}
              label={t("review.institution")}
              value={name}
            />
          ))
        )}
      </Card>

      <Card
        title={t("review.leaderContact")}
        icon={<Crown className="size-3.5" />}
        step={2}
        onEdit={goToStep}
      >
        <Row
          icon={<Crown className="size-3.5" />}
          label={t("review.leader")}
          value={leader?.fullName.trim() || "—"}
        />
        <Row
          icon={<Hash className="size-3.5" />}
          label={t("review.studentId")}
          value={leader?.studentId.trim() || "—"}
          mono
        />
        <Row
          icon={<Mail className="size-3.5" />}
          label={t("review.universityEmail")}
          value={leader?.email.trim() || "—"}
          mono
        />
        <Row
          icon={<MessageCircle className="size-3.5" />}
          label={t("review.discord")}
          value={leader?.discord.trim() || "—"}
          mono
        />
        <Row
          icon={<Phone className="size-3.5" />}
          label={t("review.phone")}
          value={
            leader
              ? (() => {
                  const normalised = normalisePhone(leader.phone);
                  return normalised ? formatPhone(normalised) : leader.phone.trim() || "—";
                })()
              : "—"
          }
          mono
        />
      </Card>

      <div className="panel-inset flex items-start gap-3 rounded-xl p-4">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="text-xs leading-relaxed text-ash">
          {t(game ? "review.declarationFull" : "review.declarationNoGameFull", {
            universities:
              universityNames.length === 1
                ? universityNames[0]
                : t("review.theUniversities"),
            game: game?.name ?? "",
            falseInfo: t("review.falseInfo"),
          })}
        </p>
      </div>

      {config.requireConsent && (
        <ConsentField
          checked={draft.consentGiven}
          onChange={(checked) => update("consentGiven", checked)}
          policyHref={policyHref(config.policyUrl, language)}
          /* The consent box is unticked until the captain reaches it, so its error
             must not fire the moment this step opens — that is the exact moment they
             first see the box. The message waits for a submit attempt. */
          error={revealed ? errors.consent : undefined}
          memberCount={draft.members.length}
        />
      )}

      {/* The second promise, alongside consent: the captain has read their game's
          rulebook and accepts the rules.

          Always asked for — the organisers want both ticks before an entry is
          accepted — but when the team's game has a rulebook, the box stays locked
          until *that* document has been read to the end. The tick, not the scrolling, is
          what is validated: whether a document reached its last page is not something the
          server can ever confirm, but the promise the captain made is worth recording and
          refusing without. */}
      <RulesField
        checked={draft.rulesAccepted}
        onChange={(checked) => update("rulesAccepted", checked)}
        gameId={draft.gameId}
        gameName={game?.name ?? ""}
        hasRulebook={Boolean(rulebooks[draft.gameId])}
        unlocked={gamesRead?.has(draft.gameId) ?? false}
        onOpenRulebook={onOpenRulebook}
        error={revealed ? errors.rules : undefined}
      />
    </div>
  );
}

/**
 * The rules acknowledgement: read the game's rulebook, accept the rules.
 *
 * The sentence names the team's own game and links to it, because each title has its
 * own rules — "I have read the rulebook" is ambiguous when there are four of them, and
 * a captain who is told to read the EA FC rules should land on those rather than on a
 * chooser.
 *
 * Three states:
 *
 * - **No rulebook for this game.** The box is tickable at once. The promise still
 *   stands, covering the rules themselves and the consequence of breaking one; asking
 *   a team to confirm they read a document that does not exist would be the dead end.
 * - **A rulebook exists but has not been shown.** The box is replaced by a prompt to
 *   open it. A team is then never in a position to assert they read something they
 *   were not shown.
 * - **Shown.** The sentence with the link, tickable.
 *
 * That locking is a nudge with teeth rather than a proof: nothing in a browser can
 * demonstrate a person read a page, and the console says so plainly rather than
 * implying otherwise.
 */
function RulesField({
  checked,
  onChange,
  gameId,
  gameName,
  hasRulebook,
  unlocked,
  onOpenRulebook,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  gameId: string;
  gameName: string;
  hasRulebook: boolean;
  /** True once this game's document has been scrolled to the end this session. */
  unlocked: boolean;
  onOpenRulebook?: (gameId: string) => void;
  error?: string;
}) {
  const { t } = useLanguage();

  const openHere = (event: React.MouseEvent) => {
    /* The link sits inside the label, so a plain click would also toggle the box —
       and navigating away from a half-finished form to read the rules, then finding
       the box you were about to tick has flipped, is exactly the sort of small
       betrayal that makes a form feel unreliable. */
    event.preventDefault();
    event.stopPropagation();
    if (gameId && onOpenRulebook) onOpenRulebook(gameId);
  };

  /* Naming the game needs a game. With none chosen yet there is nothing to point at,
     so the sentence drops the name rather than reading "I have read the  rulebook". */
  const label =
    gameName && hasRulebook
      ? t("rules.acceptWithRulebook", { game: gameName })
      : t("rules.acceptStandalone");

  /* The same sentence, with the placeholder *left in place* so the link can be spliced
     into it — the trick the consent line below already uses. Interpolating the game
     name here would leave `withLink` nothing to match on, and it would quietly fall
     back to the plain sentence: no link, no error, nothing to notice. */
  const linkedLabel = t("rules.acceptWithRulebook", { game: "{game}" });

  if (hasRulebook && !unlocked) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950/40 p-4">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-ash" />
        <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ash">
          {t("rules.mustOpen")}
        </span>
        {onOpenRulebook && gameId && (
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenRulebook(gameId)}>
            <BookOpen className="size-3.5" />
            {t("rules.readIt", { game: gameName })}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
          error
            ? "border-danger/50 bg-danger/8"
            : checked
              ? "border-brand/50 bg-brand/8"
              : "border-[rgba(148,196,208,0.18)] bg-wall-950/40 hover:border-brand/40",
        )}
      >
        <Checkbox checked={checked} onChange={onChange} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-snow">
            {hasRulebook && gameName && onOpenRulebook ? (
              /* `withLink` splits the translated sentence on the marker and drops the
                 link in, so the word order stays the translator's rather than being
                 pinned to English around an anchor. */
              withLink(linkedLabel, "{game}", (
                <a
                  href="#"
                  onClick={openHere}
                  className="text-brand underline underline-offset-2 hover:text-brand-bright"
                >
                  {gameName}
                </a>
              ))
            ) : (
              label
            )}
            <span className="text-brand">*</span>
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-ash">
            {t("rules.consequence")}
          </span>
        </span>
      </label>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The consent the organisers rely on.
 *
 * Deliberately **unticked** rather than pre-ticked: a pre-ticked box records a
 * decision nobody made, and is the specific thing data-protection rules object
 * to. The wording names both halves — accepting the notice, and confirming the
 * other members know their details are being shared — because the captain is
 * submitting on behalf of people who are not in the room.
 */
function ConsentField({
  checked,
  onChange,
  policyHref,
  error,
  memberCount,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  policyHref: string;
  error?: string;
  memberCount: number;
}) {
  const { t, language } = useLanguage();

  /* Arabic writes its own digits, so a count inside a sentence follows the script. */
  const count = language === "ar" ? arabicDigits(memberCount) : String(memberCount);

  const members =
    memberCount === 1
      ? t("review.consentMemberOne")
      : t("review.consentMemberMany", { count });

  return (
    <div className="space-y-2">
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
          error
            ? "border-danger/50 bg-danger/8"
            : checked
              ? "border-brand/50 bg-brand/8"
              : "border-[rgba(148,196,208,0.18)] bg-wall-950/40 hover:border-brand/40",
        )}
      >
        <Checkbox checked={checked} onChange={onChange} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-snow">
            {t("review.consentLabel")}
            <span className="text-brand">*</span>
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-ash">
            {/* The sentence is assembled from a template so the link and the member
                phrase can each be translated — hardcoding the English word order
                around a link is what left this paragraph English in Arabic.
                The member phrase is substituted first; `{link}` is passed through
                untouched so `withLink` can still find it. */}
            {withLink(t("review.consentBody", { members, link: "{link}" }), "{link}", (
              <a
                href={policyHref}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline underline-offset-2 hover:text-brand-bright"
              >
                {t("review.consentLink")}
              </a>
            ))}
          </span>
        </span>
      </label>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
