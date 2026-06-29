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
  {
    label: "Operations",
    href: "/staff/operations",
  },
  {
    label: "Classes",
    href: "/staff/classes",
  },
  {
    label: "Plans",
    href: "/staff/plans",
  },
];

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || user.role !== "staff") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-zinc-800 bg-zinc-950 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-zinc-800 px-5 py-5">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                {BRAND_NAME}
              </p>
              <h1 className="mt-3 text-xl font-semibold text-zinc-50">Staff</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Manage classes for the customer schedule.
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
                <p className="text-sm font-medium text-zinc-100">Staff</p>
                <p className="mt-1 text-sm text-zinc-400">{user.email}</p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="border-b border-zinc-800 bg-zinc-900/80 px-4 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Staff Portal
                </p>
                <p className="mt-1 text-sm text-zinc-400">Signed in as {user.email}.</p>
              </div>

              <div className="flex gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
                >
                  Member view
                </Link>
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

          <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
