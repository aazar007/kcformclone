import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldErrorVisibilityContext } from "@/components/ui/field";

export interface InputProps extends React.ComponentProps<"input"> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  /* The enclosing Field suppresses this until the error is actually shown — see
     FieldErrorVisibilityContext. Outside a Field the context is `true`, so the
     prop behaves exactly as given. */
  const errorVisible = React.useContext(FieldErrorVisibilityContext);
  const showInvalid = Boolean(invalid) && errorVisible;

  return (
    <input
      data-slot="input"
      aria-invalid={showInvalid || undefined}
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border bg-wall-950/60 px-3.5 text-sm text-snow transition-all",
        "placeholder:text-ash/55",
        "focus-visible:outline-none focus-visible:ring-2",
        showInvalid
          ? "border-danger/60 focus-visible:border-danger focus-visible:ring-danger/30"
          : "border-[rgba(148,196,208,0.18)] focus-visible:border-brand/70 focus-visible:ring-brand/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
