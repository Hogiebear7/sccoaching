"use client";

import { useEffect, useState } from "react";

// Real in-app screenshots, one per bottom-tab screen — member-provided,
// status bar already cropped off. Order matches the app's own tab bar
// (Home, Schedule, Workouts, Recovery, Nutrition) so the grid reads as a
// tour of the app rather than an arbitrary selection. A 3-column grid with
// 5 items naturally lays out 3 on top, 2 underneath — no horizontal scroll,
// so there's nothing for the last card to get clipped by.
const APP_SCREENS: { src: string; alt: string; label: string; description: string }[] = [
  {
    src: "/marketing/app/home.jpg",
    alt: "App home screen showing next session, readiness score, and today's nutrition prompt",
    label: "Home",
    description: "Your day at a glance — next session, readiness score, and today's nutrition target.",
  },
  {
    src: "/marketing/app/schedule.jpg",
    alt: "App schedule screen showing a monthly class calendar with a booked session",
    label: "Schedule",
    description: "Browse classes, book your spot, and manage upcoming sessions from a simple calendar.",
  },
  {
    src: "/marketing/app/workouts.jpg",
    alt: "App workouts screen showing today's logged session and weekly training stats",
    label: "Workouts",
    description: "Log every session, track sets and volume, and see your training stats for the week.",
  },
  {
    src: "/marketing/app/recovery.jpg",
    alt: "App recovery screen showing a readiness score and a daily check-in form",
    label: "Recovery",
    description: "Log how you're feeling and get a readiness score that adapts your training to match.",
  },
  {
    src: "/marketing/app/nutrition.jpg",
    alt: "App nutrition screen showing today's calorie and macro progress and hydration tracking",
    label: "Nutrition",
    description: "Track calories, macros, and hydration against a target that adjusts with your training load.",
  },
];

type AppScreen = (typeof APP_SCREENS)[number];

// Plain rounded-rect device frame rather than a fake notch/camera cutout —
// the screenshots themselves already read clearly as a phone UI, so a
// heavier mockup would add visual noise without adding believability.
// Hovering (or focusing, for keyboard/touch users) fades in the
// description over the screenshot; clicking opens it full-size.
function PhoneFrame({ screen, onOpen }: { screen: AppScreen; onOpen: () => void }) {
  return (
    // Explicit per-row width (accounting for the container's gap-6) rather
    // than a grid — 2-up under sm:, 3-up above it, so a 5th item wraps to a
    // second row of 2. Paired with justify-center on the container, that
    // shorter last row centers itself instead of sitting left-aligned with
    // empty space on the right.
    <div className="w-[calc(50%-12px)] max-w-[220px] sm:w-[calc(33.333%-16px)]">
      <button
        type="button"
        onClick={onOpen}
        className="group relative block w-full overflow-hidden rounded-[22px] border border-white/[0.12] bg-black text-left shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={`Open a larger view of the ${screen.label} screen`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- real static screenshots, not a next/image-worthy asset */}
        <img src={screen.src} alt={screen.alt} className="block h-auto w-full" loading="lazy" />
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <p className="text-xs leading-relaxed text-zinc-100">{screen.description}</p>
        </div>
      </button>
      <p className="mt-3 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">{screen.label}</p>
    </div>
  );
}

