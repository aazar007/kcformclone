"use client";

import * as React from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import {
  MAX_WATCH_LINKS,
  WATCH_LABEL_MAX,
  WATCH_URL_MAX,
  type WatchLink,
} from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { EmptyNote, Pill, SectionCard, Setting } from "./controls";
import type { SectionProps } from "./general-section";
import { LogoControl } from "./logo-control";

/**
 * The live tournament announcement.
 *
 * Two things are configured here and nothing else: whether the tournament is being
 * played, and where a visitor can watch it. The notice itself appears on the landing
 * page — the page that announces the tournament — and never inside the registration
 * form, whose steps are about filling in answers rather than following a stream.
 *
 * `tournamentLive` is separate from the registration switch on purpose. The usual
 * sequence is "registration closes, tournament goes live", but they are different
 * facts and the organisers may publish the stream before entries close.
 */
export function LiveSection({
  config,
  patch,
  logoVersions = {},
  onLogoVersionsChange,
}: SectionProps & {
  /**
   * Which stored logos exist, keyed as the server keys them — channel logos are
   * `channel:<id>`, alongside the sponsors' plain ids in the same map.
   */
  logoVersions?: Record<string, number>;
  onLogoVersionsChange?: (versions: Record<string, number>) => void;
}) {
  const links = config.watchLinks;

  const setLogoVersion = (linkId: string, version: number | undefined) => {
    if (!onLogoVersionsChange) return;
    const key = `channel:${linkId}`;
    const next = { ...logoVersions };
    if (version === undefined) delete next[key];
    else next[key] = version;
    onLogoVersionsChange(next);
  };

  /**
   * A row gets an opaque id that never changes.
   *
   * Sponsor rows learned this the hard way: an id derived from a field that is being
   * typed changes under the value, and anything keyed by it detaches. Nothing is
   * keyed by a watch link's id today, but a stable key costs nothing and keeps a
   * removal from renumbering the row a person is editing.
   */
  const blank = (): WatchLink => {
    const taken = new Set(links.map((link) => link.id));
    let id = "";
    do {
      id = `watch-${Math.random().toString(36).slice(2, 10)}`;
    } while (!id || taken.has(id));
    return { id, label: "", url: "" };
  };

  const update = (index: number, next: Partial<WatchLink>) => {
    patch(
      "watchLinks",
      links.map((link, i) => (i === index ? { ...link, ...next } : link)),
    );
  };

  const remove = (index: number) => {
    patch(
      "watchLinks",
      links.filter((_, i) => i !== index),
    );
  };

  const add = () => {
    if (links.length >= MAX_WATCH_LINKS) return;
    patch("watchLinks", [...links, blank()]);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Tournament is live"
        description="Announces that the tournament is being played, with the channels to watch it on. Shown on the landing page only — not inside the registration form — and independent of whether registration is open."
      >
        <CheckboxField
          checked={config.tournamentLive}
          onChange={(checked) => patch("tournamentLive", checked)}
          label="Show the live notice on the landing page"
          hint="Turn this on when play starts. It stays on until you switch it off, so remember to close it after the final."
        />

        {/* Said plainly rather than discovered on the live site: a notice with no
            buttons tells a visitor the tournament is live and then gives them nowhere
            to go. The landing page still renders it (the message is useful on its own),
            so this is advice, not a block. */}
        {config.tournamentLive && config.watchLinks.length === 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-amber-100/90">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-300" />
            <span>
              The notice is on, but no channel has been added — visitors will see the
              announcement with no button to watch. Add at least one below.
            </span>
          </p>
        )}

        <div className="mt-4">
          <Setting
            label="Live message"
            value={config.liveMessage}
            maxLength={240}
            disabled={!config.tournamentLive}
            placeholder="Tournament is live — watch us on our official channels."
            hint="Leave empty to use the built-in wording, which is translated for Arabic visitors. Your own text is shown exactly as written in both languages."
            onChange={(value) => patch("liveMessage", value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Where to watch"
        description="One button per channel, shown under the live notice. The label is the app as you would write it — Twitch, YouTube, Kick — and the link is where it opens. Add a logo to show it on the button instead of the play icon."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={links.length >= MAX_WATCH_LINKS ? "warn" : "muted"}>
              {links.length}/{MAX_WATCH_LINKS}
            </Pill>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={add}
              disabled={links.length >= MAX_WATCH_LINKS}
            >
              <Plus className="size-3.5" />
              Add channel
            </Button>
          </div>
        }
      >
        {links.length === 0 ? (
          <EmptyNote>
            No channels yet. The live notice still appears, but without any watch
            buttons — add at least one so visitors know where to go.
          </EmptyNote>
        ) : (
          <div className="space-y-3">
            {links.map((link, index) => (
              <div key={link.id} className="panel-inset rounded-xl p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.625rem] text-ash" title={link.id}>
                    {index + 1}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-danger"
                    onClick={() => remove(index)}
                    aria-label={`Remove ${link.label || "this channel"}`}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>

                <div className="flex flex-wrap items-start gap-4">
                  <LogoControl
                    label={link.label || "Channel"}
                    uploadUrl={`/api/admin/channels/${encodeURIComponent(link.id)}/logo`}
                    imageUrl={`/api/channels/${encodeURIComponent(link.id)}/logo`}
                    version={logoVersions[`channel:${link.id}`]}
                    onChange={(version) => setLogoVersion(link.id, version)}
                  />
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                  <Setting
                    label="App"
                    required
                    maxLength={WATCH_LABEL_MAX}
                    value={link.label}
                    placeholder="e.g. Twitch"
                    hint="The name printed on the button."
                    onChange={(value) => update(index, { label: value })}
                  />
                  <Setting
                    label="Link"
                    required
                    maxLength={WATCH_URL_MAX}
                    value={link.url}
                    placeholder="https://twitch.tv/…"
                    hint="Only http(s) links or a path on this site are kept."
                    onChange={(value) => update(index, { url: value })}
                  />
                </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
