"use client";

import { useId, useState } from "react";

// Small "(i)" affordance next to a field label. Shows its explanation on
// hover or keyboard focus — reachable by both mouse and tab order, unlike a
// bare `title` attribute which keyboard users never see.
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/50 text-[9px] font-semibold leading-none text-muted-foreground transition hover:border-primary hover:text-primary"
      >
        i<span className="sr-only"> — more info</span>
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-1.5 w-48 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] leading-snug text-foreground shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
