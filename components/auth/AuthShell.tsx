import Link from "next/link";
import type { ReactNode } from "react";

import { STATIC_HAZE } from "@/components/marketing/haze";
import { HOME_HERO } from "@/lib/homepage-content";

// Frame for the member auth screens (/login, /forgot-password), in the public
// website's system: opaque navy, Teko headline, flat 3px controls. On wide
// screens a quiet photo panel shows S&C's own training floor with the brand
// line; on phones it collapses to a slim top bar so the form comes first.
// See DESIGN.md "Member sign-in".
export function AuthShell({
  label,
  title,
  intro,
  children,
  footer,
}: {
  label: string;
  title: string;
  intro: string;
  children: ReactNode;
  /** Secondary routes under the form (create account, back to sign in). */
  footer?: ReactNode;
}) {
  return (
    <main data-theme="navy" data-palette="gold" className="relative min-h-screen text-zinc-100 lg:grid lg:grid-cols-[1fr_minmax(520px,0.9fr)]">
      {/* Photo panel — wide screens only. */}
      <aside className="relative hidden overflow-hidden border-r border-white/[0.06] lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- static marketing photo with fixed dimensions */}
        <img
          src={HOME_HERO.image.src}
          alt=""
          width={2048}
          height={779}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(10_21_38/0.55)_0%,rgb(10_21_38/0.35)_40%,rgb(5_12_24/0.92)_100%)]" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" aria-label="S&C Performance Coaching, home" className="self-start transition-opacity duration-150 hover:opacity-80">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
            <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-14 w-auto" />
          </Link>
          <div>
            <p className="text-headline text-[64px] text-zinc-50">
              {HOME_HERO.headline.lead} <em className="not-italic text-gold">{HOME_HERO.headline.accent}</em>
            </p>
            <p className="mt-3 text-sm text-zinc-300">{HOME_HERO.image.caption}</p>
          </div>
        </div>
      </aside>

      {/* Form column */}
      <div className="relative flex min-h-screen flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]" style={STATIC_HAZE} />

        <header className="relative flex h-16 items-center justify-between px-6 lg:h-[72px] lg:px-12">
          <Link href="/" aria-label="S&C Performance Coaching, home" className="flex h-11 items-center transition-opacity duration-150 hover:opacity-80 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
            <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-9 w-auto" />
          </Link>
          <Link
            href="/"
            className="group ml-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors duration-150 hover:text-white"
          >
            <span aria-hidden className="transition-transform duration-150 group-hover:-translate-x-0.5">←</span>
            Back to website
          </Link>
        </header>

        <div className="relative flex flex-1 items-center px-6 pb-16 pt-6 lg:px-12">
          <div className="anim-rise mx-auto w-full max-w-[400px]">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              {label}
            </p>
            <h1 className="mt-4 text-headline text-[52px] text-zinc-50 sm:text-[60px]">{title}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-300">{intro}</p>

            <div className="mt-10">{children}</div>

            {footer ? <div className="mt-10 border-t border-white/[0.08] pt-6">{footer}</div> : null}
          </div>
        </div>

        <div className="relative px-6 pb-3 lg:px-12">
          <p className="mx-auto w-full max-w-[400px] text-xs text-zinc-500">
            <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors duration-150 hover:text-gold">Privacy</Link>
            <span aria-hidden className="mx-2">·</span>
            <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors duration-150 hover:text-gold">Terms</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
