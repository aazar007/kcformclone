"use client";

import * as React from "react";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  Crown,
  Download,
  Gamepad2,
  Hash,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
  ExternalLink,
} from "lucide-react";
import { cn, formatPhone, normalisePhone } from "@/lib/utils";
import { GENDER_LABEL, MEMBER_ROLE_LABEL, isGender, isMemberRole } from "@/lib/games";
import type { TournamentConfig } from "@/lib/tournament";
import { plainText } from "@/lib/sheet-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RolePill } from "@/components/ui/field";
import { TeamEditor, type EditableTeam } from "./team-editor";
import { EmptyNote, Pill, SectionCard } from "./controls";

/** The `requirements` JSON column, as it actually arrives over the wire. */
type StoredAnswer = { id?: unknown; label?: unknown; value?: unknown };

/** Aliases, so the read-only view and the editor speak about the same things. */
type TeamRow = EditableTeam;
type MemberRow = EditableTeam["members"][number];

function answersOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry): { label: string; value: string }[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const answer = entry as StoredAnswer;
      const label = typeof answer.label === "string" ? answer.label : "";
      const text = answer.value === null || answer.value === undefined ? "" : String(answer.value);
      return text ? [{ label, value: text }] : [];
    });
}

function quote(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * One CSV cell: formula-defused, then quoted.
 *
 * Quoting alone is not enough. CSV quoting is *syntax* — it tells the parser where a field
 * ends — and it says nothing about what the field means. Excel and Google Sheets still treat
 * the contents of a quoted field as a formula when it begins with `=`, `+`, `-` or `@`.
 *
 * So a player could put `=cmd|' /C calc'!A0` in their game tag — `gameTagPolicyError` accepts
 * it, unlike a person's name — and the organiser's CSV export would carry it straight into
 * whatever they opened it with. That is the whole point of the attack: the payload runs on
 * the organiser's machine, not the server's.
 *
 * `plainText` prefixes a leading apostrophe, which spreadsheets read as "this is text" and
 * do not display. The Sheets export has always done this; the CSV path was missing it.
 */
function cell(value: string) {
  return quote(plainText(value));
}

function formatDate(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

/**
 * Every registration, summarised as one line per team.
 *
 * The console used to render a flat table with one row per player, which meant a
 * five-person squad was five rows that had to be read together to mean anything.
 * Grouping by team makes the unit of the competition the unit of the display: a
 * summary you can scan, which expands into the people behind it.
 */
export function RegistrationsSection({
  secret,
  config,
  sheetUrl = null,
}: {
  secret: string;
  /** Needed by the editor: games, divisions, universities and requirements. */
  config: TournamentConfig;
  /**
   * The spreadsheet's own address, or null when it is not configured.
   *
   * Displayed here rather than on the public form on purpose: the sheet holds every
   * player's email, student ID and phone number, so a link to it belongs behind the
   * console's sign-in — and this section is where the export that writes to it lives.
   */
  sheetUrl?: string | null;
}) {
  const [teams, setTeams] = React.useState<TeamRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  /** The id of the team currently open in the editor, if any. */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [exportNotice, setExportNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/registrations", {
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not read registrations.");
        setTeams(null);
        return;
      }

      setTeams(Array.isArray(payload.teams) ? (payload.teams as TeamRow[]) : []);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [secret]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const players = React.useMemo(
    () => (teams ?? []).reduce((total, team) => total + team.members.length, 0),
    [teams],
  );

  /** Search across the whole team, so "ksu.edu.sa" finds a squad by any member. */
  const filtered = React.useMemo(() => {
    if (!teams) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return teams;

    return teams.filter((team) =>
      [
        team.teamName,
        team.reference,
        team.gameName,
        team.gender,
        ...team.members.flatMap((member) => [
          member.fullName,
          member.email,
          member.gameTag,
          member.universityName,
          member.studentId ?? "",
          member.discord,
          member.phone,
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [teams, query]);

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const header = [
      "Reference",
      "Team Name",
      "Division",
      "Game",
      "Role",
      "Player #",
      "Player Name",
      "Game Tag",
      "University",
      "Region",
      "Email",
      "Student ID",
      "Discord",
      "Phone",
      "Is Leader",
      "Submitted At",
    ];

    const lines = [header.map(cell).join(",")];

    for (const team of filtered) {
      team.members.forEach((member, index) => {
        lines.push(
          [
            team.reference,
            team.teamName,
            isGender(team.gender) ? GENDER_LABEL[team.gender] : team.gender,
            team.gameName,
            isMemberRole(member.role) ? MEMBER_ROLE_LABEL[member.role] : member.role,
            String(index + 1),
            member.fullName,
            member.gameTag,
            member.universityName,
            member.universityRegion,
            member.email,
            member.studentId ?? "",
            member.discord,
            member.phone,
            index === team.leaderIndex ? "Yes" : "No",
            formatDate(team.createdAt),
          ]
            .map(cell)
            .join(","),
        );
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportToSheet = async () => {
    setExporting(true);
    setExportNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/export/sheets", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Export failed.");
        return;
      }

      const appended = typeof payload.appended === "number" ? payload.appended : 0;
      const skipped = typeof payload.skipped === "number" ? payload.skipped : 0;
      setExportNotice(
        appended === 0
          ? `Nothing new to export — all ${skipped} rows are already in the sheet.`
          : `Added ${appended} row${appended === 1 ? "" : "s"}${skipped > 0 ? `, skipped ${skipped} already there` : ""}.`,
      );
    } catch {
      setError("We could not reach the server.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <SectionCard
      title="Registrations"
      description="One line per team. Open a team to see its full roster, contacts and answers."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="muted">{(teams ?? []).length} teams</Pill>
          <Pill tone="muted">{players} people</Pill>
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void exportToSheet()}
            disabled={exporting || (teams ?? []).length === 0}
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Push to Sheet
          </Button>
          {/* Only when SHEET_URL is configured — the app cannot know the spreadsheet's
              address from the webhook URL, so an absent setting means no link rather than
              a guess. */}
          {sheetUrl && (
            <Button asChild size="sm" variant="ghost">
              <a href={sheetUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Open the sheet
              </a>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-danger/45 bg-danger/10 p-3">
          <p className="flex items-start gap-2 text-xs text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        </div>
      )}

      {exportNotice && (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2 text-[11px] text-brand">
          <span>{exportNotice}</span>
          {/* Straight through to the rows that were just written, so "did it work?" is one
              click rather than a hunt for the spreadsheet. */}
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              Open the sheet
              <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      )}

      {notice && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2 text-[11px] text-brand">
          <Check className="mt-px size-3.5 shrink-0" />
          {notice}
        </p>
      )}

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ash" />
        <Input
          value={query}
          placeholder="Search teams, players, universities, references…"
          onChange={(event) => setQuery(event.target.value)}
          className="pl-10"
        />
      </div>

      {loading && teams === null ? (
        <p className="flex items-center gap-2 text-xs text-ash">
          <Loader2 className="size-3.5 animate-spin" />
          Reading registrations…
        </p>
      ) : teams === null ? (
        <EmptyNote>Nothing loaded yet.</EmptyNote>
      ) : filtered.length === 0 ? (
        <EmptyNote>
          {teams.length === 0
            ? "No registrations yet."
            : "No team matches that search."}
        </EmptyNote>
      ) : (
        <div className="space-y-2">
          {filtered.map((team) => (
            <TeamRowView
              key={team.id}
              team={team}
              open={open.has(team.id)}
              editing={editing === team.id}
              secret={secret}
              config={config}
              onToggle={() => toggle(team.id)}
              onEdit={() => {
                setEditing(team.id);
                setNotice(null);
                setOpen((current) => new Set(current).add(team.id));
              }}
              onCancelEdit={() => setEditing(null)}
              onSaved={(updated, warnings) => {
                setTeams((current) =>
                  (current ?? []).map((entry) =>
                    entry.id === updated.id ? updated : entry,
                  ),
                );
                setEditing(null);
                setNotice(
                  warnings.length > 0
                    ? `Saved ${updated.teamName}. Note: ${warnings.join(" ")}`
                    : `Saved ${updated.teamName}.`,
                );
              }}
              onDeleted={(reference) => {
                setTeams((current) => (current ?? []).filter((entry) => entry.id !== team.id));
                setEditing(null);
                setNotice(`Removed ${reference} and its roster.`);
              }}
            />
          ))}
        </div>
      )}

      {teams !== null && filtered.length > 0 && filtered.length !== teams.length && (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-ash">
          <Users className="size-3" />
          Showing {filtered.length} of {teams.length} teams.
        </p>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* One collapsible team                                                */
/* ------------------------------------------------------------------ */

function TeamRowView({
  team,
  open,
  editing,
  secret,
  config,
  onToggle,
  onEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
}: {
  team: TeamRow;
  open: boolean;
  editing: boolean;
  secret: string;
  config: TournamentConfig;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (team: EditableTeam, warnings: string[]) => void;
  onDeleted: (reference: string) => void;
}) {
  const starters = team.members.filter((member) => member.role === "STARTER").length;
  const substitutes = team.members.filter((member) => member.role === "SUBSTITUTE").length;
  const coaches = team.members.filter((member) => member.role === "COACH").length;

  const composition = [
    `${starters} starter${starters === 1 ? "" : "s"}`,
    substitutes > 0 ? `${substitutes} sub${substitutes === 1 ? "" : "s"}` : null,
    coaches > 0 ? `${coaches} coach${coaches === 1 ? "" : "es"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        editing
          ? "border-brand/60 bg-wall-950/70"
          : open
            ? "border-brand/40 bg-wall-950/60"
            : "border-[rgba(148,196,208,0.14)] bg-wall-950/40",
      )}
    >
      {/* The header is a button so the whole row toggles. The edit action sits
          outside it — nesting a button inside a button is invalid HTML and
          behaves unpredictably. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-wall-800/40"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-ash transition-transform",
              open && "rotate-180 text-brand",
            )}
          />

          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-bold", open ? "text-brand" : "text-snow")}>
              {team.teamName}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ash">
            <span>{team.reference}</span>
            <span className="text-ash/40">·</span>
            <span>{team.gameName}</span>
            <span className="text-ash/40">·</span>
            <span>{isGender(team.gender) ? GENDER_LABEL[team.gender] : team.gender}</span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 text-[10px] text-ash">
          <span className="rounded-full border border-[rgba(148,196,208,0.22)] px-2 py-0.5">
            {team.members.length} people
          </span>
          <span className="hidden sm:inline">{composition}</span>
        </span>
        </button>

        {!editing && (
          <button
            type="button"
            onClick={onEdit}
            className="flex shrink-0 items-center gap-1.5 border-l border-[rgba(148,196,208,0.12)] px-3.5 text-[11px] font-bold tracking-wide text-ash uppercase transition-colors hover:bg-brand/10 hover:text-brand"
          >
            <Pencil className="size-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        )}
      </div>

      {open && editing && (
        <TeamEditor
          team={team}
          config={config}
          secret={secret}
          onCancel={onCancelEdit}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}

      {open && !editing && (
        <div className="animate-rise border-t border-[rgba(148,196,208,0.12)] px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ash">
            <span className="flex items-center gap-1.5">
              <Gamepad2 className="size-3" />
              {team.gameName}
            </span>
            <span className="flex items-center gap-1.5" title={formatDate(team.createdAt)}>
              Submitted {formatDate(team.createdAt)}
            </span>
            {team.updatedAt !== team.createdAt && (
              <span className="text-brand">Edited {formatDate(team.updatedAt)}</span>
            )}
          </div>

          <div className="space-y-2">
            {team.members.map((member, index) => (
              <MemberCard
                key={member.id ?? index}
                member={member}
                index={index}
                isLeader={index === team.leaderIndex}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MemberCard({
  member,
  index,
  isLeader,
}: {
  member: MemberRow;
  index: number;
  isLeader: boolean;
}) {
  const role = isMemberRole(member.role) ? member.role : "STARTER";
  const phone = normalisePhone(member.phone);
  const answers = answersOf(member.requirements);

  return (
    <div
      className={cn(
        "panel-inset rounded-xl p-3",
        isLeader && "border-brand/35 bg-brand/6",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-lg font-mono text-[10px]",
            isLeader ? "bg-brand text-wall-950" : "bg-wall-700 text-ash",
          )}
        >
          {index + 1}
        </span>
        <span className="text-xs font-semibold text-snow">{member.fullName || "—"}</span>
        {isLeader && <Crown className="size-3.5 shrink-0 text-brand" />}
        <RolePill role={role} />
        {member.gameTag && (
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10px] text-brand">
            {member.gameTag}
          </span>
        )}
      </div>

      <dl className="mt-2 grid gap-x-4 gap-y-1.5 pl-9 sm:grid-cols-2">
        <Detail icon={<Building2 className="size-3" />} label="University">
          {member.universityName || "—"}
          {member.universityRegion && (
            <span className="ml-1.5 text-ash">{member.universityRegion}</span>
          )}
        </Detail>
        <Detail icon={<Mail className="size-3" />} label="Email" mono>
          {member.email || "—"}
        </Detail>
        <Detail icon={<Hash className="size-3" />} label="Student ID" mono>
          {member.studentId || "—"}
        </Detail>
        <Detail icon={<MessageCircle className="size-3" />} label="Discord" mono>
          {member.discord || "—"}
        </Detail>
        <Detail icon={<Phone className="size-3" />} label="Phone" mono>
          {phone ? formatPhone(phone) : member.phone || "—"}
        </Detail>
        {answers.map((answer) => (
          <Detail key={answer.label} icon={<Gamepad2 className="size-3" />} label={answer.label}>
            {answer.value}
          </Detail>
        ))}
      </dl>
    </div>
  );
}

function Detail({
  icon,
  label,
  mono,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-ash">{icon}</span>
      <dt className="sr-only">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-words text-[11px] text-snow", mono && "font-mono text-[11px] text-ash")}>
        <span className="mr-1.5 text-ash/60">{label}:</span>
        {children}
      </dd>
    </div>
  );
}
