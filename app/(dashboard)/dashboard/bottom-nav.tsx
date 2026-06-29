"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Home",     href: "/dashboard",          exact: true  },
  { label: "Schedule", href: "/dashboard/schedule",  exact: false },
  { label: "Workouts", href: "/dashboard/workouts",  exact: false },
  { label: "Recovery", href: "/dashboard/recovery",  exact: false },
  { label: "Profile",  href: "/dashboard/profile",   exact: false },
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
  Profile:
    "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

export function BottomNavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md lg:hidden">
      <ul className="flex max-w-2xl mx-auto pb-safe">
        {TABS.map(({ label, href, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 px-1 py-3 text-[10px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.4 : 1.8}
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
