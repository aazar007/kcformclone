"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  CONTACT_EMAIL_MAX,
  DEFAULT_MAX_ROSTER,
  MAX_ROSTER_LIMIT,
  MAX_SOCIAL_LINKS,
  WATCH_LABEL_MAX,
  WATCH_URL_MAX,
  type TournamentConfig,
  type WatchLink,
} from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { DEFAULT_PRIVACY_NOTICE, DEFAULT_PRIVACY_NOTICE_AR, PRIVACY_NOTICE_ADVICE } from "@/lib/privacy-notice";
import { EmptyNote, Pill, SectionCard, Setting } from "./controls";
import { LogoControl } from "./logo-control";
import { socialLogoKey } from "@/lib/logo-keys";

export interface SectionProps {
  config: TournamentConfig;
  patch: <K extends keyof TournamentConfig>(key: K, value: TournamentConfig[K]) => void;
}

/**
 * One blocked term per line, with blank lines and duplicates dropped.
 *
 * Parsed here rather than stored as typed so the stored config is always a clean
 * list — otherwise a stray space would create a term that matches nothing, and an
 * empty line would create a term that matches everything.
 */
function parseBlockedTerms(raw: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    terms.push(trimmed);
  }
  return terms;
}

export function GeneralSection({
  config,
  patch,
  logoVersions = {},
  onLogoVersionsChange,
}: SectionProps & {
  /** Stored logo versions, keyed as the server keys them — social accounts are `social:<id>`. */
  logoVersions?: Record<string, number>;
  onLogoVersionsChange?: (versions: Record<string, number>) => void;
}) {
  const maxRoster = Number.isFinite(config.maxRoster) ? config.maxRoster : DEFAULT_MAX_ROSTER;

  const socialLinks = config.socialLinks ?? [];

  const setSocialLogoVersion = (linkId: string, version: number | undefined) => {
    if (!onLogoVersionsChange) return;
    const key = socialLogoKey(linkId);
    if (!key) return;
    const next = { ...logoVersions };
    if (version === undefined) delete next[key];
    else next[key] = version;
    onLogoVersionsChange(next);
  };

  /**
   * Social rows get an opaque id that never changes.
   *
   * Derived from the label, it would change under the text being typed and the row
   * would remount mid-keystroke — the same lesson the sponsor rows already recorded.
   */
  const blankSocial = (): WatchLink => {
    const taken = new Set(socialLinks.map((link) => link.id));
    let id = "";
    do {
      id = `social-${Math.random().toString(36).slice(2, 10)}`;
    } while (!id || taken.has(id));
    return { id, label: "", url: "" };
  };

  const updateSocial = (index: number, next: Partial<WatchLink>) => {
    patch(
      "socialLinks",
      socialLinks.map((link, i) => (i === index ? { ...link, ...next } : link)),
    );
  };

  const removeSocial = (index: number) => {
    patch(
      "socialLinks",
      socialLinks.filter((_, i) => i !== index),
    );
  };

  const addSocial = () => {
    if (socialLinks.length >= MAX_SOCIAL_LINKS) return;
    patch("socialLinks", [...socialLinks, blankSocial()]);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Identity"
        description="The name and tagline shown across the registration form, the page title and the confirmation screen."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Setting
            label="Tournament name"
            required
            maxLength={60}
            value={config.tournamentName}
            placeholder="e.g. KSU Crown"
            hint="The first word is rendered in brand cyan and the rest in chrome — two words look best."
            onChange={(value) => patch("tournamentName", value)}
          />
          <Setting
            label="Tagline"
            maxLength={90}
            value={config.tagline}
            placeholder="e.g. Esports Championship · Team Registration"
            hint="Shown under the wordmark, in small caps."
            onChange={(value) => patch("tagline", value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Registration window"
        description="Close the form without taking the site down — visitors see your message instead of the wizard."
      >
        <CheckboxField
          checked={config.registrationOpen}
          onChange={(checked) => patch("registrationOpen", checked)}
          label="Registration is open"
          hint="Turn this off once the entry window closes."
        />
        <div className="mt-4">
          <Setting
            label="Closed message"
            value={config.closedMessage}
            maxLength={240}
            disabled={config.registrationOpen}
            placeholder="Registration for this tournament is closed."
            hint="Shown on the public page while registration is closed."
            onChange={(value) => patch("closedMessage", value)}
          />
        </div>

        {/* Directly below the closed-registration settings it qualifies: this is about
            what happens *after* the switch above is turned off, so it belongs with the
            message rather than with the general settings.

            Enabled even while registration is open — an organiser deciding how the
            close will behave should be able to set it before they close the window. */}
        <div className="mt-4">
          <CheckboxField
            checked={config.allowOrganiserEntriesClosed}
            onChange={(checked) => patch("allowOrganiserEntriesClosed", checked)}
            label="Allow admins and staff to register while closed"
            hint="They reach the form through “View form” in this console. Turn this off to refuse everyone once the window closes, including signed-in organisers."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="After registration"
        description="What a team sees the moment their entry is accepted."
      >
        <Setting
          label="Discord invite link"
          maxLength={300}
          value={config.discordInviteUrl}
          placeholder="https://discord.gg/…"
          hint="Shown as a button on the success screen, once a team submits. Leave empty to hide it. Reissue it here whenever the invite expires — staff can change it too."
          onChange={(value) => patch("discordInviteUrl", value)}
        />
      </SectionCard>

      {/* **The footer's own settings.**
          The privacy link is not here on purpose: it opens the notice the consent box
          refers to, so it is a fixed route rather than something an organiser can point
          at a different page. Everything else in the footer is theirs to change. */}
      <SectionCard
        title="Footer"
        description="The links shown at the bottom of every page. Any signed-in organiser — staff included — can change them."
        action={
          <Pill tone={socialLinks.length >= MAX_SOCIAL_LINKS ? "warn" : "muted"}>
            {socialLinks.length}/{MAX_SOCIAL_LINKS}
          </Pill>
        }
      >
        <Setting
          label="Contact email"
          maxLength={CONTACT_EMAIL_MAX}
          value={config.contactEmail}
          placeholder="e.g. esports@ksu.edu.sa"
          hint="The footer's “Contact us” opens this address. Leave it empty and that link is hidden rather than opening an empty draft."
          onChange={(value) => patch("contactEmail", value)}
        />

        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.6875rem] font-bold tracking-[0.14em] text-ash uppercase">
              Social media
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addSocial}
              disabled={socialLinks.length >= MAX_SOCIAL_LINKS}
            >
              <Plus className="size-3.5" />
              Add account
            </Button>
          </div>

          {socialLinks.length === 0 ? (
            <EmptyNote>
              No accounts yet, so the footer shows no social row. Add the accounts you
              want a team to be able to find.
            </EmptyNote>
          ) : (
            <div className="space-y-3">
              {socialLinks.map((link, index) => (
                <div key={link.id} className="panel-inset rounded-xl p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[0.625rem] text-ash">{index + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-danger"
                      onClick={() => removeSocial(index)}
                      aria-label={`Remove ${link.label || "this account"}`}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-start gap-4">
                    <LogoControl
                      label={link.label || "Social account"}
                      uploadUrl={`/api/admin/social/${encodeURIComponent(link.id)}/logo`}
                      imageUrl={`/api/social/${encodeURIComponent(link.id)}/logo`}
                      version={logoVersions[socialLogoKey(link.id) ?? ""]}
                      onChange={(version) => setSocialLogoVersion(link.id, version)}
                    />
                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                      <Setting
                        label="Account"
                        required
                        maxLength={WATCH_LABEL_MAX}
                        value={link.label}
                        placeholder="e.g. Instagram"
                        hint="Used as the logo's accessible name and in this console — it is not printed in the footer."
                        onChange={(value) => updateSocial(index, { label: value })}
                      />
                      <Setting
                        label="Link"
                        required
                        maxLength={WATCH_URL_MAX}
                        value={link.url}
                        placeholder="https://instagram.com/…"
                        hint="Only http(s) links or a path on this site are kept."
                        onChange={(value) => updateSocial(index, { url: value })}
                      />
                    </div>
                  </div>
                  {!logoVersions[socialLogoKey(link.id) ?? ""] && (
                    <p className="mt-2 text-[0.625rem] leading-relaxed text-amber-200/90">
                      Upload a logo to show this account. Accounts without one are hidden from
                      the footer — the footer prints the logo alone, not the account name.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Roster"
        description="Applies to every game in the tournament."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Setting
            label="Maximum roster size"
            type="number"
            min={1}
            max={MAX_ROSTER_LIMIT}
            value={maxRoster}
            hint={`Players only — starters plus substitutes. Between 1 and ${MAX_ROSTER_LIMIT}. This is a ceiling: each game still uses its own bench allowance, so raising it never adds substitutes to a title that declares none.`}
            onChange={(value) => {
              const parsed = Number.parseInt(value, 10);
              patch("maxRoster", Number.isFinite(parsed) ? parsed : maxRoster);
            }}
          />
          <Setting
            label="Game tag label"
            maxLength={40}
            value={config.gameTagLabel}
            placeholder="Game tag"
            hint="Ask for a different handle — e.g. “Epic ID” or “Riot ID”."
            onChange={(value) => patch("gameTagLabel", value)}
          />
          <Setting
            label="Game tag help text"
            className="sm:col-span-2"
            maxLength={160}
            value={config.gameTagHint}
            placeholder="Your in-game handle exactly as it appears."
            hint="Shown under every game tag field on the roster step."
            onChange={(value) => patch("gameTagHint", value)}
          />
        </div>
      </SectionCard>

      {/* The typed way into the two organiser doors. Not a credential — both doors still
          ask for their own secret or code — so it is described as a route, not a key. */}
      <SectionCard
        title="Organiser entry names"
        description="Typing one of these as a team name opens that sign-in page instead of registering a team. It is only a shortcut: both pages still ask for their own secret or emailed code. Leave a field empty to switch it off."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Setting
            label="Grand admin entry name"
            maxLength={32}
            value={config.adminEntryName}
            placeholder="crown-admin"
            hint="Opens the grand admin sign-in."
            onChange={(value) => patch("adminEntryName", value)}
          />
          <Setting
            label="Staff entry name"
            maxLength={32}
            value={config.staffEntryName}
            placeholder="crown-staff"
            hint="Opens the staff sign-in."
            onChange={(value) => patch("staffEntryName", value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Names, conduct and privacy"
        description="What the form refuses to accept, and what a captain has to agree to before registering."
      >
        <div className="space-y-4">
          <CheckboxField
            checked={config.requireConsent}
            onChange={(checked) => patch("requireConsent", checked)}
            label="Require the captain to accept the privacy notice"
            hint="Adds an unticked box on the review step. Every registration then records the moment it was ticked, which is what lets you show consent was given."
          />

          <div className="rounded-xl border border-[rgba(79, 182, 208,0.18)] bg-wall-950/40 p-4">
            <p className="text-xs leading-relaxed text-ash">
              A built-in list covers profanity, sexual content, hate speech, targeted insults,
              self-harm references and blasphemy — in English, Arabic script and Franco-Arab. It
              applies to team names, member names and game tags, and it sees through the usual
              disguises: <span className="font-mono">sh1t</span>,{" "}
              <span className="font-mono">$hit</span>,{" "}
              <span className="font-mono">s.h.i.t</span>,{" "}
              <span className="font-mono">s h i t</span>,{" "}
              <span className="font-mono">f*ck</span>, repeated letters, zero-width spaces and
              Cyrillic lookalikes.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ash/70">
              Severe terms (hate speech, sexual content, self-harm, targeted slurs) <strong className="font-bold text-ash">block</strong> the
              registration. Mild ones (<span className="font-mono">crap</span>,{" "}
              <span className="font-mono">idiot</span>, <span className="font-mono">loser</span>)
              are <strong className="font-bold text-ash">accepted but flagged</strong>, so you see
              them before the bracket is published rather than the captain being refused.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ash/70">
              The list deliberately errs towards letting things through, because refusing an
              innocent name turns a real student away —{" "}
              <span className="font-mono">Dickenson</span>,{" "}
              <span className="font-mono">Scunthorpe</span> and{" "}
              <span className="font-mono">X-Force</span> are all allowed. Add your own terms below
              if something slips past.
            </p>
          </div>

          <Field
            label="Additional blocked terms"
            hint="One per line. Matched whole-word and case-insensitively, so “rivals” blocks “Team Rivals” but not “Rivalship”."
          >
            <textarea
              value={config.blockedTerms.join("\n")}
              rows={5}
              spellCheck={false}
              placeholder={"e.g.\nrivals\nbannedword"}
              onChange={(event) => patch("blockedTerms", parseBlockedTerms(event.target.value))}
              className="w-full rounded-lg border border-[rgba(79, 182, 208,0.18)] bg-wall-950/60 px-3.5 py-2.5 font-mono text-[0.8125rem] text-snow transition-all placeholder:text-ash/55 focus-visible:border-brand/70 focus-visible:ring-2 focus-visible:ring-brand/25 focus-visible:outline-none"
            />
          </Field>

          <Setting
            label="Privacy notice link"
            maxLength={120}
            value={config.policyUrl}
            placeholder="/privacy"
            hint="Where the review step's consent box points. The notice below is shown at this address; change it only if you host your own page elsewhere."
            onChange={(value) => patch("policyUrl", value)}
          />

          <Field
            label="Privacy notice — English"
            hint="Shown at /privacy in English, and linked from the consent box on the review step. Start a section with ##, write one paragraph per line, use **bold**, and {{tournament}} for the tournament name."
          >
            <textarea
              value={config.privacyNoticeEn}
              rows={14}
              spellCheck={false}
              onChange={(event) => patch("privacyNoticeEn", event.target.value)}
              className="w-full rounded-lg border border-[rgba(79, 182, 208,0.18)] bg-wall-950/60 px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed text-snow transition-all placeholder:text-ash/55 focus-visible:border-brand/70 focus-visible:ring-2 focus-visible:ring-brand/25 focus-visible:outline-none"
            />
          </Field>

          <Field
            label="Privacy notice — Arabic"
            hint="The same notice in Arabic, shown when a student is using the form in Arabic. Edit them separately: changing one never overwrites the other, because a notice often needs wording that only suits one language."
          >
            <textarea
              value={config.privacyNoticeAr}
              rows={14}
              /* Arabic script, right-to-left, so the box reads the way the text does. */
              dir="rtl"
              lang="ar"
              spellCheck={false}
              onChange={(event) => patch("privacyNoticeAr", event.target.value)}
              className="w-full rounded-lg border border-[rgba(79, 182, 208,0.18)] bg-wall-950/60 px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed text-snow transition-all placeholder:text-ash/55 focus-visible:border-brand/70 focus-visible:ring-2 focus-visible:ring-brand/25 focus-visible:outline-none"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(79, 182, 208,0.18)] bg-wall-950/40 p-3">
            <p className="min-w-0 flex-1 text-[0.6875rem] leading-relaxed text-ash">
              {PRIVACY_NOTICE_ADVICE} Clearing either box restores the built-in notice for that
              language rather than leaving entrants agreeing to a blank page.
            </p>
            <div className="flex gap-2">
              <a
                href="/privacy?lang=en"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[rgba(79, 182, 208,0.22)] px-2.5 py-1.5 text-[0.6875rem] font-bold tracking-wide text-ash transition-colors hover:border-brand/50 hover:text-brand"
              >
                Preview EN
              </a>
              <a
                href="/privacy?lang=ar"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[rgba(79, 182, 208,0.22)] px-2.5 py-1.5 text-[0.6875rem] font-bold tracking-wide text-ash transition-colors hover:border-brand/50 hover:text-brand"
              >
                Preview AR
              </a>
              <button
                type="button"
                onClick={() => {
                  patch("privacyNoticeEn", DEFAULT_PRIVACY_NOTICE);
                  patch("privacyNoticeAr", DEFAULT_PRIVACY_NOTICE_AR);
                }}
                className="rounded-lg border border-[rgba(79, 182, 208,0.22)] px-2.5 py-1.5 text-[0.6875rem] font-bold tracking-wide text-ash transition-colors hover:border-brand/50 hover:text-brand"
              >
                Reset both
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