// Full-size view of whichever screen was clicked — mirrors the app's
// existing modal convention (fixed inset-0 backdrop + click-outside-to-
// close, see components/member/ExerciseSearchModal.tsx) rather than
// inventing a new one.
function ScreenLightbox({ screen, onClose }: { screen: AppScreen; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${screen.label} screen, enlarged`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="max-h-full w-full max-w-sm overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="overflow-hidden rounded-[28px] border border-white/[0.14] bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screen.src} alt={screen.alt} className="block h-auto w-full" />
        </div>
        <div className="mt-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-50">{screen.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{screen.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-white/[0.14] p-2 text-zinc-400 transition-colors hover:border-white/[0.3] hover:text-zinc-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function AppScreensGrid() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-6">
        {APP_SCREENS.map((screen, i) => (
          <PhoneFrame key={screen.label} screen={screen} onOpen={() => setOpenIndex(i)} />
        ))}
      </div>
      {openIndex !== null ? <ScreenLightbox screen={APP_SCREENS[openIndex]} onClose={() => setOpenIndex(null)} /> : null}
    </>
  );
}

// Benefit copy for the app-only (Tier 2) subscription. Deliberately avoids
// naming the underlying tech (no "AI") — each line describes the outcome a
// member gets, matching the rest of the site's voice. Pricing is not shown
// here yet: no Tier 2 billing option exists in the catalog (see
// lib/db.ts DeliveryChannel/BillingChannel/AccessType), and this is
// placeholder marketing copy pending the client's confirmation, same as
// DIFFERENTIATORS in app/page.tsx.
const APP_BENEFITS = [
  {
    title: "A workout built for what you've got",
    body: "Tell it your equipment, your goals, and how long you have — get a full session ready to go, no scrolling through generic plans.",
  },
  {
    title: "A coach on call",
    body: "Ask a question, get a straight answer — day or night, without waiting on a reply.",
  },
  {
    title: "Log meals in seconds",
    body: "Snap a photo of your plate and it's logged — no searching food databases, no guessing portions.",
  },
  {
    title: "Targets that keep up with you",
    body: "Your calorie and macro targets adjust as your training load and progress change, not a fixed number you outgrow.",
  },
  {
    title: "Know what to do next",
    body: "Every session ends with a clear read on how it went and what to focus on next time.",
  },
  {
    title: "Everything in one place",
    body: "Training, nutrition, recovery, and progress — tracked and connected, not spread across five different apps.",
  },
] as const;

function BenefitIcon({ index }: { index: number }) {
  // One hand-drawn glyph per benefit, matching the site's existing inline-svg
  // convention (stroke 2, round caps/joins) rather than pulling in an icon
  // library.
  const paths = [
    // dumbbell
    "M4 9v6M20 9v6M7 7v10M17 7v10M9 12h6",
    // chat bubble
    "M4 5h16v11H8l-4 4V5Z",
    // camera
    "M4 8h3l1.5-2h7L17 8h3v11H4V8Z M12 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    // target/adapt (refresh arrows)
    "M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66 M17 4v4h-4 M7 20v-4h4",
    // clipboard check
    "M9 5H7a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2 M8 4h8v3H8V4Z M9 13l2 2 4-4",
    // layers
    "M12 4 3 9l9 5 9-5-9-5Z M3 14l9 5 9-5 M3 9l9 5 9-5",
  ];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5 text-gold">
      <path d={paths[index]} />
    </svg>
  );
}

// Store badges are placeholders only — no real listing exists yet (the app
// hasn't shipped a production build to either store). Deliberately not
// styled as the official Apple/Google trademarked badge artwork; swap the
// href (and, if wanted, real badge graphics) in once both listings are live.
function StoreBadge({ store }: { store: "apple" | "google" }) {
  const label = store === "apple" ? "App Store" : "Google Play";
  return (
    <span
      aria-disabled
      className="inline-flex items-center gap-2.5 rounded-[3px] border border-white/[0.14] bg-white/[0.03] px-4 py-2.5 text-zinc-400"
    >
      {store === "apple" ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5 flex-shrink-0">
          <path d="M16.365 1.43c0 1.14-.415 2.043-1.246 2.708-.831.665-1.782.968-2.85.91-.083-1.09.34-2.06 1.223-2.71.883-.65 1.86-.976 2.873-.908ZM20.1 17.05c-.34.79-.75 1.53-1.23 2.24-.66.98-1.35 1.96-2.44 1.98-1.07.02-1.42-.63-2.64-.63-1.22 0-1.6.61-2.62.65-1.05.04-1.85-1.06-2.52-2.03-1.36-1.98-2.4-5.6-1-8.05.7-1.22 1.94-1.99 3.29-2.01 1.03-.02 2 .7 2.62.7.62 0 1.79-.86 3.02-.73.51.02 1.96.21 2.89 1.55-2.5 1.55-2.1 4.6.62 6.32Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5 flex-shrink-0">
          <path d="M4.5 2.5c-.3.3-.5.7-.5 1.2v16.6c0 .5.2.9.5 1.2l9.3-9.5-9.3-9.5Z" />
          <path d="M16.8 8.7l-3-1.8-3.5 3.6 3.5 3.6 3-1.8c.9-.5.9-1.9 0-2.5-.9-.5-.9-1.5 0-2Z" opacity=".55" />
        </svg>
      )}
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-[0.08em] text-zinc-500">Coming soon on</span>
        <span className="block text-sm font-semibold text-zinc-200">{label}</span>
      </span>
    </span>
  );
}

export function AppShowcase() {
  return (
    <div>
      <AppScreensGrid />

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {APP_BENEFITS.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors duration-200 hover:border-primary/30"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <BenefitIcon index={APP_BENEFITS.indexOf(item)} />
            </span>
            <h3 className="mt-4 text-[15px] font-semibold text-zinc-50">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-start gap-4 border-t border-white/[0.08] pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-400">
          App-only membership — no gym visit required. <span className="text-zinc-300">Launching soon.</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <StoreBadge store="apple" />
          <StoreBadge store="google" />
        </div>
      </div>
    </div>
  );
}
