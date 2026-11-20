"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import { HeadlineText } from "@/components/ui/HeadlineText";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";

// The three classes as typographic cards (no stock photography): Teko name,
// "From €x" price and a one-line summary are always visible. The Details button
// continues the summary sentence with the fuller description, sliding open and
// closed (a height transition, skipped for reduced motion); on a wide screen
// only the clicked card grows.
// The summary and the fuller description are one paragraph: opening Details carries the sentence on from where the summary ends. A hidden
// copy of the summary alone gives the closed height (on a wide screen the three summaries reserve the same height so the cards line up),
// and the visible paragraph's own height is the open one; the wrapper animates between them.
function ClassText({ id, tagline, description, isOpen }: { id: string; tagline: string; description: string; isOpen: boolean }) {
  const ghost = useRef<HTMLParagraphElement>(null);
  const full = useRef<HTMLParagraphElement>(null);
  const [heights, setHeights] = useState<{ closed: number; open: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (ghost.current && full.current) setHeights({ closed: ghost.current.offsetHeight, open: full.current.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (ghost.current) observer.observe(ghost.current);
    return () => observer.disconnect();
  }, [tagline, description]);

  const TEXT = "text-sm leading-relaxed text-zinc-300 lg:text-base";
  return (
    <div className="relative">
      <p ref={ghost} aria-hidden className={`invisible absolute inset-x-0 top-0 ${TEXT} lg:min-h-[4.9em]`}>
        {tagline}
      </p>
      <div
        id={id}
        className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={heights ? { height: isOpen ? heights.open : heights.closed } : undefined}
      >
        <p ref={full} className={`${TEXT} lg:min-h-[4.9em]`}>
          {tagline}
          <span aria-hidden={!isOpen} className={`transition-opacity duration-300 motion-reduce:transition-none ${isOpen ? "opacity-100" : "opacity-0"}`}>
            {" "}
            {description}
          </span>
        </p>
      </div>
    </div>
  );
}

export function ClassOffers() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ul className="grid gap-3 lg:grid-cols-3 lg:items-start lg:gap-5">
      {MARKETING_CLASSES.map((cls, i) => {
        const isOpen = open === i;
        const descId = `class-offer-${i}`;
        return (
          <li
            key={cls.name}
            className="group relative flex flex-col rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 focus-within:border-primary/40"
          >
            <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-[4px] bg-primary" aria-hidden />

            <div className="flex flex-1 flex-col p-5 pb-0 lg:p-8 lg:pb-0">
              <h3 className="text-headline text-[28px] text-zinc-50 lg:min-h-[2em] lg:text-[36px]">
                <HeadlineText text={cls.name} />
              </h3>
              <p className="mt-1 flex items-baseline gap-1.5 text-sm text-zinc-400 lg:mt-3">
                From
                <span className="text-headline text-[36px] leading-none text-gold lg:text-[44px]">{cls.price.from}</span>
                <span>/ {cls.price.per}</span>
              </p>

              <div className="mt-4 border-t border-white/[0.08] pt-4 lg:mt-6 lg:pt-5">
                <ClassText id={descId} tagline={cls.tagline} description={cls.description} isOpen={isOpen} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 px-5 pb-3 pt-1 lg:px-8 lg:pb-5">
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
