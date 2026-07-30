"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { ClassImageSlot } from "@/components/ui/ClassImageSlot";

// Image-forward membership/class card for the landing page.
//
// Touch-safe reveal model:
//  - The TEASER is always visible (mobile users never miss it).
//  - The full description expands via an explicit button (works for tap, mouse
//    click, and keyboard) with aria-expanded + aria-controls.
//  - Desktop (hover-capable pointers only, via @media(hover:hover)) ALSO reveals
//    on hover as a refinement — but nothing depends on hover: touch and keyboard
//    reach the same content through the button.
export function FeaturedClassCard({
  seed,
  name,
  teaser,
  detail,
  priceLabel,
  cadence,
  featured,
  href,
  imageUrl,
  imageAlt,
}: {
  seed: string;
  name: string;
  teaser: string | null;
  detail: string | null;
  priceLabel: string;
  cadence: string | null;
  featured: boolean;
  href: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 ${
        featured
          ? "border-primary/40 bg-primary/[0.06] shadow-[0_20px_50px_-16px_var(--accent-glow)]"
          : "border-white/[0.08] bg-white/[0.02] hover:border-primary/30"
      }`}
    >
      {/* Image-led header */}
      <div className="relative">
        <ClassImageSlot seed={seed} label={name} imageUrl={imageUrl} alt={imageAlt} className="h-32 w-full" />
        {featured && (
          <span className="absolute left-4 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
            Most popular
          </span>
        )}
        {/* Title overlaid on the image for the editorial look */}
        <h3 className="text-condensed absolute inset-x-4 bottom-2.5 text-xl uppercase leading-none text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
          {name}
        </h3>
      </div>

      <div className="flex flex-1 flex-col p-5">
        {/* Teaser — always visible */}
        {teaser ? (
          <p className="text-sm leading-relaxed text-zinc-400">{teaser}</p>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-500">Coach messaging, class booking, and full workout tracking.</p>
        )}

        {/* Expanded description: open state OR (desktop) hover. Grid-rows trick
            animates height without measuring. */}
        <div
          id={detailId}
          className={`grid overflow-hidden text-sm leading-relaxed text-zinc-400 transition-[grid-template-rows,opacity,margin] duration-200 [grid-template-rows:0fr] opacity-0 [@media(hover:hover)]:group-hover:mt-2 [@media(hover:hover)]:group-hover:[grid-template-rows:1fr] [@media(hover:hover)]:group-hover:opacity-100 ${
            open ? "mt-2 [grid-template-rows:1fr] opacity-100" : ""
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            {detail ?? "Includes coach messaging, class booking, and full workout tracking — everything to train with intent."}
          </div>
        </div>

        {/* Explicit toggle — the touch/keyboard path (also visible on desktop) */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex w-fit items-center gap-1 text-xs font-medium uppercase tracking-wide text-primary transition-colors hover:text-[var(--primary-hover)]"
        >
          {open ? "Less" : "Details"}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        <p className="mt-4 flex items-baseline gap-1.5">
          <span className="text-xs uppercase tracking-wide text-zinc-500">from</span>
          <span className="text-condensed text-[30px] leading-none text-zinc-50 tabular-nums">{priceLabel}</span>
          {cadence ? <span className="text-sm text-zinc-500">{cadence}</span> : null}
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
}
