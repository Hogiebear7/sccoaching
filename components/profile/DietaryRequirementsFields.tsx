"use client";

import type { DietaryPreference } from "@/lib/profile-schema";
import {
  ALLERGEN_OPTIONS,
  DIETARY_NOTES_PLACEHOLDER,
  DIETARY_PREFERENCE_OPTIONS,
  INTOLERANCE_OPTIONS,
} from "@/lib/profile-options";

export interface DietaryFieldValues {
  dietaryPreference: DietaryPreference | "";
  allergies: string[];
  intolerancesOrMedical: string[];
  dietaryNotes: string;
}

// Shared, presentational dietary-requirements editor used by both signup and
// the member profile. Fully controlled — the parent owns the values and gets a
// patch on every change. Everything is optional; the empty state is valid.
export function DietaryRequirementsFields({
  values,
  onChange,
  idPrefix = "diet",
}: {
  values: DietaryFieldValues;
  onChange: (patch: Partial<DietaryFieldValues>) => void;
  idPrefix?: string;
}) {
  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="space-y-4">
      {/* Preference — single select */}
      <div>
        <span className="mb-1.5 block text-sm font-medium">Dietary preference</span>
        <div className="flex flex-wrap gap-1.5">
          {DIETARY_PREFERENCE_OPTIONS.map((opt) => {
            const active = (values.dietaryPreference || "standard") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ dietaryPreference: opt.value })}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Allergies — multi select */}
      <ChipMultiSelect
        label="Allergies"
        hint="We'll never suggest foods containing these."
        options={ALLERGEN_OPTIONS}
        selected={values.allergies}
        onToggle={(value) => onChange({ allergies: toggle(values.allergies, value) })}
        idPrefix={`${idPrefix}-allergy`}
      />

      {/* Intolerances / medical — multi select */}
      <ChipMultiSelect
        label="Intolerances / medical"
        hint="Also excluded from food suggestions."
        options={INTOLERANCE_OPTIONS}
        selected={values.intolerancesOrMedical}
        onToggle={(value) =>
          onChange({ intolerancesOrMedical: toggle(values.intolerancesOrMedical, value) })
        }
        idPrefix={`${idPrefix}-intolerance`}
      />

      {/* Notes */}
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">
          Additional notes — diet or medical <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <textarea
          value={values.dietaryNotes}
          onChange={(e) => onChange({ dietaryNotes: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder={DIETARY_NOTES_PLACEHOLDER}
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
        />
      </label>
    </div>
  );
}

function ChipMultiSelect({
  label,
  hint,
  options,
  selected,
  onToggle,
  idPrefix,
}: {
  label: string;
  hint: string;
  options: { label: string; value: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  idPrefix: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              id={`${idPrefix}-${opt.value}`}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(opt.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-gold bg-gold/[0.12] text-gold"
                  : "border-border text-muted-foreground hover:border-gold/60"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p>
    </div>
  );
}
