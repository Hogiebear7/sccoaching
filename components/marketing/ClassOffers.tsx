"use client";

import Link from "next/link";
import { useState } from "react";

import { HeadlineText } from "@/components/ui/HeadlineText";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";

// The three classes as typographic cards (no stock photography): Teko name,
// "From €x" price and a one-line summary are always visible. The fuller
// description fades in over the summary area on hover or keyboard focus
// (pointer devices) and via the Details toggle on touch, inside a fixed-height
// area so revealing it never shifts the row.
export function ClassOffers() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ul className="grid gap-5 lg:grid-cols-3">
      {MARKETING_CLASSES.map((cls, i) => {
        const isOpen = open === i;
        const descId = `class-offer-${i}`;
        return (
          <li
            key={cls.name}
            className="group relative flex flex-col rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 focus-within:border-primary/40"
          >
            <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-[4px] bg-primary" aria-hidden />

            <div className="flex flex-1 flex-col p-7 pb-0 lg:p-8 lg:pb-0">
              <h3 className="text-headline text-[36px] text-zinc-50 lg:min-h-[2em]">
                <HeadlineText text={cls.name} />
              </h3>
              <p className="mt-3 flex items-baseline gap-1.5 text-sm text-zinc-400">
                From
                <span className="text-headline text-[44px] leading-none text-gold">{cls.price.from}</span>
                <span>/ {cls.price.per}</span>
              </p>

              <div className="mt-6 mb-3 grid border-t border-white/[0.08] pt-5">
                <p
                  className={`col-start-1 row-start-1 text-base leading-relaxed text-zinc-300 transition-opacity duration-200 group-hover:opacity-0 group-focus-within:opacity-0 ${
                    isOpen ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {cls.tagline}
                </p>
                <p
                  id={descId}
                  className={`col-start-1 row-start-1 text-base leading-relaxed text-zinc-100 transition-[opacity,transform] duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${
                    isOpen ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                  }`}
                >
                  {cls.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 px-7 pb-6 lg:px-8">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={descId}
                onClick={() => setOpen(isOpen ? null : i)}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-zinc-200 transition-colors duration-150 hover:text-white"
              >
                {isOpen ? "Hide details" : "Details"}
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`h-4 w-4 text-gold transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
              <Link
                href={`/contact?class=${cls.slug}`}
                className="group/link inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                Enquire
                <span aria-hidden className="transition-transform duration-150 group-hover/link:translate-x-0.5">→</span>
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
