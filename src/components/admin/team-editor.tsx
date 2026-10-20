"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  Crown,
  Loader2,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn, digitsOnly } from "@/lib/utils";
import { STUDENT_ID_MAX } from "@/lib/validation";
import {
  GENDERS,
  GENDER_LABEL,
  MEMBER_ROLE_LABEL,
  isGender,
  isMemberRole,
  type MemberRole,
} from "@/lib/games";
import {
  activeUniversities,
  gameById,
  rosterRulesFor,
  type TournamentConfig,
} from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A member row being edited. `key` is stable for React across reordering. */
interface DraftMember {
  key: string;
  fullName: string;
  gameTag: string;
  universityId: string;
  email: string;
  studentId: string;
  discord: string;
  phone: string;
  role: MemberRole;
  requirements: Record<string, string>;
}

/**
 * A stored member, exactly as the API returns it from Prisma.
 *
 * Shared with the read-only view so the two cannot drift: the editor flips a
 * team in place after saving, and that only type-checks if both sides agree on
 * what a team is.
 */
export interface StoredTeamMember {
  id: string;
  position: number;
  fullName: string;
  gameTag: string;
  universityId: string;
  universityName: string;
  universityRegion: string;
  email: string;
  studentId: string | null;
  discord: string;
  phone: string;
  role: string;
  requirements: unknown;
  createdAt: string | Date;
}

export interface EditableTeam {
  id: string;
  reference: string;
  teamName: string;
  tournamentName: string;
  gender: string;
  gameId: string;
  gameName: string;
  leaderIndex: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  members: StoredTeamMember[];
}

let seq = 0;
const nextKey = () => `m${(seq += 1)}`;

function requirementsOf(value: unknown): Record<string, string> {
  const answers: Record<string, string> = {};
  if (!Array.isArray(value)) return answers;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const answer = entry as { id?: unknown; value?: unknown };
    if (typeof answer.id !== "string") continue;
    answers[answer.id] = answer.value === null || answer.value === undefined ? "" : String(answer.value);
  }
  return answers;
}

function toDraft(team: EditableTeam): DraftMember[] {
  return team.members.map((member) => ({
    key: nextKey(),
    fullName: member.fullName,
    gameTag: member.gameTag,
    universityId: member.universityId,
    email: member.email,
    studentId: member.studentId ?? "",
    discord: member.discord,
    phone: member.phone,
    role: isMemberRole(member.role) ? member.role : "STARTER",
    requirements: requirementsOf(member.requirements),
  }));
}

