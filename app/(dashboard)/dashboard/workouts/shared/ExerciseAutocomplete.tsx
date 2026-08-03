"use client";

import { useState } from "react";

import type { ExerciseRecord } from "@/lib/db";
import { SECTION_LABELS } from "./constants";

// Defined at module level so React doesn't recreate it on every form render.
// Shared by both view variants' log form — there is only one logging form.
export function ExerciseAutocomplete({
  exercises,
  value,
  onChange,
}: {
  exercises: ExerciseRecord[];
  value: string;
  onChange: (name: string, exerciseId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const suggestions =
    value.trim().length > 0
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(value.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. Bench Press"
        className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before selection registers
                onChange(s.name, s.id);
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-2 px-4 py-2.5 text-left text-sm hover:bg-secondary"
            >
              <span className="font-medium text-foreground">{s.name}</span>
              <span className="text-xs text-muted-foreground">{SECTION_LABELS[s.section]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
