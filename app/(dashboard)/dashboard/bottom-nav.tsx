"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Home",      href: "/dashboard",           exact: true  },
  { label: "Schedule",  href: "/dashboard/schedule",  exact: false },
  { label: "Workouts",  href: "/dashboard/workouts",  exact: false },
  { label: "Recovery",  href: "/dashboard/recovery",  exact: false },
  // Profile lives in the top-right avatar; messages in the top bar.
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

// Phone tab bar: full-width, opaque navy, a hairline on top. The current tab
// is gold (icon, label and a 2px bar along its top edge); the rest are quiet.
// No floating capsule, blur or glow.
export function BottomNavBar() {
  const pathname = usePathname();
  const activeIdx = TABS.findIndex(({ href, exact }) =>
    exact ? pathname === href : pathname.startsWith(href)
  );

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[var(--sidebar)] pb-safe lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map(({ label, href }, idx) => {
          const active = idx === activeIdx;
          return (
            <li key={href} className="relative flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors duration-150 ${
                  active ? "text-primary" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-4 top-0 h-[2px] bg-primary transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`}
                />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2 : 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-[22px] w-[22px]"
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
