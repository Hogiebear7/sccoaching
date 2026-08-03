"use client";

import { useState } from "react";

// Compact expandable explanation for score cards ("What's this?"). Kept
// deliberately small so summary rows stay scannable with help collapsed.
export function ScoreHelp({ title, children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[11px] font-medium text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]"
      >
        {open ? "Hide" : (title ?? "What's this?")}
      </button>
      {open && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
      )}
    </div>
  );
}
