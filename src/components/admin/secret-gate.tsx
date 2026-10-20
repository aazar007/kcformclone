"use client";

import * as React from "react";
import { AlertCircle, Loader2, Lock, MailCheck, ArrowRight } from "lucide-react";
import { digitsOnly } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaveWall } from "@/components/brand/wave-wall";
import { TournamentLogo } from "@/components/brand/ksu-crown-logo";

/**
 * The admin gate. One address, one way in.
 *
 * **Grand admin** — the deployment secret. It never reaches the browser's storage: it is
 * posted once, the server checks it and sets an HttpOnly session cookie, and the console
 * cannot be unlocked by editing client state because every write is checked again on the
 * way in.
 *
 * **Granted staff** — an email address the grand admin has added, plus a code mailed to
 * it. The allowlist is checked on the server *before* a code is sent, so an address that
 * was never granted never receives one. The step-up from "sent a code" to "signed in"
 * happens entirely server-side, and the session it mints carries the address so the
 * console and the audit log can name who is working.
 *
 * Which one is shown is decided by *where the reader arrived*, not by a tab they pick.
 * That is the point of the split: the two audiences have separate addresses, so a captain
 * handed the staff link is never shown a field asking for the master secret, and the grand
 * admin never has to step past a form meant for somebody else. The `mode` therefore comes
 * from the page, and there is deliberately no way to switch it from here — offering a tab
 * would put the secret prompt back in front of whoever was given the staff address.
 */
