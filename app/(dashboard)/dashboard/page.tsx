import Link from "next/link";
import { cookies } from "next/headers";

import {
  findBookingsByUserId,
  findClassById,
  findMembershipPlanById,
  findProfileByUserId,
  findProgrammeByUserId,
  findRecoveryLogsByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import {
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/membership-status";
import { formatRemainingSessions, remainingSessions } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const programme = user ? findProgrammeByUserId(user.id) : undefined;
  const sessions = user ? findWorkoutSessionsByUserId(user.id) : [];
  const subscription = user ? findSubscriptionByUserId(user.id) : undefined;
  const subscriptionPlan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;
  const latestRecoveryLog = user ? findRecoveryLogsByUserId(user.id)[0] : undefined;

  const now = Date.now();

  const nextBooking = user
    ? findBookingsByUserId(user.id)
        .flatMap((b) => {
          const c = findClassById(b.classId);
          if (!c) return [];
          if (new Date(`${c.date}T${c.startTime}`).getTime() < now) return [];
          return [c];
        })
        .sort((a, b) =>
          `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
        )[0] ?? null
    : null;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const firstName = profile?.fullName?.split(" ")[0] ?? "athlete";

  const needsAttention =
    !!subscription &&
    (isPeriodLapsed(subscription) ||
      subscription.status === "past_due" ||
      subscription.status === "canceled");

  const membershipBadgeClass =
    !subscription
      ? "bg-primary/10 text-primary border-primary/20"
      : isPeriodLapsed(subscription) || subscription.status === "past_due"
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : subscription.status === "active"
      ? "bg-primary/10 text-primary border-primary/20"
      : "bg-muted text-muted-foreground border";

  const membershipBadgeLabel = !subscription
    ? "Get started"
    : isPeriodLapsed(subscription)
    ? "Period ended"
    : SUBSCRIPTION_STATUS_LABEL[subscription.status];

  const quickActions = [
    {
      href: "/dashboard/schedule",
      icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
      label: "Book a session",
      hint: "Schedule",
    },
    {
      href: "/dashboard/workouts",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
      label: "Today's workout",
      hint: programme?.title ?? "Programme",
    },
    {
      href: "/dashboard/recovery",
      icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
      label: "Log recovery",
      hint:
        latestRecoveryLog?.readinessScore != null
          ? `Readiness ${latestRecoveryLog.readinessScore}/100`
          : "Sleep & load",
    },
    {
      href: "/dashboard/profile",
      icon: "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      label: "View profile",
      hint: profile?.primaryGoal ?? "Goals & intake",
    },
  ];

  // sessions kept in scope — used by workouts page linked below
  void sessions;

  return (
    <section className="space-y-5 pt-2">

      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Hi {firstName}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ready when you are.</p>
      </div>

      {/* Next session — inverted hero */}
      <Link href="/dashboard/schedule" className="block">
        <div className="rounded-2xl bg-foreground text-background p-6 shadow-[var(--shadow-elev)]">
          <p className="text-xs uppercase tracking-[0.18em] opacity-60">Next session</p>
          {nextBooking ? (
            <>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{nextBooking.title}</p>
              <p className="mt-1 text-sm opacity-80">
                {nextBooking.date} · {nextBooking.startTime} · {nextBooking.durationMins} min
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-semibold tracking-tight">Nothing booked</p>
              <p className="mt-1 text-sm opacity-70">Browse the schedule to book a session</p>
            </>
          )}
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs opacity-80">
            View schedule
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </p>
        </div>
      </Link>

      {/* Membership */}
      <Link href="/dashboard/membership" className="block">
        <div
          className={`rounded-2xl border p-5 shadow-[var(--shadow-card)] ${
            needsAttention ? "bg-destructive/5 border-destructive/30" : "bg-card"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Membership</p>
              <p className="mt-2 text-lg font-semibold tracking-tight truncate">
                {subscriptionPlan?.name ?? "No active plan"}
              </p>
              {subscription && subscriptionPlan && subscription.status === "active" && !isPeriodLapsed(subscription) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRemainingSessions(remainingSessions(subscriptionPlan, subscription))}
                </p>
              ) : !subscription ? (
                <p className="mt-1 text-xs text-muted-foreground">Choose a plan to start booking sessions</p>
              ) : null}
            </div>
            <span className={`shrink-0 text-[11px] rounded-full px-2.5 py-1 font-medium border ${membershipBadgeClass}`}>
              {membershipBadgeLabel}
            </span>
          </div>
        </div>
      </Link>

      {/* Messages */}
      <Link href="/dashboard/messages" className="block">
        <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Coach</p>
            <p className="text-xs text-muted-foreground">Message your coach</p>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted-foreground">
            <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
      </Link>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {quickActions.map(({ href, icon, label, hint }) => (
          <Link key={href} href={href} className="block">
            <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] h-full">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary">
                <path d={icon} />
              </svg>
              <p className="mt-3 text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground truncate">{hint}</p>
            </div>
          </Link>
        ))}
      </div>

    </section>
  );
}