function blankMember(role: MemberRole): DraftMember {
  return {
    key: nextKey(),
    fullName: "",
    gameTag: "",
    universityId: "",
    email: "",
    studentId: "",
    discord: "",
    phone: "",
    role,
    requirements: {},
  };
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The organiser's form for one team.
 *
 * Saves the whole team and roster in one request, the same way the public edit
 * flow does — an organiser correcting four typos should not have to save four
 * times, and a half-applied roster is worse than none.
 *
 * Roster composition is shown as a warning rather than blocking the save: an
 * organiser may be part-way through removing someone, or clearing out a squad,
 * and refusing to save would leave them unable to fix the data they are looking at.
 */
export function TeamEditor({
  team,
  config,
  secret,
  onCancel,
  onSaved,
  onDeleted,
}: {
  team: EditableTeam;
  config: TournamentConfig;
  secret: string;
  onCancel: () => void;
  onSaved: (team: EditableTeam, warnings: string[]) => void;
  onDeleted: (reference: string) => void;
}) {
  const [teamName, setTeamName] = React.useState(team.teamName.replace(/^Team\s+/i, ""));
  const [gender, setGender] = React.useState(team.gender);
  const [gameId, setGameId] = React.useState(team.gameId);
  const [leaderIndex, setLeaderIndex] = React.useState(team.leaderIndex);
  const [members, setMembers] = React.useState<DraftMember[]>(() => toDraft(team));

  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [warnings, setWarnings] = React.useState<string[]>([]);

  const game = gameById(config, gameId);
  const rules = rosterRulesFor(config, game);
  const universities = activeUniversities(config, gender === "male" || gender === "female" ? gender : "");

  const counts = React.useMemo(() => {
    let starters = 0;
    let substitutes = 0;
    let coaches = 0;
    for (const member of members) {
      if (member.role === "COACH") coaches += 1;
      else if (member.role === "SUBSTITUTE") substitutes += 1;
      else starters += 1;
    }
    return { starters, substitutes, coaches };
  }, [members]);

  /** Live hints, so the organiser sees a problem before pressing save. */
  const composition = React.useMemo(() => {
    const notes: string[] = [];
    if (!game) return notes;
    if (counts.starters !== rules.starters) {
      notes.push(
        `${game.name} fields exactly ${rules.starters} starter${rules.starters === 1 ? "" : "s"} — this roster has ${counts.starters}.`,
      );
    }
    if (counts.substitutes > rules.maxSubstitutes) {
      notes.push(`At most ${rules.maxSubstitutes} substitute${rules.maxSubstitutes === 1 ? "" : "s"} allowed.`);
    }
    if (counts.coaches > rules.maxCoaches) {
      notes.push(`At most ${rules.maxCoaches} coach${rules.maxCoaches === 1 ? "" : "es"} allowed.`);
    }
    return notes;
  }, [counts, game, rules]);

  const patchMember = (index: number, patch: Partial<DraftMember>) => {
    setMembers((current) => current.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };

  const removeMember = (index: number) => {
    setMembers((current) => current.filter((_, i) => i !== index));
    // Keep the leader pointing at the same person where possible.
    if (leaderIndex === index) setLeaderIndex(0);
    else if (leaderIndex > index) setLeaderIndex(leaderIndex - 1);
  };

  const addMember = (role: MemberRole) => {
    setMembers((current) => [...current, blankMember(role)]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setWarnings([]);

    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(team.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName,
          gender,
          gameId,
          leaderIndex,
          members: members.map((member) => ({
            fullName: member.fullName,
            gameTag: member.gameTag,
            universityId: member.universityId,
            email: member.email,
            studentId: member.studentId,
            discord: member.discord,
            phone: member.phone,
            role: member.role,
            requirements: config.requirements.map((requirement) => ({
              id: requirement.id,
              label: requirement.label,
              value: member.requirements[requirement.id] ?? "",
            })),
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not save those changes.");
        if (payload.errors && typeof payload.errors === "object") {
          setFieldErrors(payload.errors as Record<string, string>);
        }
        return;
      }

      onSaved(payload.team as EditableTeam, Array.isArray(payload.warnings) ? (payload.warnings as string[]) : []);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(team.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not remove that registration.");
        return;
      }

      onDeleted(typeof payload.reference === "string" ? payload.reference : team.reference);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setDeleting(false);
    }
  };

  const fieldError = (key: string) => fieldErrors[key];

  return (
    <div className="space-y-4 border-t border-brand/30 bg-wall-950/60 px-4 py-4">
      {/* ---------------------------- Team fields ---------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor={`${team.id}-name`} className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">
            Team name
          </label>
          <Input
            id={`${team.id}-name`}
            value={teamName}
            invalid={Boolean(fieldError("teamName"))}
            onChange={(event) => setTeamName(event.target.value)}
          />
          <p className="text-[10px] text-ash/70">“Team” is added automatically.</p>
          {fieldError("teamName") && <p className="text-[10px] text-danger">{fieldError("teamName")}</p>}
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">Division</span>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger invalid={Boolean(fieldError("gender"))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENDERS.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {GENDER_LABEL[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError("gender") && <p className="text-[10px] text-danger">{fieldError("gender")}</p>}
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">Game</span>
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger invalid={Boolean(fieldError("game"))}>
              <SelectValue placeholder="Choose a game" />
            </SelectTrigger>
            <SelectContent>
              {config.games.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name} · {entry.format}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError("game") && <p className="text-[10px] text-danger">{fieldError("game")}</p>}
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-bold tracking-[0.14em] text-ash uppercase">Roster</span>
          <p className="flex h-11 items-center gap-2 rounded-lg border border-[rgba(148,196,208,0.18)] bg-wall-950/60 px-3 font-mono text-[11px] text-ash">
            {counts.starters} starter{counts.starters === 1 ? "" : "s"}
            {counts.substitutes > 0 && ` · ${counts.substitutes} sub${counts.substitutes === 1 ? "" : "s"}`}
            {counts.coaches > 0 && ` · ${counts.coaches} coach${counts.coaches === 1 ? "" : "es"}`}
          </p>
          <p className="text-[10px] text-ash/70">
            {game ? `${game.name} fields ${rules.starters}` : "Choose a game"}
          </p>
        </div>
      </div>

      {/* ----------------------------- Warnings ----------------------------- */}
      {(composition.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1 rounded-xl border border-amber-400/35 bg-amber-400/8 p-3">
          {[...composition, ...warnings].map((note) => (
            <li key={note} className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-100/90">
              <TriangleAlert className="mt-px size-3 shrink-0 text-amber-300" />
              {note}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {fieldError("leader") && <p className="text-[11px] text-danger">{fieldError("leader")}</p>}

      {/* ------------------------------ Members ----------------------------- */}
      <div className="space-y-2">
        {members.map((member, index) => (
          <div
            key={member.key}
            className={cn(
              "panel-inset rounded-xl p-3",
              leaderIndex === index && "border-brand/35",
            )}
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-wall-700 font-mono text-[10px] text-ash">
                {index + 1}
              </span>

              <Select
                value={member.role}
                onValueChange={(value) => patchMember(index, { role: value as MemberRole })}
              >
                <SelectTrigger className="h-8 w-36 text-[11px]" aria-label={`Role for member ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["STARTER", "SUBSTITUTE", "COACH"] as MemberRole[]).map((role) => (
                    <SelectItem key={role} value={role}>
                      {MEMBER_ROLE_LABEL[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={() => setLeaderIndex(index)}
                aria-pressed={leaderIndex === index}
                disabled={member.role === "COACH"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold tracking-wide uppercase transition-colors",
                  leaderIndex === index
                    ? "border-brand/60 bg-brand/10 text-brand"
                    : "border-[rgba(148,196,208,0.2)] text-ash hover:border-brand/40 hover:text-snow",
                  member.role === "COACH" && "cursor-not-allowed opacity-40",
                )}
              >
                {leaderIndex === index ? <Check className="size-3" /> : <Crown className="size-3" />}
                Leader
              </button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-[11px] text-danger"
                disabled={members.length <= 1}
                onClick={() => removeMember(index)}
              >
                <Trash2 className="size-3" />
                Remove
              </Button>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Labelled label="Name" error={fieldError(`member.${index}.fullName`)}>
                <Input
                  value={member.fullName}
                  invalid={Boolean(fieldError(`member.${index}.fullName`))}
                  onChange={(event) => patchMember(index, { fullName: event.target.value })}
                />
              </Labelled>

              <Labelled
                label="Game tag"
                error={fieldError(`member.${index}.gameTag`)}
                hint={member.role === "COACH" ? "Optional for coaches" : undefined}
              >
                <Input
                  dir="ltr"
                  value={member.gameTag}
                  invalid={Boolean(fieldError(`member.${index}.gameTag`))}
                  onChange={(event) => patchMember(index, { gameTag: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </Labelled>

              <Labelled label="University" error={fieldError(`member.${index}.university`)}>
                <Select
                  value={member.universityId}
                  onValueChange={(value) => patchMember(index, { universityId: value })}
                >
                  <SelectTrigger invalid={Boolean(fieldError(`member.${index}.university`))} className="text-[12px]">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {universities.map((university) => (
                      <SelectItem key={university.id} value={university.id}>
                        {university.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labelled>

              <Labelled label="Email" error={fieldError(`member.${index}.email`)}>
                <Input
                  type="email"
                  dir="ltr"
                  value={member.email}
                  invalid={Boolean(fieldError(`member.${index}.email`))}
                  onChange={(event) => patchMember(index, { email: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </Labelled>

              <Labelled
                label="Student ID"
                error={fieldError(`member.${index}.studentId`)}
                hint={member.role === "COACH" ? "Optional for coaches" : undefined}
              >
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={STUDENT_ID_MAX}
                  value={member.studentId}
                  invalid={Boolean(fieldError(`member.${index}.studentId`))}
                  onChange={(event) =>
                    patchMember(index, {
                      studentId: digitsOnly(event.target.value).slice(0, STUDENT_ID_MAX),
                    })
                  }
                  className="font-mono text-[12px]"
                />
              </Labelled>

              <Labelled label="Discord" error={fieldError(`member.${index}.discord`)}>
                <Input
                  dir="ltr"
                  value={member.discord}
                  invalid={Boolean(fieldError(`member.${index}.discord`))}
                  onChange={(event) => patchMember(index, { discord: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </Labelled>

              <Labelled label="Phone" error={fieldError(`member.${index}.phone`)}>
                <Input
                  type="tel"
                  dir="ltr"
                  value={member.phone}
                  invalid={Boolean(fieldError(`member.${index}.phone`))}
                  onChange={(event) => patchMember(index, { phone: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </Labelled>

              {config.requirements.map((requirement) => (
                <Labelled
                  key={requirement.id}
                  label={requirement.label}
                  error={fieldError(`member.${index}.req.${requirement.id}`)}
                >
                  <Input
                    value={member.requirements[requirement.id] ?? ""}
                    invalid={Boolean(fieldError(`member.${index}.req.${requirement.id}`))}
                    onChange={(event) =>
                      patchMember(index, {
                        requirements: { ...member.requirements, [requirement.id]: event.target.value },
                      })
                    }
                  />
                </Labelled>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => addMember("STARTER")}>
          <Plus className="size-3.5" />
          Add starter
        </Button>
        {rules.maxSubstitutes > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => addMember("SUBSTITUTE")}>
            <Plus className="size-3.5" />
            Add substitute
          </Button>
        )}
        {rules.maxCoaches > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => addMember("COACH")}>
            <Plus className="size-3.5" />
            Add coach
          </Button>
        )}
      </div>

      {/* ------------------------------ Actions ----------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(148,196,208,0.12)] pt-4">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving || deleting}>
          <X className="size-3.5" />
          Cancel
        </Button>

        <Button type="button" size="sm" className="ml-auto" onClick={() => void save()} disabled={saving || deleting}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save changes
        </Button>

        {/* Deleting a whole team is irreversible, so it takes two presses and says
            what will actually be lost. */}
        {confirmDelete ? (
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/45 bg-danger/10 px-2.5 py-1.5">
            <span className="text-[11px] text-danger">
              Delete {team.reference} and all {members.length} of its members?
            </span>
            <Button
              type="button"
              size="sm"
              variant="danger"
              className="h-7 px-2 text-[11px]"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              Yes, delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Keep
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
          >
            <Trash2 className="size-3.5" />
            Delete team
          </Button>
        )}
      </div>
    </div>
  );
}

function Labelled({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block truncate text-[10px] font-bold tracking-[0.1em] text-ash/80 uppercase">
        {label}
      </span>
      {children}
      {error ? (
        <p className="text-[10px] leading-tight text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[10px] leading-tight text-ash/60">{hint}</p>
      ) : null}
    </div>
  );
}
