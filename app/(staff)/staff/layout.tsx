import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { findUserById } from "@/lib/db";
import { BRAND_NAME } from "@/lib/content";
import { can, NAV_CAPABILITY, type Capability } from "@/lib/permissions";
import { verifySession } from "@/lib/session";
import { NavLink } from "@/app/(dashboard)/dashboard/nav-link";
import { UnreadMessagesBadge } from "@/components/staff/UnreadMessagesBadge";

export const dynamic = "force-dynamic";

// Every nav item declares the capability that reveals it — the menu is a
// projection of the permission model, and each destination re-checks the same
// capability server-side (see lib/staff-auth.ts requireStaffPage).
const navItems: { label: string; href: string; capability: Capability }[] = [
  { label: "Operations",  href: "/staff/operations",  capability: NAV_CAPABILITY["/staff/operations"] },
  { label: "Classes",     href: "/staff/classes",     capability: NAV_CAPABILITY["/staff/classes"] },
  { label: "Members",     href: "/staff/members",     capability: NAV_CAPABILITY["/staff/members"] },
  { label: "Messages",    href: "/staff/messages",    capability: NAV_CAPABILITY["/staff/messages"] },
  { label: "Membership/Class Options", href: "/staff/catalog", capability: NAV_CAPABILITY["/staff/catalog"] },
  { label: "Exercises",   href: "/staff/exercises",   capability: NAV_CAPABILITY["/staff/exercises"] },
  { label: "Exercise Library", href: "/staff/exercise-library", capability: NAV_CAPABILITY["/staff/exercise-library"] },
  { label: "Staff users", href: "/staff/staff-users", capability: NAV_CAPABILITY["/staff/staff-users"] },
  { label: "Reports",     href: "/staff/reports",     capability: NAV_CAPABILITY["/staff/reports"] },
  { label: "Finances",    href: "/staff/finances",    capability: NAV_CAPABILITY["/staff/finances"] },
  { label: "Food submissions", href: "/staff/nutrition-submissions", capability: NAV_CAPABILITY["/staff/nutrition-submissions"] },
  // TRIAL-ONLY — see docs/bug-reports.md.
  { label: "Bug reports", href: "/staff/bug-reports", capability: NAV_CAPABILITY["/staff/bug-reports"] },
];

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || user.archivedAt || !can(user.role, "staff.access")) {
    redirect("/dashboard");
  }

  const visibleNav = navItems.filter((item) => can(user.role, item.capability));

  return (
    <div className="min-h-screen bg-black text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Sidebar — intentional zinc chrome */}
        <aside className="border-b border-border bg-zinc-950 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-5">
              <p className="label-caps">
                {BRAND_NAME}
              </p>
              <h1 className="text-display mt-3 text-xl text-foreground">Staff</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage classes for the member schedule.
              </p>
            </div>

            <nav className="flex-1 px-4 py-4">
              <ul className="space-y-2">
                {visibleNav.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>
                      {item.href === "/staff/messages" ? (
                        <span className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          <UnreadMessagesBadge />
                        </span>
                      ) : (
                        item.label
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="border-t border-border px-4 py-4">
              <div className="panel p-4">
                <p className="text-sm font-medium text-foreground">Staff</p>
                <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="border-b border-border bg-card/80 px-4 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="label-caps">
                  Staff Portal
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Signed in as {user.email}.
                </p>
              </div>

              <div className="flex gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
                >
                  Member view
                </Link>
                <form action="/api/auth/logout" method="POST">
                  <button
                    type="submit"
                    className="btn-primary px-4 py-2"
                  >
                    Log out
                  </button>
                </form>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
