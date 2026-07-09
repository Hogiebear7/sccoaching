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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.1] bg-zinc-950/95 pb-safe shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:hidden">
      <ul className="relative mx-auto flex max-w-2xl items-stretch">
        {/* Sliding active indicator — a blue instrument bar along the top edge. */}
        {activeIdx >= 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-px h-[2px] rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)] transition-[left] duration-200 ease-out"
            style={{
              left: `calc(${activeIdx * slotPct}% + ${slotPct / 4}%)`,
              width: `${slotPct / 2}%`,
            }}
          />
        )}
        {TABS.map(({ label, href, exact }, idx) => {
          const active = idx === activeIdx;
          void exact;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 px-2 pb-2 pt-2.5 text-[9px] uppercase tracking-[0.1em] transition-[color,transform] duration-150 active:scale-95 ${
                  active
                    ? "font-bold text-blue-300"
                    : "font-semibold text-zinc-500 hover:text-zinc-300"
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
