"use client";

import { useState } from "react";

import { type FaqGroup, type FaqItem, HOME_FAQ_GROUPS } from "@/lib/faq-content";

interface AccordionProps {
  items: readonly FaqItem[];
  idPrefix: string;
  /** Index of the item open on load; null starts the group fully closed. */
  defaultOpen?: number | null;
}

export function Accordion({ items, idPrefix, defaultOpen = 0 }: AccordionProps) {
  const [open, setOpen] = useState<number | null>(defaultOpen);

  return (
    <div className="divide-y divide-white/[0.08] border-t border-white/[0.08]">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`${idPrefix}-answer-${i}`}
              className="flex min-h-11 w-full items-center justify-between gap-4 py-5 text-left"
            >
              <span className="text-base font-medium text-zinc-100">{item.question}</span>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={`h-4 w-4 shrink-0 text-gold transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            <div
              id={`${idPrefix}-answer-${i}`}
              className={`grid overflow-hidden text-base leading-relaxed text-zinc-300 transition-[grid-template-rows,opacity,margin] duration-200 ${
                isOpen ? "mb-5 [grid-template-rows:1fr] opacity-100" : "[grid-template-rows:0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">{item.answer}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Grouped FAQ (copy in lib/faq-content.ts). Only the first question of the
// first group starts open; each group gets an anchor id.
export function FaqSection({ groups = HOME_FAQ_GROUPS }: { groups?: readonly FaqGroup[] }) {
  return (
    <div className="space-y-12">
      {groups.map((group, g) => (
        <div key={group.id} id={group.id} className="scroll-mt-24">
          <h3 className="text-headline text-[28px] text-gold">{group.title}</h3>
          <div className="mt-4">
            <Accordion items={group.items} idPrefix={`faq-${group.id}`} defaultOpen={g === 0 ? 0 : null} />
          </div>
        </div>
      ))}
    </div>
  );
}
