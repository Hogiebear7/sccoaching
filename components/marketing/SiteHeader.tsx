"use client";

import Link from "next/link";
import { useRef } from "react";

import { AUTH_ROUTES } from "@/lib/content";
import { HOME_NAV } from "@/lib/homepage-content";

// Slim, opaque sticky bar (no glass): logo, section links, a quiet member
// login and one primary action. Below lg the links and login move into a
// native <details> menu (works without JavaScript); with JS, choosing a
// link also closes the menu.
export function SiteHeader() {
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => menu.current?.removeAttribute("open");

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[var(--bg-0)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6 lg:h-[72px]">
        <Link href="/" aria-label="S&C Performance Coaching, home" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
          <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-9 w-auto lg:h-11" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {HOME_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-zinc-300 transition-colors duration-150 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href={AUTH_ROUTES.login}
            className="hidden whitespace-nowrap px-2 py-2 text-sm font-medium text-zinc-400 transition-colors duration-150 hover:text-white sm:inline-flex"
          >
            Member login
          </Link>
          <a
            href="#contact"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-[3px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
          >
            Book a session
          </a>

          <details ref={menu} className="group relative lg:hidden">
            <summary
              aria-label="Menu"
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[3px] border border-white/[0.14] text-zinc-200 [&::-webkit-details-marker]:hidden"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className="h-5 w-5">
                <path d="M3 6h14M3 10h14M3 14h14" className="group-open:hidden" />
                <path d="M5 5l10 10M15 5L5 15" className="hidden group-open:block" />
              </svg>
            </summary>
            <div className="details-reveal absolute right-0 mt-3 w-60 rounded-[4px] border border-white/[0.1] bg-[var(--surface-1)] p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]">
              {HOME_NAV.map((item) => (
                <a key={item.href} href={item.href} onClick={closeMenu} className="block rounded-[3px] px-3 py-3 text-base text-zinc-200 hover:bg-white/[0.05]">
                  {item.label}
                </a>
              ))}
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
