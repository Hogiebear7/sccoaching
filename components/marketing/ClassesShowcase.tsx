"use client";

import { useState } from "react";
import type { FocusEvent } from "react";

import { MARKETING_CLASSES as CLASSES } from "@/lib/marketing-classes";

// Curated services panel — replaces the old literal weekly timetable.
//  - lg+ (hover-capable): the panel only shows a description while a class
//    is actually being pointed at or focused — leaving the list clears it,
//    so the photo gets full attention between interactions. Tracked via
//    onMouseLeave/onBlur on the shared list container (not per-button) so
//    moving between adjacent items doesn't flicker empty in between.
//  - below lg (touch): no hover-out exists on touch, so tapping opens a
//    class's description as a per-item accordion (same grid-template-rows
//    technique as FeaturedClassCard) and it stays open until another item
//    is tapped.
// Real <button> elements throughout, so keyboard users get the same
// interaction for free (Tab moves focus → onFocus updates state; Enter/
// Space activates); the global :focus-visible outline (globals.css) covers
// the visible focus state.
export function ClassesShowcase({ imageUrl, imageAlt }: { imageUrl: string; imageAlt: string }) {
  const [active, setActive] = useState<number | null>(null);

  function handleListBlur(e: FocusEvent<HTMLUListElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setActive(null);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08]">
      {/* Background photo, full-bleed behind the whole panel */}
      <div className="absolute inset-0" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={imageAlt} className="h-full w-full object-cover" />
        {/* Mobile: one uniform (but light) tint — text spans the full width,
            so it needs even legibility everywhere. Desktop: a lighter touch
            still, heavier only directly behind the list text and easing off
            fast so the photo reads clearly; the description panel carries
            its own frosted scrim (below), so this layer doesn't need to
            carry contrast for it. */}
        <div className="absolute inset-0 bg-[var(--surface-1)]/55 lg:bg-gradient-to-r lg:from-[var(--surface-1)]/80 lg:via-[var(--surface-1)]/45 lg:to-[var(--surface-1)]/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" />
      </div>

      <div className="relative grid gap-1 p-8 sm:p-12 lg:min-h-[480px] lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:p-16">
        <ul
          className="flex flex-col"
          onMouseLeave={() => setActive(null)}
          onBlur={handleListBlur}
        >
          {CLASSES.map((cls, i) => {
            const isActive = i === active;
            return (
              <li key={cls.name} className={i > 0 ? "border-t border-white/[0.07]" : ""}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  aria-expanded={isActive}
                  aria-controls={`class-desc-${i}`}
                  className="group flex w-full items-baseline gap-4 py-5 text-left"
                >
                  <span
                    aria-hidden
                    className={`h-px shrink-0 bg-primary transition-all duration-300 ${
                      isActive ? "w-8 opacity-100" : "w-3 opacity-40 group-hover:opacity-70"
                    }`}
                  />
                  <span
                    className={`text-editorial text-[24px] leading-tight transition-colors duration-200 sm:text-[28px] ${
                      isActive ? "text-zinc-50" : "text-zinc-500 group-hover:text-zinc-300"
                    }`}
                  >
                    {cls.name}
                  </span>
                </button>

                {/* Touch/narrow-screen accordion — the lg panel takes over above that breakpoint */}
                <div
                  id={`class-desc-${i}`}
                  className={`grid overflow-hidden pl-[2.75rem] text-sm leading-relaxed text-zinc-300 transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden ${
                    isActive ? "[grid-template-rows:1fr] opacity-100" : "[grid-template-rows:0fr] opacity-0"
                  }`}
                >
                  <p className="min-h-0 overflow-hidden pb-4">{cls.description}</p>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Desktop panel — only rendered while a class is active, so the
            photo shows unobstructed the rest of the time. The frosted scrim
            guarantees contrast regardless of what's behind it. */}
        <div className="hidden lg:block">
          {active !== null ? (
            <div
              key={active}
              className="anim-fade max-w-md rounded-xl bg-[var(--surface-1)]/60 p-7 backdrop-blur-md"
            >
              <p className="text-lg leading-relaxed text-zinc-100">{CLASSES[active].description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
