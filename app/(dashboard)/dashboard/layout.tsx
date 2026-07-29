import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { findProfileByUserId, findUnreadNotificationCount, findUserById } from "@/lib/db";
import { isStaffRole } from "@/lib/permissions";
import { verifySession } from "@/lib/session";
import { PushServiceWorkerRegister } from "@/components/PushServiceWorkerRegister";
import { NavLink } from "./nav-link";
import { BottomNavBar } from "./bottom-nav";

type DashboardLayoutProps = {
  children: ReactNode;
};

const TRAINING_NAV_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Workouts", href: "/dashboard/workouts" },
  { label: "Recovery", href: "/dashboard/recovery" },
  { label: "Nutrition", href: "/dashboard/nutrition" },
];

const CLUB_NAV_ITEMS = [
  { label: "Schedule", href: "/dashboard/schedule" },
  { label: "Bookings", href: "/dashboard/bookings" },
  { label: "Membership", href: "/dashboard/membership" },
  { label: "Messages", href: "/dashboard/messages" },
];

const ACCOUNT_NAV_ITEMS = [
  { label: "Profile", href: "/dashboard/profile" },
  { label: "Settings", href: "/dashboard/settings" },
];

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const unreadNotifications = user ? findUnreadNotificationCount(user.id) : 0;

  // Programme is a coach-enabled feature: hidden entirely unless staff have
  // switched it on for this member. Route access is guarded server-side too.
  const trainingItems = [
    TRAINING_NAV_ITEMS[0],
    ...(profile?.programmeEnabled ? [{ label: "Programme", href: "/dashboard/programme" }] : []),
    ...TRAINING_NAV_ITEMS.slice(1),
    ...(profile?.cycleTrackingEligible ? [{ label: "Cycle", href: "/dashboard/cycle" }] : []),
  ];

  const navGroups = [
    { title: "Training", items: trainingItems },
    { title: "Club", items: CLUB_NAV_ITEMS },
    { title: "Account", items: ACCOUNT_NAV_ITEMS },
  ];

  const initials = (profile?.fullName ?? user?.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const avatarUrl = profile?.avatarDataUrl ?? null;
  // Member-facing default is the athletic electric-lime / onyx look. The old
  // auto-assigned defaults ("teal"/"midnight") weren't deliberate member
  // choices, so they resolve to the new default too; any explicit non-default
  // pick (ocean, violet, forest, …) is honoured. Staff surfaces don't set
  // these attributes at all, so they keep the :root teal.
  const palette =
    profile?.palette && profile.palette !== "teal" ? profile.palette : "electric";
  const theme =
    profile?.theme && profile.theme !== "midnight" ? profile.theme : "onyx";

  return (
    <div className="min-h-screen text-foreground" data-palette={palette} data-theme={theme}>
      <div className="grid min-h-screen lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="hidden border-r border-white/[0.06] bg-[oklch(0.155_0.004_255/0.72)] backdrop-blur-xl lg:flex lg:h-screen lg:flex-col lg:sticky lg:top-0">
          <div className="px-5 pt-6 pb-5">
            <Link href="/dashboard" className="text-display text-lg text-zinc-50">
              S<span className="text-teal-400">&</span>C
            </Link>
            <p className="label-caps mt-1.5 text-[10px]">Performance Coaching</p>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
            {navGroups.map((group) => (
              <div key={group.title}>
                <p className="label-caps px-3 pb-2 text-[10px]">{group.title}</p>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink href={item.href}>{item.label}</NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="px-3 pb-4">
            <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              {avatarUrl ? (
                <div
                  aria-hidden="true"
                  className="h-8 w-8 flex-shrink-0 rounded-full bg-cover bg-center ring-1 ring-white/15"
                  style={{ backgroundImage: `url(${avatarUrl})` }}
                />
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-500 text-[11px] font-semibold text-white ring-1 ring-white/15">
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium leading-tight text-zinc-200">
                  {profile?.fullName ?? "Signed in"}
                </p>
                <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-500">
                  {user?.email ?? "Unknown account"}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          {/* Utility header */}
          <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/70 px-4 backdrop-blur-md sm:px-6">
            <div className="flex h-16 items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-display text-base text-zinc-50 lg:hidden">
                  S<span className="text-teal-400">&</span>C
                  <span className="hidden min-[420px]:inline"> Performance Coaching</span>
                </span>
                <p className="hidden text-sm text-zinc-400 lg:block">
                  Welcome back{profile?.fullName ? `, ${profile.fullName.split(" ")[0]}` : ""}.
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                <Link
                  href="/dashboard/notifications"
                  aria-label={
                    unreadNotifications > 0
                      ? `Notifications — ${unreadNotifications} unread`
                      : "Notifications"
                  }
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-[18px] w-[18px]"
                  >
                    <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadNotifications > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground tabular-nums">
                      {unreadNotifications > 9 ? "9+" : unreadNotifications}
                    </span>
                  ) : null}
                </Link>

                <Link
                  href="/dashboard/settings"
                  aria-label="Settings"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-[18px] w-[18px]"
                  >
                    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </Link>

                {isStaffRole(user?.role) ? (
                  <Link
                    href="/staff/classes"
                    className="hidden rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100 sm:block"
                  >
                    Staff area
                  </Link>
                ) : null}

                <form action="/api/auth/logout" method="POST">
                  <button
                    type="submit"
                    className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    Log out
                  </button>
                </form>

                <Link
                  href="/dashboard/profile"
                  aria-label="Edit profile"
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-1 ring-white/15 transition-transform duration-150 active:scale-95 lg:hidden ${
                    avatarUrl ? "bg-cover bg-center" : "bg-teal-500"
                  }`}
                  style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                >
                  {avatarUrl ? null : initials}
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-nav-safe sm:px-6 lg:pb-10">
            {children}
          </main>
        </div>
      </div>
      <BottomNavBar />
      <PushServiceWorkerRegister />
    </div>
  );
}
