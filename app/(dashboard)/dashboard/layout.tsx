import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { findProfileByUserId, findUserById } from "@/lib/db";
import { BRAND_NAME } from "@/lib/content";
import { verifySession } from "@/lib/session";
import { NavLink } from "./nav-link";
import { BottomNavBar } from "./bottom-nav";

type DashboardLayoutProps = {
  children: ReactNode;
};

const BASE_NAV_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Profile", href: "/dashboard/profile" },
  { label: "Programme", href: "/dashboard/programme" },
  { label: "Workouts", href: "/dashboard/workouts" },
  { label: "Recovery", href: "/dashboard/recovery" },
];

const TAIL_NAV_ITEMS = [
  { label: "Schedule", href: "/dashboard/schedule" },
  { label: "Bookings", href: "/dashboard/bookings" },
  { label: "Membership", href: "/dashboard/membership" },
  { label: "Messages", href: "/dashboard/messages" },
];

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(profile?.cycleTrackingEligible ? [{ label: "Cycle", href: "/dashboard/cycle" }] : []),
    ...TAIL_NAV_ITEMS,
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden border-zinc-800 bg-zinc-950 lg:block lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-zinc-800 px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                {BRAND_NAME}
              </p>
              <h1 className="mt-3 text-xl font-semibold text-zinc-50">
                Dashboard
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Your training hub — profile, training, and bookings in one place.
              </p>
            </div>

            <nav className="flex-1 px-4 py-4">
              <ul className="space-y-2">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="border-t border-zinc-800 px-4 py-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm font-medium text-zinc-100">
                  {profile?.fullName ?? "Signed in"}
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  {user?.email ?? "Unknown account"}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="border-b border-zinc-800 bg-zinc-900/80 px-4 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Athlete Portal
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Welcome back{profile?.fullName ? `, ${profile.fullName}` : ""}.
                </p>
              </div>

              <div className="flex gap-3">
                <Link
                  href="/dashboard/profile"
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
                >
                  Edit profile
                </Link>
                {user?.role === "staff" ? (
                  <Link
                    href="/staff/classes"
                    className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
                  >
                    Staff area
                  </Link>
                ) : null}
                <form action="/api/auth/logout" method="POST">
                  <button
                    type="submit"
                    className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400"
                  >
                    Log out
                  </button>
                </form>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 pt-6 pb-nav-safe sm:px-6 lg:pb-6 max-w-2xl w-full mx-auto">{children}</main>
        </div>
      </div>
      <BottomNavBar />
    </div>
  );
}
