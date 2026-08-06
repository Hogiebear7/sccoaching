"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface IconSelectOption<T extends string> {
  value: T;
  label: string;
  /** Emoji or short glyph shown beside the label. */
  icon: string;
  sublabel?: string;
}

// A native <select> can't render an icon per <option> in any browser — this
// is a minimal custom listbox (button + absolutely-positioned panel) used
// wherever a picker needs one, e.g. sport/position in the drink calculator.
// Keyboard behaviour mirrors a native select: Up/Down move the highlight,
// Enter/Space commits it, Escape (or a click outside) closes without
// changing the value.
export function IconSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: IconSelectOption<T>[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function openAt(index: number) {
    setHighlight(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
  }

  function commit(index: number) {
    const opt = options[index];
    if (opt) onChange(opt.value);
    setOpen(false);
  }

  function handleButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(Math.max(0, options.findIndex((o) => o.value === value)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt(options.length - 1);
    }
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(highlight);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.value === value))))}
        onKeyDown={handleButtonKeyDown}
        className="input-field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-base leading-none">
            {selected?.icon}
          </span>
          <span className="truncate">{selected?.label}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={handleListKeyDown}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {options.map((opt, i) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(i)}
                className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                  i === highlight ? "bg-accent text-foreground" : "text-foreground"
                }`}
              >
                <span aria-hidden="true" className="mt-0.5 text-base leading-none">
                  {opt.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  {opt.sublabel ? (
                    <span className="block truncate text-xs text-muted-foreground">{opt.sublabel}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
