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
  PencilLine,
  Phone,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
  ExternalLink,
  Ban,
} from "lucide-react";
import { cn, formatPhone, normalisePhone } from "@/lib/utils";
import { GENDER_LABEL, MEMBER_ROLE_LABEL, isGender, isMemberRole } from "@/lib/games";
import type { TournamentConfig } from "@/lib/tournament";
import { plainText } from "@/lib/sheet-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RolePill } from "@/components/ui/field";
import type { EditableTeam } from "./team-editor";
import { TeamEditor } from "./team-editor";
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
  /**
   * The tournament settings, needed by the editor.
   *
   * The roster rules, the game list and the organiser-defined requirements all live here,
   * and an editor without them could not tell an organiser that a squad is one starter
   * short or offer the right games.
   */
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
  /**
   * The team currently open in the editor, if any.
   *
   * One at a time, deliberately: two half-filled editors on screen invite saving the
   * wrong squad's changes over the right one, and there is no undo.
   */
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

  /** Patch one team in place, so a ban or a resend is reflected without a reload. */
  const patchTeam = React.useCallback((id: string, patch: Partial<TeamRow>) => {
    setTeams((current) =>
      (current ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

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
      "Email Status",
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
            member.emailConfirmedAt ? "Confirmed" : "Pending",
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
        <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2 text-[0.6875rem] text-brand">
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
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2 text-[0.6875rem] text-brand">
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
              config={config}
              secret={secret}
              open={open.has(team.id)}
              editing={editing === team.id}
              onToggle={() => {
                /* Closing a row while editing would throw away unsaved changes without
                   asking, so the editor closes with it. */
                if (editing === team.id) setEditing(null);
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(team.id)) next.delete(team.id);
                  else next.add(team.id);
                  return next;
                });
              }}
              onEdit={() => {
                setEditing(team.id);
                /* Editing needs the roster in front of them, so the row opens too. */
                setOpen((current) => new Set(current).add(team.id));
                setNotice(null);
              }}
              onCancel={() => setEditing(null)}
              onSaved={(saved, warnings) => {
                setTeams((current) =>
                  (current ?? []).map((entry) =>
                    entry.id === saved.id ? { ...entry, ...saved } : entry,
                  ),
                );
                setEditing(null);
                /* The server reports roster problems as warnings rather than refusing the
                   save — an organiser part-way through rebuilding a squad has to be able to
                   save. They are surfaced here so the fix is not left to be discovered later. */
                setNotice(
                  warnings.length > 0
                    ? `${saved.reference} saved, with ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to check: ${warnings.join(" ")}`
                    : `${saved.reference} saved.`,
                );
              }}
              onDeleted={(reference) => {
                /* Drop it locally rather than re-reading the whole list: the server has
                   already told us which reference went, so a round trip would only add a
                   flicker between the press and the row leaving. */
                setTeams((current) => (current ?? []).filter((entry) => entry.reference !== reference));
                setOpen((current) => {
                  const next = new Set(current);
                  next.delete(team.id);
                  return next;
                });
                setNotice(
                  `${reference} was deleted, along with its whole roster. That cannot be undone.`,
                );
              }}
              onChanged={patchTeam}
            />
          ))}
        </div>
      )}

      {teams !== null && filtered.length > 0 && filtered.length !== teams.length && (
        <p className="mt-3 flex items-center gap-2 text-[0.6875rem] text-ash">
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
  config,
  secret,
  open,
  editing,
  onToggle,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  onChanged,
}: {
  team: TeamRow;
  config: TournamentConfig;
  secret: string;
  open: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (team: EditableTeam, warnings: string[]) => void;
  /** Reported upward after the server confirms, so the row can leave the list. */
  onDeleted: (reference: string) => void;
  /** Patch this team in place after a ban, unban or resend. */
  onChanged: (id: string, patch: Partial<TeamRow>) => void;
}) {
  const starters = team.members.filter((member) => member.role === "STARTER").length;
  const substitutes = team.members.filter((member) => member.role === "SUBSTITUTE").length;
  const coaches = team.members.filter((member) => member.role === "COACH").length;
  /* Non-leaders whose address has not been confirmed from their emailed link yet. */
  const pendingEmails = team.members.filter(
    (member, index) => index !== team.leaderIndex && member.email && !member.emailConfirmedAt,
  ).length;
  /**
   * Deleting a registration is irreversible, so it takes two presses.
   *
   * The action used to live only inside `TeamEditor`, and vanished when the editor was
   * unmounted. It now belongs to the row: one irreversible action, in one place, available
   * whether or not the editor is open.
   */
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  /* A ban is reversible, so it does not take the two-press confirmation deleting
     does. The checkbox itself is the state; the label says what it will do. */
  const banned = Boolean(team.bannedAt);
  const [banBusy, setBanBusy] = React.useState(false);
  const [banError, setBanError] = React.useState<string | null>(null);

  const [resendingAll, setResendingAll] = React.useState(false);
  const [resendNotice, setResendNotice] = React.useState<string | null>(null);

  /** Re-send the completion link to every teammate at once. */
  const resendAll = async () => {
    setResendingAll(true);
    setResendNotice(null);
    setBanError(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(team.id)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        setBanError(typeof payload.error === "string" ? payload.error : "Could not send those emails.");
        return;
      }
      const sent = typeof payload.sent === "number" ? payload.sent : 0;
      const total = typeof payload.total === "number" ? payload.total : sent;
      setResendNotice(
        sent === total
          ? `Completion links sent to ${sent} ${sent === 1 ? "player" : "players"}.`
          : `${sent} of ${total} completion links were sent — check the console for the rest.`,
      );
    } catch {
      setBanError("We could not reach the server.");
    } finally {
      setResendingAll(false);
    }
  };

  const setTeamBanned = async (next: boolean) => {
    setBanBusy(true);
    setBanError(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(team.id)}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "team", banned: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setBanError(typeof payload.error === "string" ? payload.error : "Could not change that ban.");
        return;
      }

      onChanged(team.id, { bannedAt: next ? new Date().toISOString() : null });
    } catch {
      setBanError("We could not reach the server.");
    } finally {
      setBanBusy(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(team.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setDeleteError(
          typeof payload.error === "string" ? payload.error : "Could not remove that registration.",
        );
        return;
      }

      onDeleted(typeof payload.reference === "string" ? payload.reference : team.reference);
    } catch {
      setDeleteError("We could not reach the server.");
    } finally {
      setDeleting(false);
    }
  };

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
        open
          ? "border-brand/40 bg-wall-950/60"
          : "border-[rgba(79, 182, 208,0.14)] bg-wall-950/40",
      )}
    >
      {/* The header is a button so the whole row toggles. */}
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
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.625rem] text-ash">
            <span>{team.reference}</span>
            <span className="text-ash/40">·</span>
            <span>{team.gameName}</span>
            <span className="text-ash/40">·</span>
            <span>{isGender(team.gender) ? GENDER_LABEL[team.gender] : team.gender}</span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 text-[0.625rem] text-ash">
          <span className="rounded-full border border-[rgba(79, 182, 208,0.22)] px-2 py-0.5">
            {team.members.length} people
          </span>
          {banned && (
            <span className="inline-flex items-center gap-1 rounded-full border border-danger/45 bg-danger/10 px-2 py-0.5 font-semibold text-danger">
              <Ban className="size-2.5" />
              Suspended
            </span>
          )}
          {pendingEmails > 0 && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">
              {pendingEmails} pending
            </span>
          )}
          <span className="hidden sm:inline">{composition}</span>
        </span>
        </button>

        {/* A sibling of the toggle, not a child of it: the header is itself a button, and
            a button inside a button is invalid HTML that browsers resolve unpredictably —
            the inner one usually swallowing the outer one's click. */}
        <button
          type="button"
          onClick={() => {
            setConfirmDelete((current) => !current);
            setDeleteError(null);
          }}
          aria-label={`Delete ${team.reference}`}
          aria-expanded={confirmDelete}
          className={cn(
            "flex shrink-0 items-center px-3 transition-colors",
            confirmDelete
              ? "bg-danger/10 text-danger"
              : "text-ash/70 hover:bg-danger/10 hover:text-danger",
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* The confirmation sits between the header and the roster, where the eye already is,
          and names what will actually be lost rather than asking "are you sure?" about a
          number the organiser has to look up. */}
      {confirmDelete && (
        <div className="flex flex-wrap items-center gap-2 border-t border-danger/35 bg-danger/8 px-4 py-2.5">
          <span className="text-[0.6875rem] text-danger">
            Delete{" "}
            <span className="font-mono font-bold">{team.reference}</span> and all{" "}
            {team.members.length} {team.members.length === 1 ? "member" : "members"}? This
            cannot be undone.
          </span>
          <span className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              className="h-7 px-2 text-[0.6875rem]"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              Yes, delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[0.6875rem]"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              Keep
            </Button>
          </span>
          {deleteError && <p className="w-full text-[0.6875rem] text-danger">{deleteError}</p>}
        </div>
      )}

      {open && (
        <div className="animate-rise border-t border-[rgba(79, 182, 208,0.12)] px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.6875rem] text-ash">
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
            {/* Editing is available to any signed-in organiser — staff and the grand admin
                alike — because the API's guard is `isAdminRequest`, the same one that lets
                them read this list. Correcting a typo or a mistyped student number is
                exactly the work staff access exists for. */}
            {!editing && (
              <span className="ms-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void resendAll()}
                  disabled={resendingAll || banned}
                  className="flex items-center gap-1 rounded-lg border border-[rgba(79, 182, 208,0.25)] px-2 py-1 text-[0.6875rem] text-ash transition-colors hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resendingAll ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  Resend to players
                </button>
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex items-center gap-1 rounded-lg border border-[rgba(79, 182, 208,0.25)] px-2 py-1 text-[0.6875rem] text-ash transition-colors hover:border-brand/50 hover:text-brand"
                >
                  <PencilLine className="size-3" />
                  Edit team
                </button>
              </span>
            )}
          </div>

          {/* Ban is a checkbox because it is reversible and reads as a state, not an
              action. Nothing is deleted: the entry stays readable, and lifting the
              tick restores it exactly as it was. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-[0.6875rem] text-ash">
              <Checkbox
                checked={banned}
                disabled={banBusy}
                onChange={(checked) => void setTeamBanned(checked)}
              />
              <Ban className="size-3 text-danger" />
              Ban this team
            </label>
            <span className="text-[0.625rem] text-ash/70">
              Suspended teams cannot be edited by their captain, and none of their members
              can register again.
            </span>
            {banned && team.bannedAt && (
              <span className="ms-auto rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[0.625rem] font-semibold text-danger">
                Suspended {formatDate(team.bannedAt)}
              </span>
            )}
            {banBusy && <Loader2 className="size-3 animate-spin text-ash" />}
            {resendNotice && (
              <p className="w-full text-[0.6875rem] text-brand">{resendNotice}</p>
            )}
            {banError && <p className="w-full text-[0.6875rem] text-danger">{banError}</p>}
          </div>

          {editing ? (
            <TeamEditor
              team={team}
              config={config}
              secret={secret}
              onCancel={onCancel}
              onSaved={onSaved}
            />
          ) : (
            <div className="space-y-2">
              {team.members.map((member, index) => (
                <MemberCard
                  key={member.id ?? index}
                  teamId={team.id}
                  member={member}
                  index={index}
                  isLeader={index === team.leaderIndex}
                  onBanChanged={(memberId, bannedAt) =>
                    onChanged(team.id, {
                      members: team.members.map((entry) =>
                        entry.id === memberId ? { ...entry, bannedAt } : entry,
                      ),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MemberCard({
  teamId,
  member,
  index,
  isLeader,
  onBanChanged,
}: {
  teamId: string;
  member: MemberRow;
  index: number;
  isLeader: boolean;
  onBanChanged: (memberId: string, bannedAt: string | null) => void;
}) {
  const role = isMemberRole(member.role) ? member.role : "STARTER";
  const phone = normalisePhone(member.phone);
  const answers = answersOf(member.requirements);
  const banned = Boolean(member.bannedAt);

  const [banBusy, setBanBusy] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const setMemberBanned = async (next: boolean) => {
    if (!member.id) return;
    setBanBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "member", memberId: member.id, banned: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        setActionError(typeof payload.error === "string" ? payload.error : "Could not change that ban.");
        return;
      }
      onBanChanged(member.id, next ? new Date().toISOString() : null);
    } catch {
      setActionError("We could not reach the server.");
    } finally {
      setBanBusy(false);
    }
  };

  const resend = async () => {
    if (!member.id) return;
    setResending(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        setActionError(
          typeof payload.error === "string" ? payload.error : "Could not send that email.",
        );
        return;
      }
      setNotice(
        isLeader
          ? `Receipt sent to ${member.email}.`
          : `Completion link sent to ${member.email}.`,
      );
    } catch {
      setActionError("We could not reach the server.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className={cn(
        "panel-inset rounded-xl p-3",
        isLeader && "border-brand/35 bg-brand/6",
        banned && "border-danger/45 bg-danger/6",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-lg font-mono text-[0.625rem]",
            isLeader ? "bg-brand text-wall-950" : "bg-wall-700 text-ash",
          )}
        >
          {index + 1}
        </span>
        <span className="text-xs font-semibold text-snow">{member.fullName || "—"}</span>
        {isLeader && <Crown className="size-3.5 shrink-0 text-brand" />}
        <RolePill role={role} />
        {member.gameTag && (
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[0.625rem] text-brand">
            {member.gameTag}
          </span>
        )}
        {banned && (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/45 bg-danger/10 px-2 py-0.5 text-[0.5625rem] font-bold tracking-wider text-danger uppercase">
            <Ban className="size-2.5" />
            Suspended
          </span>
        )}
        {!isLeader && !member.profileCompletedAt && (
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[0.5625rem] font-bold tracking-wider text-amber-300 uppercase">
            Details pending
          </span>
        )}

        <span className="ms-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[0.625rem] text-ash">
            <Checkbox
              checked={banned}
              disabled={banBusy || !member.id}
              onChange={(checked) => void setMemberBanned(checked)}
            />
            Ban
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[0.625rem]"
            disabled={resending || !member.email || banned || !member.id}
            onClick={() => void resend()}
          >
            {resending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            Resend
          </Button>
        </span>
      </div>

      {(notice || actionError) && (
        <p
          className={cn(
            "mt-2 rounded-lg border px-2 py-1 text-[0.625rem]",
            actionError
              ? "border-danger/35 bg-danger/8 text-danger"
              : "border-brand/30 bg-brand/8 text-brand",
          )}
        >
          {actionError ?? notice}
        </p>
      )}


      <dl className="mt-2 grid gap-x-4 gap-y-1.5 pl-9 sm:grid-cols-2">
        <Detail icon={<Building2 className="size-3" />} label="University">
          {member.universityName || "—"}
          {member.universityRegion && (
            <span className="ml-1.5 text-ash">{member.universityRegion}</span>
          )}
        </Detail>
        <Detail icon={<Mail className="size-3" />} label="Email" mono>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="break-all">{member.email || "—"}</span>
            {member.email ? (
              member.emailConfirmedAt ? (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[0.5625rem] font-bold tracking-wider text-emerald-300 uppercase">
                  Confirmed
                </span>
              ) : (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[0.5625rem] font-bold tracking-wider text-amber-300 uppercase">
                  Pending
                </span>
              )
            ) : null}
          </span>
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
      <dd className={cn("min-w-0 flex-1 break-words text-[0.6875rem] text-snow", mono && "font-mono text-[0.6875rem] text-ash")}>
        <span className="mr-1.5 text-ash/60">{label}:</span>
        {children}
      </dd>
    </div>
  );
}
