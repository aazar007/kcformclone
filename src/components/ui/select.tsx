"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldErrorVisibilityContext } from "@/components/ui/field";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  invalid,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { invalid?: boolean }) {
  /* Held back until the enclosing Field actually shows an error, so a select
     nobody has touched yet is not painted red — see FieldErrorVisibilityContext. */
  const errorVisible = React.useContext(FieldErrorVisibilityContext);
  const showInvalid = Boolean(invalid) && errorVisible;

  return (
    <SelectPrimitive.Trigger
      aria-invalid={showInvalid || undefined}
      className={cn(
        "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-wall-950/60 px-3.5 text-left text-sm text-snow transition-all",
        "data-[placeholder]:text-ash/55",
        "focus:outline-none focus:ring-2",
        showInvalid
          ? "border-danger/60 focus:border-danger focus:ring-danger/30"
          : "border-[rgba(148,196,208,0.18)] focus:border-brand/70 focus:ring-brand/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-ash" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={6}
        className={cn(
          "hud-scroll relative z-50 max-h-[22rem] min-w-[var(--radix-select-trigger-width)] overflow-y-auto overflow-x-hidden rounded-xl border border-[rgba(148,196,208,0.22)] bg-wall-850 p-1 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.95)]",
          "data-[side=bottom]:translate-y-0 data-[side=top]:-translate-y-0",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-ash">
          <ChevronUp className="size-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-ash">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        "sticky top-0 z-10 bg-wall-850 px-2.5 py-2 text-[10px] font-bold tracking-[0.18em] text-brand uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-lg py-2.5 pr-9 pl-2.5 text-sm text-snow outline-none select-none",
        "focus:bg-brand/12 focus:text-brand data-[state=checked]:text-brand",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-brand" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("my-1 h-px bg-[rgba(148,196,208,0.14)]", className)} {...props} />;
}
