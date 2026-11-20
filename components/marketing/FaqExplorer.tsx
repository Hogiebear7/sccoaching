"use client";

import { useEffect, useRef, useState } from "react";

import { Accordion } from "@/components/marketing/FaqSection";
import type { FaqGroup } from "@/lib/faq-content";

const FADE_MS = 180;

// The /faq page body: a topic list on the left (a row of pills on a phone) and only the chosen topic's questions on the right. Picking
// another topic fades the current questions out and the new ones in (instantly for reduced motion). A link like /faq#the-app opens that
// topic on load.
export function FaqExplorer({ groups }: { groups: readonly FaqGroup[] }) {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const select = (index: number) => {
    if (index === active) return;
    if (timer.current) clearTimeout(timer.current);
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant) {
      setActive(index);
      return;
    }
    setVisible(false);
    timer.current = setTimeout(() => {
      setActive(index);
      setVisible(true);
    }, FADE_MS);
  };

  useEffect(() => {
    const fromHash = () => {
      const index = groups.findIndex((g) => `#${g.id}` === window.location.hash);
      if (index >= 0) setActive(index);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [groups]);

  const group = groups[active];

  return (
    <section className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-24 lg:grid-cols-[0.55fr_1.45fr] lg:gap-20 lg:pb-32">
      <div role="tablist" aria-label="FAQ topics" aria-orientation="vertical" className="flex flex-wrap gap-2 lg:sticky lg:top-28 lg:grid lg:gap-1 lg:self-start">
        {groups.map((g, i) => {
          const isActive = i === active;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              id={`faq-tab-${g.id}`}
              aria-selected={isActive}
              aria-controls="faq-panel"
              onClick={() => select(i)}
              className={`inline-flex min-h-11 items-center rounded-[3px] border px-4 text-left text-sm font-medium transition-colors duration-150 lg:w-full lg:rounded-none lg:border-0 lg:border-l-2 ${
                isActive
                  ? "border-primary bg-primary/10 text-white lg:bg-transparent"
                  : "border-white/[0.12] text-zinc-300 hover:border-primary/50 hover:text-white lg:border-white/[0.1] lg:hover:border-primary"
              }`}
            >
              {g.title}
            </button>
          );
        })}
      </div>

      <div
        id="faq-panel"
        role="tabpanel"
        aria-labelledby={`faq-tab-${group.id}`}
        className={`transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none lg:min-h-[26rem] ${
          visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <h3 className="text-headline text-[28px] text-gold">{group.title}</h3>
        <div className="mt-4">
          <Accordion key={group.id} items={group.items} idPrefix={`faq-${group.id}`} defaultOpen={0} />
        </div>
      </div>
    </section>
  );
}
