import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { tenantStatusFor } from "@/lib/tenant-lockout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gym unavailable", robots: { index: false, follow: false } };

// Where a locked gym's people land on the website (the dashboard and staff layouts send them here). Nothing has been deleted: this page says so, and shows the gym's
// own staff how to restore access. A visitor whose gym is not locked is simply pointed back to the app.
export default async function GymUnavailablePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const status = user ? tenantStatusFor(user) : null;
  const locked = status?.state === "locked";
  const isStaff = !!user && (user.role === "coach" || user.role === "admin" || user.role === "admin_manager");

  return (
    <main data-theme="navy" data-palette="gold" className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center text-zinc-100">
      <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">{locked ? "Paused" : "All good"}</p>
      <h1 className="text-headline mt-3 text-[34px] text-zinc-50 sm:text-[44px]">{locked ? "This gym is temporarily unavailable." : "Nothing is paused."}</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
        {!locked
          ? "Your gym is available. Head back to continue."
          : isStaff
            ? "Your gym's platform subscription is overdue, so access is paused. Nothing has been deleted: everything comes back as soon as the payment is made."
            : "Nothing has been lost. Your gym will be back soon. Please speak to your gym if you need anything in the meantime."}
      </p>
      {locked && isStaff && status?.payUrl ? (
        <a href={status.payUrl} className="btn-primary mt-8 inline-flex px-5 py-3" rel="noopener noreferrer">
          Pay now to restore access
        </a>
      ) : null}
      {locked && isStaff && !status?.payUrl ? <p className="mt-6 max-w-md text-sm text-zinc-400">Contact S&amp;C Performance Coaching to arrange payment and restore access.</p> : null}
      <Link href={locked ? "/" : "/dashboard"} className="mt-8 text-sm text-zinc-300 underline underline-offset-4">
        {locked ? "Back to the home page" : "Back to your dashboard"}
      </Link>
    </main>
  );
}
