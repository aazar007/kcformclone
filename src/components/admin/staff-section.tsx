"use client";

import * as React from "react";
import { AlertCircle, Check, KeyRound, Loader2, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Pill } from "./controls";

interface StaffEntry {
  email: string;
  note: string;
  addedAt: string;
  lastLoginAt: string | null;
  revokedAt: string | null;
  live: boolean;
}

function formatWhen(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Who may sign in besides the grand admin.
 *
 * The gate here is real, not cosmetic: this section calls endpoints that refuse a
 * staff session, so a staff member cannot reach it even if they find the URL. It
 * is only *shown* to the grand admin to avoid offering a tab that always fails.
 *
 * Revoking rather than deleting is the default, because the useful question later
 * is "who has had access to this data", and a deleted row cannot answer it.
 */
export function StaffSection() {
  const [entries, setEntries] = React.useState<StaffEntry[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not load the list.");
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(payload.staff) ? (payload.staff as StaffEntry[]) : []);
    } catch {
      setError("We could not reach the server.");
      setEntries([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), note: note.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not add that address.");
        return;
      }
      setNotice(`${email.trim().toLowerCase()} can now sign in with a code sent to that address.`);
      setEmail("");
      setNote("");
      await load();
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const change = async (target: string, options: { hard?: boolean; restore?: boolean }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      /* Restoring is the same call as granting — the row is keyed by address, and a
         grant on an existing row clears its revocation. */
      const response = options.restore
        ? await fetch("/api/admin/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: target, note: "" }),
          })
        : await fetch(
            `/api/admin/staff?email=${encodeURIComponent(target)}${options.hard ? "&hard=1" : ""}`,
            { method: "DELETE" },
          );

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "That did not work.");
        return;
      }
      setNotice(
        options.restore
          ? `${target} can sign in again.`
          : options.hard
            ? `${target} was removed from the list.`
            : `${target} can no longer sign in.`,
      );
      await load();
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const live = entries?.filter((entry) => entry.live) ?? [];
  const revoked = entries?.filter((entry) => !entry.live) ?? [];

  return (
    <div className="space-y-5">
      <section className="panel rounded-2xl p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide text-snow">
          <UserPlus className="size-4 text-brand" />
          Grant access
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ash">
          An address added here can sign in on the Staff tab with a code emailed to it. Staff see
          the registrations — they cannot change the tournament, the rulebook, or this list.
        </p>

        <form onSubmit={grant} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Email address" htmlFor="staff-email" required>
            <Input
              id="staff-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              placeholder="organiser@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="staff-note" hint="Optional — why they have access.">
            <Input
              id="staff-note"
              value={note}
              placeholder="Runs the bracket"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button type="submit" className="h-11" disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add
          </Button>
        </form>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        {notice && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-emerald-300">
            <Check className="mt-px size-3.5 shrink-0" />
            <span>{notice}</span>
          </p>
        )}
      </section>

      <section className="panel rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-brand" />
          <h3 className="text-sm font-bold tracking-wide text-snow">Have access</h3>
          <Pill tone="brand">{live.length}</Pill>
        </div>

        {entries === null ? (
          <p className="mt-3 text-xs text-ash">Loading…</p>
        ) : live.length === 0 ? (
          <p className="mt-3 text-xs text-ash">
            Nobody but you. Add an address above to let another organiser in.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[rgba(148,196,208,0.12)]">
            {live.map((entry) => (
              <li key={entry.email} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-snow" dir="ltr">
                    {entry.email}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ash">
                    {entry.note ? `${entry.note} · ` : ""}
                    added {formatWhen(entry.addedAt)}
                    {entry.lastLoginAt ? ` · last signed in ${formatWhen(entry.lastLoginAt)}` : " · never signed in"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="text-danger hover:bg-danger/10"
                  onClick={() => void change(entry.email, {})}
                >
                  <Trash2 className="size-3.5" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revoked.length > 0 && (
        <section className="panel rounded-2xl p-5">
          <h3 className="text-sm font-bold tracking-wide text-ash">Revoked</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ash/70">
            Kept so the record of who once had access outlives the decision to take it away.
          </p>
          <ul className="mt-3 divide-y divide-[rgba(148,196,208,0.12)]">
            {revoked.map((entry) => (
              <li key={entry.email} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-mono text-xs text-ash/60 line-through")} dir="ltr">
                    {entry.email}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ash/60">
                    revoked {formatWhen(entry.revokedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void change(entry.email, { restore: true })}
                >
                  <RotateCcw className="size-3.5" />
                  Restore
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="text-danger hover:bg-danger/10"
                  onClick={() => void change(entry.email, { hard: true })}
                >
                  <Trash2 className="size-3.5" />
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
