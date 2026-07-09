import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { findUserById } from "@/lib/db";
import { BRAND_NAME } from "@/lib/content";
import { verifySession } from "@/lib/session";
import { NavLink } from "@/app/(dashboard)/dashboard/nav-link";

export const dynamic = "force-dynamic";

const navItems = [
  { label: "Operations", href: "/staff/operations" },
  { label: "Classes",    href: "/staff/classes" },
  { label: "Members",   href: "/staff/members" },
  { label: "Plans",     href: "/staff/plans" },
  { label: "Exercises", href: "/staff/exercises" },
];

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || user.role !== "staff") {
    redirect("/dashboard");
  }

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
                {navItems.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>{item.label}</NavLink>
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
                    className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
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
