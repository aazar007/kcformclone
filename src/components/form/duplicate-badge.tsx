"use client";

import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DuplicateState } from "./use-duplicate-watch";
import { useLanguage } from "./language-provider";

/**
 * The live duplicate indicator, floated inside the trailing edge of an input.
 *
 * Inside rather than underneath because it appears and disappears as the captain
 * types, and a line that comes and goes under the field would shove the rest of
 * the form up and down while they are reading it.
 *
 * The inputs it sits in reserve room for it permanently (`pe-24`), so even the
 * longest label cannot slide under the text. The reservation is *logical* — at the
 * reading end — so in Arabic it sits on the left where the badge actually appears,
 * rather than leaving a gap on the right and crowding the text.
 */
export function DuplicateBadge({
  state,
  taken,
  className,
}: {
  state: DuplicateState;
  /** What "taken" means here — "Name taken", "Already used", and so on. */
  taken: string;
  className?: string;
}) {
  const { t } = useLanguage();

  if (state === "idle") return null;

  const look = {
    checking: { icon: Loader2, text: t("dup.checking"), className: "text-ash" },
    free: { icon: Check, text: t("dup.free"), className: "text-emerald-300" },
    taken: { icon: X, text: taken, className: "text-danger" },
  }[state];

  const Icon = look.icon;

  return (
    <span
      /* Announced politely rather than assertively: the answer arrives a moment
         after the keystroke, and interrupting the captain mid-word to read it
         would be worse than waiting. */
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute inset-y-0 end-3 flex items-center gap-1 text-[10px] font-bold tracking-wide",
        look.className,
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", state === "checking" && "animate-spin")} />
      {look.text}
    </span>
  );
}
