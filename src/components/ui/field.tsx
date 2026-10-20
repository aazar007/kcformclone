import * as React from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEMBER_ROLE_LABEL, type MemberRole } from "@/lib/games";
import { Label } from "@/components/ui/label";

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  warning?: string;
  /**
   * Show `error` at once, without waiting for a blur.
   *
   * For problems more typing cannot fix — illegal characters, refused language, a
   * mistyped address. Those were previously hidden until the captain looked away,
   * which read as the form not checking anything at all. Completeness problems
   * (required, too short, one word of a name) must not set this, or every field
   * would turn red mid-word. See `revealsImmediately` in `validation.ts`.
   */
  immediate?: boolean;
  required?: boolean;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Whether the controls beneath a `Field` should look invalid.
 *
 * Defaults to `true`, so a control used outside a `Field` behaves exactly as its
 * own `invalid` prop says. Inside a `Field`, the field decides: an error that is
 * not being shown must not paint the input red either, or the two disagree and
 * the form looks broken in a way the text does not explain.
 */
export const FieldErrorVisibilityContext = React.createContext(true);

/**
 * Forces every `Field` beneath it to show its error.
 *
 * The wizard sets this for a step once the captain has tried to move past it, so
 * an empty required field is silent while they are still filling things in but
 * cannot hide behind that silence when they try to continue.
 */
const RevealErrorsContext = React.createContext(false);

export function RevealFieldErrors({
  when,
  children,
}: {
  when: boolean;
  children: React.ReactNode;
}) {
  return <RevealErrorsContext.Provider value={when}>{children}</RevealErrorsContext.Provider>;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  warning,
  immediate,
  required,
  badge,
  action,
  className,
  children,
}: FieldProps) {
  const stepRevealed = React.useContext(RevealErrorsContext);
  const [touched, setTouched] = React.useState(false);

  /* A field that is corrected and later broken again should wait for the next
     interaction rather than turning red the instant the old error returns. */
  React.useEffect(() => {
    if (!error) setTouched(false);
  }, [error]);

  const showError = Boolean(error) && (touched || stepRevealed || Boolean(immediate));

  return (
    /* `onBlur` bubbles in React, so one handler here sees focus leaving any
       control in this field — no per-input wiring needed. */
    <div className={cn("space-y-2", className)} onBlur={() => setTouched(true)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-brand">*</span>}
          {badge}
        </Label>
        {action}
      </div>

      <FieldErrorVisibilityContext.Provider value={showError}>
        {children}
      </FieldErrorVisibilityContext.Provider>

      {showError ? (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : warning ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-300/90">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-ash/80">{hint}</p>
      ) : null}
    </div>
  );
}

/** Small pill used to label the role of a roster slot. */
export function RolePill({
  role,
  label,
  className,
}: {
  role: MemberRole;
  /**
   * The role's name, already translated.
   *
   * Passed in rather than looked up here so this shared UI module stays free of the
   * language provider — it is rendered outside one in the organiser console, where a
   * `useLanguage` call would throw.
   */
  label?: string;
  className?: string;
}) {
  const tone: Record<MemberRole, string> = {
    STARTER: "border-brand/40 bg-brand/10 text-brand",
    SUBSTITUTE: "border-chrome-4/40 bg-chrome-4/10 text-chrome-3",
    COACH: "border-violet-400/40 bg-violet-400/10 text-violet-200",
  };

  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase",
        tone[role],
        className,
      )}
    >
      {label ?? MEMBER_ROLE_LABEL[role]}
    </span>
  );
}
