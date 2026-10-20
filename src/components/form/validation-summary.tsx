"use client";

import * as React from "react";
import { AlertCircle, Info, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldStep } from "@/lib/validation";
import { STEP_TITLE_KEYS } from "@/lib/i18n";
import { useLanguage } from "./language-provider";

/**
 * Surfaces every remaining problem with a jump-to-step shortcut, so a long form
 * never leaves the user hunting for the field that blocked submission.
 */
export function ValidationSummary({
  errors,
  warnings,
  onGoToStep,
  revealed = true,
}: {
  errors: Record<string, string>;
  warnings: string[];
  onGoToStep: (step: number) => void;
  /**
   * Whether to list the errors. Hidden until the captain has tried to submit, so the
   * review step does not greet a new arrival with a list of problems — most often a
   * consent box they have not even been asked to tick yet.
   */
  revealed?: boolean;
}) {
  const { t, message } = useLanguage();

  const grouped = React.useMemo(() => {
    const map = new Map<number, { key: string; message: string }[]>();
    for (const [key, text] of Object.entries(errors)) {
      const step = fieldStep(key);
      map.set(step, [...(map.get(step) ?? []), { key, message: text }]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [errors]);

  /* Errors are suppressed until the captain has tried to submit; warnings stay, because
     a warning is advisory and never the thing blocking them. If both are absent — or
     the only thing present is an un-revealed error — there is nothing to render. */
  if ((!revealed || grouped.length === 0) && warnings.length === 0) return null;

  const issueCount = Object.keys(errors).length;

  return (
    <div className="space-y-3">
      {revealed && grouped.length > 0 && (
        <section className="rounded-2xl border border-danger/40 bg-danger/8 p-4">
          <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-danger uppercase">
            <AlertCircle className="size-3.5" />
            {issueCount === 1 ? t("summary.issueOne") : t("summary.issues", { count: issueCount })}
          </h3>
          <ul className="mt-3 space-y-2">
            {grouped.map(([step, items]) => (
              <li key={step} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[11px] font-bold tracking-wider text-ash uppercase">
                  {STEP_TITLE_KEYS[step] ? t(STEP_TITLE_KEYS[step]) : t("summary.form")}:
                </span>
                <span className="text-xs text-snow">{message(items[0].message)}</span>
                {items.length > 1 && (
                  <span className="text-[11px] text-ash">
                    {t("summary.more", { count: items.length - 1 })}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] text-brand hover:bg-brand/10"
                  onClick={() => onGoToStep(step)}
                >
                  <Pencil className="size-3" />
                  {t("summary.fix")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-400/35 bg-amber-400/8 p-4">
          <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-amber-300 uppercase">
            <Info className="size-3.5" />
            {t("summary.checkTitle")}
          </h3>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="text-xs text-amber-100/80">
                • {message(warning)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-200/60">{t("summary.checkBody")}</p>
        </section>
      )}
    </div>
  );
}
