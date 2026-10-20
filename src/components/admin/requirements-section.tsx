"use client";

import * as React from "react";
import { ListChecks, Plus, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REQUIREMENT_TYPE_LABEL,
  slugify,
  type RequirementDefinition,
  type RequirementType,
} from "@/lib/tournament";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyNote, Pill, SectionCard, Setting } from "./controls";
import type { SectionProps } from "./general-section";

const TYPES: RequirementType[] = ["text", "number", "select", "checkbox"];

/** One-click starters, so the common fields do not have to be typed out. */
const SUGGESTIONS: { label: string; requirement: Omit<RequirementDefinition, "id"> }[] = [
  { label: "T-shirt size", requirement: { label: "T-shirt size", type: "select", required: true, options: ["S", "M", "L", "XL", "XXL"] } },
  { label: "National ID", requirement: { label: "National ID", type: "text", required: true, minLength: 10, maxLength: 10, hint: "10 digits, as printed on your ID." } },
  { label: "Emergency contact", requirement: { label: "Emergency contact number", type: "text", required: true, hint: "A Saudi mobile we can reach during match days." } },
  { label: "Rules agreement", requirement: { label: "I have read and accept the tournament rules", type: "checkbox", required: true } },
];

function uniqueId(label: string, existing: RequirementDefinition[], fallbackIndex: number) {
  const base = slugify(label) || `requirement-${fallbackIndex + 1}`;
  const taken = new Set(existing.map((requirement) => requirement.id));

  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function RequirementsSection({ config, patch }: SectionProps) {
  const [removing, setRemoving] = React.useState<number | null>(null);

  const replace = (index: number, next: RequirementDefinition) => {
    patch(
      "requirements",
      config.requirements.map((requirement, i) => (i === index ? next : requirement)),
    );
  };

  const add = (requirement: Omit<RequirementDefinition, "id">) => {
    patch("requirements", [
      ...config.requirements,
      { ...requirement, id: uniqueId(requirement.label, config.requirements, config.requirements.length) },
    ]);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Extra member requirements"
        description="Anything the organisers need beyond name, university, email, student ID, game tag, Discord and phone. Each requirement is asked of every member on the roster."
      >
        {config.requirements.length === 0 ? (
          <EmptyNote>
            No extra requirements yet. The roster always collects name, game tag, university,
            university email, student ID, Discord ID and phone number — add fields here only when you
            need more.
          </EmptyNote>
        ) : (
          <div className="space-y-3">
            {config.requirements.map((requirement, index) => (
              <div key={requirement.id} className="panel-inset rounded-2xl p-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand/35 bg-brand/10 text-brand">
                    <ListChecks className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-snow">
                      {requirement.label || "Untitled requirement"}
                    </p>
                    <p className="font-mono text-[10px] text-ash">
                      id: {requirement.id} · {REQUIREMENT_TYPE_LABEL[requirement.type]}
                    </p>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    {requirement.required ? (
                      <Pill tone="brand">Required</Pill>
                    ) : (
                      <Pill tone="muted">Optional</Pill>
                    )}
                    {removing === index ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            patch(
                              "requirements",
                              config.requirements.filter((_, i) => i !== index),
                            );
                            setRemoving(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Cancel"
                          onClick={() => setRemoving(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${requirement.label}`}
                        onClick={() => setRemoving(index)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Setting
                    label="Label"
                    required
                    maxLength={60}
                    value={requirement.label}
                    placeholder="e.g. T-shirt size"
                    onChange={(value) => replace(index, { ...requirement, label: value })}
                  />

                  <div className="space-y-2">
                    <span className="block text-[11px] font-bold tracking-[0.12em] text-ash uppercase">
                      Type
                    </span>
                    <Select
                      value={requirement.type}
                      onValueChange={(value) =>
                        replace(index, {
                          ...requirement,
                          type: value as RequirementType,
                          options: value === "select" ? (requirement.options ?? []) : undefined,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {REQUIREMENT_TYPE_LABEL[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Setting
                    label="Help text"
                    className="sm:col-span-2"
                    maxLength={160}
                    value={requirement.hint ?? ""}
                    placeholder="Shown under the field"
                    onChange={(value) =>
                      replace(index, { ...requirement, hint: value.trim() ? value : undefined })
                    }
                  />

                  {requirement.type === "select" && (
                    <Setting
                      label="Options"
                      className="sm:col-span-2"
                      value={(requirement.options ?? []).join(", ")}
                      placeholder="S, M, L, XL"
                      hint="Comma-separated. A list with no options falls back to a text field."
                      onChange={(value) =>
                        replace(index, {
                          ...requirement,
                          options: value
                            .split(",")
                            .map((option) => option.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  )}

                  {(requirement.type === "text" || requirement.type === "number") && (
                    <>
                      <Setting
                        label="Placeholder"
                        value={requirement.placeholder ?? ""}
                        placeholder="e.g. 1234567890"
                        onChange={(value) =>
                          replace(index, {
                            ...requirement,
                            placeholder: value.trim() ? value : undefined,
                          })
                        }
                      />
                      {requirement.type === "text" && (
                        <div className="grid grid-cols-2 gap-3">
                          <Setting
                            label="Min length"
                            type="number"
                            min={0}
                            max={200}
                            value={requirement.minLength ?? 0}
                            onChange={(value) =>
                              replace(index, {
                                ...requirement,
                                minLength: Number.parseInt(value, 10) || undefined,
                              })
                            }
                          />
                          <Setting
                            label="Max length"
                            type="number"
                            min={0}
                            max={200}
                            value={requirement.maxLength ?? 0}
                            onChange={(value) =>
                              replace(index, {
                                ...requirement,
                                maxLength: Number.parseInt(value, 10) || undefined,
                              })
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-4">
                  <CheckboxField
                    checked={requirement.required}
                    onChange={(checked) => replace(index, { ...requirement, required: checked })}
                    label="Required"
                    hint="Members cannot continue until this is answered."
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Add a requirement"
        description="Start from a common one, or build a custom field above."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => add({ label: "", type: "text", required: true })}
          >
            <Plus className="size-3.5" />
            Blank requirement
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => add(suggestion.requirement)}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950/40 px-3 py-2",
                "text-[11px] font-semibold text-ash transition-colors hover:border-brand/50 hover:text-snow",
              )}
            >
              <Sparkles className="size-3.5 text-brand" />
              {suggestion.label}
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
