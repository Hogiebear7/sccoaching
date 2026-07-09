"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Home",      href: "/dashboard",           exact: true  },
  { label: "Schedule",  href: "/dashboard/schedule",  exact: false },
  { label: "Workouts",  href: "/dashboard/workouts",  exact: false },
  { label: "Recovery",  href: "/dashboard/recovery",  exact: false },
  // Profile moved out of the dock — it lives in the top-right avatar.
  { label: "Nutrition", href: "/dashboard/nutrition", exact: false },
] as const;

const ICON_PATHS: Record<string, string> = {
  Home:
    "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  Schedule:
    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  Workouts:
    "M13 10V3L4 14h7v7l9-11h-7z",
  Recovery:
    "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  Nutrition:
    "M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.657 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657zM9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z",
};

export function BottomNavBar() {
  const pathname = usePathname();
  const activeIdx = TABS.findIndex(({ href, exact }) =>
    exact ? pathname === href : pathname.startsWith(href)
  );
  const slotPct = 100 / TABS.length;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-safe lg:hidden">
      <ul className="relative mx-auto mb-3 flex max-w-2xl items-center rounded-2xl border border-white/[0.1] bg-zinc-950/90 px-1 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.35),0_20px_56px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
        {/* Sliding active pill — glides between equal-width slots. */}
        {activeIdx >= 0 && (
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 top-1.5 rounded-xl bg-blue-400/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)] transition-[left] duration-200 ease-out"
            style={{
              left: `calc(0.25rem + ${activeIdx * slotPct}% - ${activeIdx * 0.1}rem)`,
              width: `calc(${slotPct}% - 0.4rem)`,
            }}
          />
        )}
        {TABS.map(({ label, href, exact }, idx) => {
          const active = idx === activeIdx;
          void exact;
          return (
            <li key={href} className="relative z-10 flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] transition-[color,transform] duration-150 active:scale-95 ${
                  active
                    ? "font-semibold text-blue-300"
                    : "font-medium text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d={ICON_PATHS[label]} />
                </svg>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
