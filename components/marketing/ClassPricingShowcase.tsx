"use client";

import Link from "next/link";
import { useState } from "react";
import type { FocusEvent } from "react";

import { ClassImageSlot } from "@/components/ui/ClassImageSlot";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";

interface PricingInfo {
  priceLabel: string;
  cadence: string;
}

// Matches the three classes in MARKETING_CLASSES, same order.
const PRICING: PricingInfo[] = [
  { priceLabel: "€160", cadence: "/ month" },
  { priceLabel: "€20", cadence: "/ class" },
  { priceLabel: "€20", cadence: "/ class" },
];

// One shared `active` index drives every card's expand state, so exactly
// one card can be open at a time by construction — hovering, focusing, or
// tapping a card sets it; leaving the whole grid (mouse-leave) or tabbing
// out (blur) clears it. This replaces the old per-card CSS group-hover
// approach, which let more than one card appear expanded at once.
export function ClassPricingShowcase({ href }: { href: string }) {
  const [active, setActive] = useState<number | null>(null);

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setActive(null);
    }
  }

  return (
    <div
      // items-start overrides CSS Grid's default row-stretch — without it,
      // every card in the row grows to match whichever one just expanded
      // its description, even though the other two have nothing new to
      // show (the visible bug: boxes growing with no content change).
      className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3"
      onMouseLeave={() => setActive(null)}
      onBlur={handleBlur}
    >
      {MARKETING_CLASSES.map((cls, i) => {
        const pricing = PRICING[i];
        const isOpen = active === i;
        const featured = i === 0;
        return (
          <div
            key={cls.name}
            onMouseEnter={() => setActive(i)}
            // No h-full here on purpose: with items-start on the grid, each
            // card's height should follow its own content so expanding one
            // card's description doesn't stretch its neighbours to match.
            className={`group relative flex flex-col overflow-hidden rounded-2xl border transition-[transform,border-color,box-shadow] duration-200 ${
              isOpen ? "-translate-y-1" : ""
            } ${
              featured
                ? "border-primary/40 bg-primary/[0.06] shadow-[0_20px_50px_-16px_var(--accent-glow)]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-primary/30"
            }`}
          >
            <div className="relative">
              <ClassImageSlot seed={cls.name} label={cls.name} className="h-32 w-full" />
              {featured ? (
                <span className="absolute left-4 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-condensed absolute inset-x-4 bottom-2.5 text-xl uppercase leading-none text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
                {cls.name}
              </h3>
            </div>

            <div className="flex flex-1 flex-col p-5">
              {/* Expanded description: open state OR (desktop) the shared
                  active index. Grid-rows trick animates height without
                  measuring — same technique used across the marketing
                  pages' other expandable cards. */}
              <div
                id={`pricing-desc-${i}`}
                className={`grid overflow-hidden text-sm leading-relaxed text-zinc-400 transition-[grid-template-rows,opacity,margin] duration-200 ${
                  isOpen ? "mb-2 [grid-template-rows:1fr] opacity-100" : "[grid-template-rows:0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 overflow-hidden">{cls.description}</div>
              </div>

              {/* Explicit toggle — the touch/keyboard path (also visible on desktop) */}
              <button
                type="button"
                onFocus={() => setActive(i)}
                onClick={() => setActive(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`pricing-desc-${i}`}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium uppercase tracking-wide text-primary transition-colors hover:text-[var(--primary-hover)]"
              >
                {isOpen ? "Less" : "Details"}
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                >
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-xs uppercase tracking-wide text-zinc-500">from</span>
                <span className="text-condensed text-[30px] leading-none text-zinc-50 tabular-nums">
                  {pricing.priceLabel}
                </span>
                <span className="text-sm text-zinc-500">{pricing.cadence}</span>
              </p>

              <Link
                href={href}
                className={`mt-4 rounded-lg py-2.5 text-center text-sm font-semibold uppercase tracking-wide transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px ${
                  featured
                    ? "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]"
                    : "border border-white/[0.12] bg-white/[0.04] text-zinc-200 hover:border-primary/40 hover:bg-white/[0.07] hover:text-white"
                }`}
              >
                Get started
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
