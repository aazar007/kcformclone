"use client";

import * as React from "react";
import { AlertCircle, Check, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, SectionCard } from "./controls";

/**
 * The grand admin's password — set, change or remove it.
 *
 * This is the credential that **is** the console, so the section is blunt about what it
 * does and does not protect:
 *
 * - The password is hashed on the server and only the hash is stored. The browser never
 *   sends a hash — sending one would make the hash itself the password.
 * - The hash is peppered with a secret derived from `ADMIN_SECRET`, which never reaches the
 *   database. So a copy of the database alone cannot be tested against a guess.
 * - **`ADMIN_SECRET` still signs in.** It has to: it is what sets the first password, and
 *   losing the password must not mean losing the tournament. Saying so plainly is more
 *   useful than a warm feeling about "the password is the only way in".
 *
 * The current credential is re-entered for every change, which is about the unlocked laptop
 * rather than the session: an organiser who walks away mid-shift leaves a console that can
 * read every team's contact details.
 */
export function PasswordSection() {
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  /**
   * Whether the two new-password fields are shown in the clear.
   *
   * Worth having here more than on an ordinary sign-up form: the failure this section sees
   * is "I set a password and it did not work", and the likeliest cause is that what was
   * typed is not what was intended — a password manager's generated value accepting
   * `autocomplete="new-password"`, a paste that brought something else along, or a
   * mistyped character copied identically into both fields. Being able to *look* at it
   * before saving is the direct answer to that, and it costs nothing: whoever is reading
   * the console is alone with the credential they already hold.
   */
  const [reveal, setReveal] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/admin/password", { cache: "no-store" });
      if (!response.ok) {
        setConfigured(false);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setConfigured(payload.configured === true);
      setUpdatedAt(typeof payload.updatedAt === "string" ? payload.updatedAt : null);
    } catch {
      setConfigured(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setCurrent("");
    setPassword("");
    setConfirm("");
    setReveal(false);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, password, confirm }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "We could not save it.");
        return;
      }

      reset();
      /* The length is reported because it is the one fact that tells someone the *right*
         value went in without revealing it. A password manager substituting its own
         suggestion is invisible otherwise — and that is a real cause of "I set it and it
         did not work". */
      setNotice(`Password saved — ${password.length} characters. Use it from now on; the deployment secret still works too.`);
      await load();
    } catch {
      setError("We could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/password", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "We could not remove it.");
        return;
      }

      reset();
      setNotice("Password removed. The deployment secret is the only way in again.");
      await load();
    } catch {
      setError("We could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <SectionCard
      title="Grand admin password"
      description="Set a password you can change without redeploying. Stored as a hash, never as the password itself."
    >
      <div className="space-y-5">
        {/* ---- Current state ------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[rgba(148,196,208,0.16)] bg-wall-950/40 p-3.5">
          <ShieldCheck
            className={cn("size-4 shrink-0", configured ? "text-brand" : "text-ash")}
            aria-hidden
          />
          <span className="text-[11px] leading-relaxed text-ash">
            {configured === null
              ? "Checking…"
              : configured
                ? "A password is set and signs you in."
                : "No password set — the deployment secret is the only credential."}
          </span>
          {configured && updatedAt && (
            <Pill tone="muted">
              set {new Date(updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </Pill>
          )}
        </div>

        {/* ---- The form ------------------------------------------------------ */}
        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase">
              {configured ? "Current credential" : "Deployment secret"}
            </span>
            <Input
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              placeholder={configured ? "Your password or ADMIN_SECRET" : "ADMIN_SECRET"}
              className="mt-1.5 font-mono"
              invalid={Boolean(error)}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase">
                New password
              </span>
              <Input
                type={reveal ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 12 characters"
                className="mt-1.5 font-mono"
                invalid={Boolean(error)}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase">
                Repeat it
              </span>
              <Input
                type={reveal ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Type it again"
                className="mt-1.5 font-mono"
                invalid={mismatch}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setReveal((value) => !value)}
              className="inline-flex items-center gap-1.5 text-[11px] text-ash underline underline-offset-2 hover:text-snow"
            >
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {reveal ? "Hide what I typed" : "Show what I typed"}
            </button>
            {/* Character count while typing, so a paste that brought more than intended is
                obvious before it is saved rather than after it fails. */}
            {password.length > 0 && (
              <span className={cn("text-[11px]", password.length < 12 ? "text-amber-300" : "text-ash/70")}>
                {password.length} characters
              </span>
            )}
          </div>

          {mismatch && (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              The two entries do not match.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !current || !password || mismatch}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              {configured ? "Change the password" : "Set the password"}
            </Button>
            {configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void remove()}
                disabled={busy || !current}
              >
                <Trash2 className="size-3.5" />
                Remove it
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={busy}>
              Clear
            </Button>
          </div>
        </form>

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-danger/45 bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2 text-[11px] leading-relaxed text-brand">
            <Check className="mt-px size-3.5 shrink-0" />
            {notice}
          </p>
        )}

        {/* ---- How it actually works --------------------------------------- */}
        <div className="space-y-1.5 border-t border-[rgba(148,196,208,0.12)] pt-4 text-[11px] leading-relaxed text-ash">
          <p className="font-bold tracking-[0.14em] text-ash uppercase">How this is stored</p>
          <ul className="list-disc space-y-1 ps-4">
            <li>
              The password is hashed on the server with <span className="font-mono">scrypt</span>
              , and only the hash is written to the database. The browser never sends a hash —
              it sends the password, which would stop being a password if it did.
            </li>
            <li>
              The hash is also mixed with a secret derived from{" "}
              <span className="font-mono">ADMIN_SECRET</span>, which never reaches the
              database. A stolen copy of the database therefore cannot be tested against a
              guess at all.
            </li>
            <li>
              <strong className="text-snow">ADMIN_SECRET still signs you in.</strong> It is the
              root credential: it is what sets the first password, and what gets you back in if
              this one is forgotten. Removing the password above just leaves it as the only way
              in.
            </li>
            <li>
              Changing <span className="font-mono">ADMIN_SECRET</span> changes that secret, so a
              stored password stops working — sign in with the deployment secret and set a new
              one.
            </li>
            <li>
              This is why a short password is refused. A hash protects a good password; it does
              not rescue a bad one — <span className="font-mono">1234</span> has ten thousand
              possibilities and falls in seconds.
            </li>
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
