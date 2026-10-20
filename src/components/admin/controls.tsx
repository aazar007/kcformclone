"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** A titled block in the admin console. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel rounded-2xl p-5", className)}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(148,196,208,0.12)] pb-4">
        <div className="min-w-0">
          <h2 className="text-[11px] font-bold tracking-[0.18em] text-brand uppercase">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-ash">{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Label + control + help text, in the same shape as the public form's fields. */
export function Setting({
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
  type = "text",
  required,
  min,
  max,
  className,
  disabled,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: "text" | "number";
  required?: boolean;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <Input
        type={type}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={type === "number" ? "numeric" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A small pill used for counts and statuses in section headers. */
export function Pill({
  children,
  tone = "brand",
}: {
  children: React.ReactNode;
  tone?: "brand" | "muted" | "warn";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide",
        tone === "brand" && "border-brand/30 bg-brand/10 text-brand",
        tone === "muted" && "border-[rgba(148,196,208,0.22)] text-ash",
        tone === "warn" && "border-amber-400/35 bg-amber-400/10 text-amber-300",
      )}
    >
      {children}
    </span>
  );
}

/** Explains an empty list without leaving the section looking broken. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="panel-inset rounded-xl p-4 text-[11px] leading-relaxed text-ash">{children}</p>
  );
}
