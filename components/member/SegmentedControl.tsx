"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

// Member-app view switcher (DESIGN.md "Member app"): equal segments, full
// width on phones, 44px tall, 3px geometry. The selected segment is a raised
// navy tile with white text; gold stays reserved for actions. Arrow keys move
// between segments, as for any tab list.
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  /** Accessible name for the group, e.g. "Schedule view". */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex w-full rounded-[4px] border border-white/[0.1] bg-[var(--bg-0)] p-1 sm:inline-flex sm:w-auto ${className}`}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-[3px] px-4 text-sm font-semibold transition-colors duration-150 sm:flex-none ${
              selected ? "bg-[var(--surface-3)] text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
