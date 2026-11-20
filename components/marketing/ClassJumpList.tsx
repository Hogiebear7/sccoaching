"use client";

import type { MouseEvent } from "react";

import { HeadlineText } from "@/components/ui/HeadlineText";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";

// The "Which sounds like you?" row on /classes. Choosing a class glides down the page to its own section (each section is at least a
// screen tall, so the neighbouring classes stay out of view). Reduced-motion visitors jump instead; without JavaScript the plain
// #anchor link still works.
export function ClassJumpList() {
  const jump = (event: MouseEvent<HTMLAnchorElement>, slug: string) => {
    const target = document.getElementById(slug);
    if (!target) return;
    event.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${slug}`);
  };

  return (
    <ul className="mt-4 grid gap-3 lg:grid-cols-3">
      {MARKETING_CLASSES.map((cls) => (
        <li key={cls.slug}>
          <a
            href={`#${cls.slug}`}
            onClick={(event) => jump(event, cls.slug)}
            className="group flex h-full items-start justify-between gap-4 rounded-[4px] border border-white/[0.1] bg-[var(--surface-1)] p-5 transition-colors duration-150 hover:border-primary/40"
          >
            <span>
              <span className="block text-headline text-[26px] text-zinc-50">
                <HeadlineText text={cls.name} />
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{cls.forWho[0]}</span>
            </span>
            <span aria-hidden className="mt-1 text-gold transition-transform duration-150 group-hover:translate-y-0.5">↓</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