export function SecretGate({
  tournamentName,
  mode,
  onUnlock,
}: {
  tournamentName: string;
  /**
   * Which door this page is. Fixed by the route, never chosen in the UI.
   */
  mode: "owner" | "staff";
  /**
   * `twoStep` is what the server reported about the emailed confirmation step, when it
   * answered with a session rather than asking for a code. Omitted by the staff door, whose
   * own sign-in *is* an emailed code.
   */
  onUnlock: (
    session: { role: "owner" | "staff"; email: string | null },
    devSecret: boolean,
    twoStep?: boolean,
  ) => void;
}) {
  const [code, setCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [mailed, setMailed] = React.useState<string | null>(null);
  /**
   * Which half of the grand admin's sign-in is on screen.
   *
   * Two halves, because the secret is no longer enough on its own: it mails a code to the
   * address on file, and only the code opens the console. The phase is local state rather
   * than a step the server tells us about, because a refresh mid-way should start over
   * rather than leave a form waiting for a code nobody asked for in this session.
   */
  const [phase, setPhase] = React.useState<"secret" | "confirm">("secret");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Exchange the emailed code for a session. Shared by both phases of the owner flow.
   */
  const confirmOwner = async (candidate: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/verify/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: candidate }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "That code is not correct.");
        return;
      }

      onUnlock({ role: "owner", email: null }, Boolean(payload.devSecret), true);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitOwner = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: code }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not verify that code.");
        return;
      }

      /* The secret checked out without a second step — `ADMIN_EMAIL` is not set, so there is
         nowhere to send a code. The server signs in and reports that, and the console shows
         a permanent warning; refusing instead would lock the organiser out of their own
         console over a missing environment variable. */
      if (payload.stage === "session") {
        onUnlock({ role: "owner", email: null }, Boolean(payload.devSecret), payload.twoStep === true);
        return;
      }

      /* A code is on its way. Move to the second half, and carry the masked address so the
         reader can see where it went without it being on screen in full. */
      setSentTo(typeof payload.email === "string" ? payload.email : "your email");
      setMailed(
        payload.logged === true
          ? "Email is not configured, so the code was written to the server log instead."
          : null,
      );
      setPhase("confirm");
      setCode("");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitOwnerCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    await confirmOwner(code);
  };

  /** Ask for a code. The server refuses outright if the address was never granted. */
  const requestStaffCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/staff/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? payload.error : "We could not send the code.",
        );
        return;
      }

      const target = typeof payload.email === "string" ? payload.email : email.trim();

      /* `OTP_SKIP_VERIFY` (local testing) skips the mail — the request comes back with
         this flag and no code was sent. Finish the sign-in directly rather than
         waiting for a code nobody will receive. The grant is still checked
         server-side, so this is not a way past the allowlist. */
      if (payload.skipVerify === true) {
        setSentTo(target);
        await verifyStaffCode(target, "");
        return;
      }

      setSentTo(target);
      setMailed(
        payload.logged === true
          ? "Email is not configured, so the code was written to the server log instead."
          : `We emailed a 6-digit code to ${target}.`,
      );
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitStaffCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== 6 || busy || !sentTo) return;
    await verifyStaffCode(sentTo, code);
  };

  const verifyStaffCode = async (target: string, candidate: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/staff/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, code: candidate }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "That code is not correct.");
        return;
      }

      onUnlock({ role: "staff", email: target }, false);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <WaveWall />

      <div className="relative w-full max-w-md">
        <div className="mb-6">
          <TournamentLogo name={tournamentName} tagline="Organiser Console" size="md" />
        </div>

        <div className="panel rounded-3xl p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border border-brand/40 bg-brand/10 text-brand">
              <Lock className="size-4" />
            </span>
            <div>
              <h1 className="text-sm font-bold tracking-wide text-snow">
                {mode === "owner"
                  ? phase === "secret"
                    ? "Grand admin sign-in"
                    : "Confirm it is you"
                  : "Staff sign-in"}
              </h1>
              <p className="text-[11px] text-ash">
                {mode === "owner"
                  ? phase === "secret"
                    ? "This console changes the live tournament."
                    : "The last step of the grand admin sign-in."
                  : "Use the address the organisers granted access to."}
              </p>
            </div>
          </div>

          {/* No tabs. The address decides, so there is nothing to switch — and nothing
              here can put the secret prompt in front of a staff reader. */}

          {mode === "owner" && phase === "secret" && (
            <form onSubmit={submitOwner} className="mt-5 space-y-2">
              <label
                htmlFor="admin-secret"
                className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
              >
                Secret code
              </label>
              <Input
                id="admin-secret"
                type="password"
                dir="ltr"
                autoFocus
                autoComplete="current-password"
                value={code}
                invalid={Boolean(error)}
                placeholder="••••••••••"
                onChange={(event) => setCode(event.target.value)}
                className="font-mono"
              />
              <Button type="submit" className="mt-3 w-full" disabled={busy || !code.trim()}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
              <p className="pt-1 text-[11px] leading-relaxed text-ash/70">
                {/*
                 * Deliberately "when one is set" rather than a flat promise.
                 *
                 * The step only runs when `ADMIN_EMAIL` is configured, so the earlier wording
                 * — "A confirmation code is emailed to you next" — was a promise the sign-in
                 * could not keep on a deployment that had not set it. Telling someone to
                 * expect an email that never arrives is how they conclude the site is broken.
                 */}
                When <span className="font-mono">ADMIN_EMAIL</span> is configured, a
                confirmation code is emailed to you next. The secret on its own does not open
                the console.
              </p>
            </form>
          )}

          {mode === "owner" && phase === "confirm" && (
            <form onSubmit={submitOwnerCode} className="mt-5 space-y-2">
              <label
                htmlFor="admin-otp"
                className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
              >
                Confirmation code
              </label>
              <Input
                id="admin-otp"
                /* Western digits and LTR, like every other code field: it is a machine
                   token, and an RTL box would put the confirm button on the wrong side. */
                dir="ltr"
                inputMode="numeric"
                autoFocus
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                invalid={Boolean(error)}
                placeholder="000000"
                onChange={(event) => setCode(digitsOnly(event.target.value).slice(0, 6))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
              <Button
                type="submit"
                className="mt-3 w-full"
                disabled={busy || code.length !== 6}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    Unlock console
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
              <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-ash/70">
                <MailCheck className="mt-px size-3.5 shrink-0" />
                <span>
                  {mailed ??
                    `We emailed a 6-digit code to ${sentTo}. It expires in 15 minutes.`}
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setPhase("secret");
                  setCode("");
                  setError(null);
                  setSentTo(null);
                  setMailed(null);
                }}
                className="mx-auto block text-[11px] text-ash underline underline-offset-2 hover:text-snow"
              >
                Start again
              </button>
            </form>
          )}

          {mode === "staff" && sentTo === null && (
            <form onSubmit={requestStaffCode} className="mt-5 space-y-2">
              <label
                htmlFor="staff-email"
                className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
              >
                Your email
              </label>
              <Input
                id="staff-email"
                type="email"
                dir="ltr"
                autoFocus
                autoComplete="email"
                value={email}
                invalid={Boolean(error)}
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" className="mt-3 w-full" disabled={busy || !email.trim()}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <MailCheck className="size-4" />
                    Email me a code
                  </>
                )}
              </Button>
            </form>
          )}

          {mode === "staff" && sentTo !== null && (
            <form onSubmit={submitStaffCode} className="mt-5 space-y-2">
              {mailed && (
                <p className="rounded-lg border border-brand/30 bg-brand/8 px-3 py-2 text-[11px] leading-relaxed text-ash">
                  {mailed}
                </p>
              )}
              <label
                htmlFor="staff-code"
                className="text-[11px] font-bold tracking-[0.14em] text-ash uppercase"
              >
                Code from the email
              </label>
              <Input
                id="staff-code"
                dir="ltr"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                invalid={Boolean(error)}
                placeholder="000000"
                onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
              <Button type="submit" className="mt-3 w-full" disabled={busy || code.length !== 6}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setCode("");
                  setError(null);
                  setMailed(null);
                }}
                className="mx-auto block text-[11px] text-ash underline-offset-2 transition-colors hover:text-brand hover:underline"
              >
                Use a different address
              </button>
            </form>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-1.5 text-xs text-danger">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-ash/70">
            {mode === "owner" ? (
              <>
                The secret is checked on the server and never stored in the page. Set{" "}
                <span className="font-mono text-ash">ADMIN_SECRET</span> to change it, and{" "}
                <span className="font-mono text-ash">ADMIN_EMAIL</span> to change where the
                confirmation code is sent.
              </>
            ) : (
              <>
                Only addresses the grand admin has granted access to can sign in. If yours is
                refused, ask them to add it.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
