"use client";

import { useState } from "react";

import { HeadlineText } from "@/components/ui/HeadlineText";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";

// The three classes as photo cards. The full description reveals over the
// photo on hover or keyboard focus (pointer devices) and via the Details
// toggle on touch, so nothing depends on hover alone. Name, price and a
// one-line summary are always visible.
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
            className="group flex flex-col overflow-hidden rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 focus-within:border-primary/40"
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- static marketing photo with fixed dimensions */}
              <img
                src={cls.image.src}
                alt={cls.image.alt}
                width={1600}
                height={905}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
              />
              <div
                id={descId}
                className={`absolute inset-0 flex items-end bg-[var(--bg-0)]/90 p-6 transition-[opacity,transform] duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${
                  isOpen ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
              >
                <p className="text-base leading-relaxed text-zinc-100">{cls.description}</p>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-headline text-[32px] text-zinc-50">
                <HeadlineText text={cls.name} />
              </h3>
              <p className="mt-2 flex items-baseline gap-1.5 text-sm text-zinc-400">
                From
                <span className="text-headline text-[40px] leading-none text-gold">{cls.price.from}</span>
                <span>/ {cls.price.per}</span>
              </p>
              <p className="mt-3 text-base leading-relaxed text-zinc-300">{cls.tagline}</p>

              <div className="mt-auto flex items-center justify-between gap-4 pt-6">
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
                <a
                  href="#contact"
                  className="group/link inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
                >
                  Enquire
                  <span aria-hidden className="transition-transform duration-150 group-hover/link:translate-x-0.5">→</span>
                </a>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
