"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { AUTH_ROUTES } from "@/lib/content";
import { PRIMARY_CTA, SITE_NAV } from "@/lib/site-content";

// Slim, opaque sticky bar (no glass), shared by every public page: logo, page
// links, a quiet member login and one primary action. The current page's link
// is marked with aria-current and a gold underline. Below lg the links and
// login move into a native <details> menu (works without JavaScript); with
// JS, choosing a link also closes the menu.
export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => menu.current?.removeAttribute("open");
  const isCurrent = (href: string) => !href.includes("#") && pathname === href;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[var(--bg-0)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6 lg:h-[72px]">
        <Link href="/" aria-label="S&C Performance Coaching, home" className="flex h-11 shrink-0 items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
          <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-9 w-auto lg:h-11" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {SITE_NAV.map((item) => {
            const current = isCurrent(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center text-sm font-medium transition-colors duration-150 hover:text-white ${
                  current ? "text-white after:absolute after:inset-x-0 after:bottom-2 after:h-px after:bg-primary" : "text-zinc-300"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href={AUTH_ROUTES.login}
            className="hidden min-h-11 items-center whitespace-nowrap px-2 text-sm font-medium text-zinc-400 transition-colors duration-150 hover:text-white sm:inline-flex"
          >
            Member login
          </Link>
          <Link
            href={PRIMARY_CTA.href}
            className="inline-flex h-11 items-center whitespace-nowrap rounded-[3px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
          >
            {PRIMARY_CTA.label}
          </Link>

          <details ref={menu} className="group relative lg:hidden">
            <summary
              aria-label="Menu"
              className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-[3px] border border-white/[0.14] text-zinc-200 [&::-webkit-details-marker]:hidden"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className="h-5 w-5">
                <path d="M3 6h14M3 10h14M3 14h14" className="group-open:hidden" />
                <path d="M5 5l10 10M15 5L5 15" className="hidden group-open:block" />
              </svg>
            </summary>
            <div className="details-reveal absolute right-0 mt-3 w-60 rounded-[4px] border border-white/[0.1] bg-[var(--surface-1)] p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]">
              {SITE_NAV.map((item) => {
                const current = isCurrent(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenu}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-[3px] px-3 py-3 text-base hover:bg-white/[0.05] ${
                      current ? "border-l-2 border-primary text-white" : "text-zinc-200"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="my-2 h-px bg-white/[0.08]" />
              <Link href={AUTH_ROUTES.login} className="block rounded-[3px] px-3 py-3 text-base text-zinc-200 hover:bg-white/[0.05]">
                Member login
              </Link>
              <Link href={AUTH_ROUTES.signup} className="block rounded-[3px] px-3 py-3 text-base text-zinc-200 hover:bg-white/[0.05]">
                Create an account
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
