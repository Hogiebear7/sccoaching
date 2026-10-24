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
  { label: "Exercise Library", href: "/dashboard/exercise-library" },
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
  { label: "Notifications", href: "/dashboard/notifications" },
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
  // Member-facing default is the navy/gold editorial look. The old
  // auto-assigned defaults ("teal"/"midnight") weren't deliberate member
  // choices, so they resolve to the new default too; any explicit non-default
  // pick (ocean, violet, forest, …) is honoured. Staff surfaces don't set
  // these attributes at all, so they keep the :root teal.
  const palette =
    profile?.palette && profile.palette !== "teal" ? profile.palette : "gold";
  const theme =
    profile?.theme && profile.theme !== "midnight" ? profile.theme : "navy";

  const firstName = profile?.fullName?.split(" ")[0] ?? null;
  const staff = isStaffRole(user?.role);

  return (
    // data-member-app scopes the member-app recipe overrides in globals.css.
    <div data-member-app="" className="min-h-screen text-foreground" data-palette={palette} data-theme={theme}>
      <div className="grid min-h-screen lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Sidebar (desktop): solid navy, grouped links with a gold rule on
            the current page, the member's card and log out below. */}
        <aside className="hidden border-r border-white/[0.06] bg-[var(--sidebar)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="px-6 pb-6 pt-7">
            <Link href="/dashboard" aria-label="S&C Performance Coaching, home" className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
              <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-11 w-auto" />
            </Link>
          </div>

          <nav aria-label="Member" className="flex-1 space-y-7 overflow-y-auto py-2">
            {navGroups.map((group) => (
              <div key={group.title}>
                <p className="px-6 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{group.title}</p>
                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink href={item.href} variant="member">
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/[0.06] p-4">
            <Link
              href="/dashboard/profile"
              className="flex items-center gap-3 rounded-[4px] px-2 py-2 transition-colors duration-150 hover:bg-white/[0.04]"
            >
              <Avatar url={avatarUrl} initials={initials} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-100">{profile?.fullName ?? "Your profile"}</span>
                <span className="block truncate text-xs text-zinc-400">{user?.email ?? ""}</span>
              </span>
            </Link>
            <form action="/api/auth/logout" method="POST" className="mt-1">
              <button
                type="submit"
                className="flex min-h-10 w-full items-center gap-3 rounded-[4px] px-2 text-sm text-zinc-400 transition-colors duration-150 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path d="M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7" />
                </svg>
                Log out
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          {/* App bar: opaque navy. Phones: logo, messages, notifications and
              the avatar (profile, settings and log out live behind it).
              Desktop: a greeting and the same two inboxes. */}
          <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[var(--bg-0)] px-4 sm:px-6">
            <div className="flex h-14 items-center justify-between gap-3 lg:h-16">
              <div className="min-w-0">
                <Link href="/dashboard" aria-label="S&C Performance Coaching, home" className="flex h-11 items-center lg:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
                  <img src="/brand/website-logo-v2.png" alt="" width={160} height={74} className="h-8 w-auto" />
                </Link>
                <p className="hidden text-sm text-zinc-400 lg:block">
                  Welcome back{firstName ? `, ${firstName}` : ""}.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <IconLink href="/dashboard/messages" label="Messages">
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </IconLink>
                <IconLink
                  href="/dashboard/notifications"
                  label={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
                  badge={unreadNotifications > 0 ? (unreadNotifications > 9 ? "9+" : String(unreadNotifications)) : null}
                >
                  <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </IconLink>
                {staff ? (
                  <>
                    <IconLink href="/staff/classes" label="Staff area" className="sm:hidden">
                      <path d="M3 7a2 2 0 012-2h2l1-2h8l1 2h2a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                      <path d="M9 12h6" />
                    </IconLink>
                    <Link
                      href="/staff/classes"
                      className="ml-1 hidden min-h-10 items-center rounded-[3px] border border-white/[0.14] px-3.5 text-[13px] font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/50 hover:text-white sm:inline-flex"
                    >
                      Staff area
                    </Link>
                  </>
                ) : null}
                <Link
                  href="/dashboard/profile"
                  aria-label="Your profile, settings and log out"
                  className="flex h-11 w-11 items-center justify-center lg:hidden"
                >
                  <Avatar url={avatarUrl} initials={initials} size="sm" />
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-nav-safe pt-7 sm:px-6 lg:pb-12 lg:pt-10">
            {children}
          </main>
        </div>
      </div>
      <BottomNavBar />
      <PushServiceWorkerRegister />
    </div>
  );
}

function Avatar({ url, initials, size }: { url: string | null; initials: string; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs";
  return url ? (
    <span
      aria-hidden="true"
      className={`block shrink-0 rounded-full bg-cover bg-center ring-1 ring-white/20 ${box}`}
      style={{ backgroundImage: `url(${url})` }}
    />
  ) : (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground ${box}`}>
      {initials}
    </span>
  );
}

function IconLink({
  href,
  label,
  badge = null,
  className = "",
  children,
}: {
  href: string;
  label: string;
  badge?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`relative flex h-11 w-11 items-center justify-center rounded-[3px] text-zinc-300 transition-colors duration-150 hover:bg-white/[0.05] hover:text-white ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[22px] w-[22px]">
        {children}
      </svg>
      {badge ? (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
