"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Native checkbox with the brand treatment. Uses a real `<input>` so keyboard
 * and screen-reader behaviour is free, with the ticked state drawn on top.
 */
export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-5 shrink-0 items-center justify-center", className)}>
      <input
        id={id}
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(
          "peer size-5 cursor-pointer appearance-none rounded-md border bg-wall-950/60 transition-all",
          "border-[rgba(148,196,208,0.3)]",
          "checked:border-brand checked:bg-brand",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      />
      <Check className="pointer-events-none absolute size-3.5 text-wall-950 opacity-0 transition-opacity peer-checked:opacity-100" />
    </span>
  );
}

/** Label + checkbox on one clickable row, for admin settings. */
export function CheckboxField({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border border-[rgba(148,196,208,0.14)] bg-wall-950/40 p-3 transition-colors",
        "hover:border-brand/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Checkbox id={id} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-snow">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-ash">{hint}</span>}
      </span>
    </label>
  );
}
