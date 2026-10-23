import Link from "next/link";
import type { ReactNode } from "react";

import { STATIC_HAZE } from "./haze";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

// Building blocks for the public inner pages (/classes, /about, /contact,
// /faq), so they share the homepage's frame, type scale and buttons. See
// DESIGN.md "Website pages".

export const SECTION = "mx-auto max-w-6xl px-6 py-24 lg:py-32";
export const H2 = "text-headline text-[44px] sm:text-[60px]";
export const BUTTON_PRIMARY =
  "group inline-flex h-12 items-center justify-center gap-2 rounded-[3px] bg-primary px-7 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px";
export const BUTTON_SECONDARY =
  "inline-flex h-12 items-center justify-center rounded-[3px] border border-white/[0.16] px-7 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/50 hover:text-white";

export function MarketingPage({ children }: { children: ReactNode }) {
  return (
    <main data-palette="gold" data-theme="navy" className="relative min-h-screen overflow-hidden text-zinc-100">
      {/* Static haze only: the animated haze is reserved for the homepage hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]"
        style={STATIC_HAZE}
      />
      <SiteHeader />
      {children}
      <SiteFooter />
    </main>
  );
}

export function SectionLabel({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "ivory" }) {
  const ivory = tone === "ivory";
  return (
    <p
      className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] ${
        ivory ? "text-[#8a6a2f]" : "text-gold"
      }`}
    >
      <span className={`h-px w-8 ${ivory ? "bg-[#8a6a2f]" : "bg-primary/70"}`} />
      {children}
    </p>
  );
}

// Page opener: label, Teko H1 (optional gold second half) and one supporting
// sentence; `children` sits under it (actions or quick links).
export function PageIntro({
  label,
  title,
  accent,
  intro,
  children,
}: {
  label: string;
  title: string;
  accent?: string;
  intro: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-16 pt-14 lg:pb-20 lg:pt-24">
      <div className="anim-rise" style={{ animationDelay: "40ms" }}>
        <SectionLabel>{label}</SectionLabel>
      </div>
      <h1 className="anim-rise mt-5 max-w-4xl text-headline text-[56px] text-zinc-50 sm:text-[84px]" style={{ animationDelay: "80ms" }}>
        {title}
        {accent ? (
          <>
            {" "}
            <em className="not-italic text-gold">{accent}</em>
          </>
        ) : null}
      </h1>
      <p className="anim-rise mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl" style={{ animationDelay: "140ms" }}>
        {intro}
      </p>
      {children ? (
        <div className="anim-rise mt-10" style={{ animationDelay: "200ms" }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

// Closing call to action at the foot of an inner page.
export function CtaBand({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-20 lg:flex-row lg:items-end lg:justify-between lg:py-24">
        <div className="max-w-xl">
          <h2 className={`${H2} text-zinc-50`}>{title}</h2>
          <p className="mt-5 text-lg leading-relaxed text-zinc-300">{body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={primary.href} className={BUTTON_PRIMARY}>
            {primary.label}
            <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
          </Link>
          {secondary ? (
            <Link href={secondary.href} className={BUTTON_SECONDARY}>
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
