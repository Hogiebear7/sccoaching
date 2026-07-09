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
import {
  readinessDelta,
  readinessSeries,
  sparklineSegments,
  weeklyTrainingSummary,
} from "@/lib/progress";
import { computeRollingTrainingLoad, readinessGuidance } from "@/lib/recovery";
import { formatRemainingSessions, remainingSessions } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";
import { classifyLoad, LOAD_BAND_LABEL } from "@/lib/workout-helper";
import { CountUp } from "@/components/ui/CountUp";

function readinessStatus(score: number): string {
  if (score >= 80) return "Primed";
  if (score >= 60) return "Ready";
  if (score >= 40) return "Steady";
  return "Ease off";
}

function readinessWashClass(score: number | null): string {
  if (score === null) return "";
  if (score >= 60)
    return "bg-[radial-gradient(75%_100%_at_20%_0%,rgba(45,212,191,0.09),transparent)]";
  if (score >= 40)
    return "bg-[radial-gradient(75%_100%_at_20%_0%,rgba(96,165,250,0.07),transparent)]";
  return "bg-[radial-gradient(75%_100%_at_20%_0%,rgba(251,191,36,0.07),transparent)]";
}

// Compact 14-day readiness sparkline; gaps stay gaps — no interpolation.
function ReadinessSparkline({ series }: { series: (number | null)[] }) {
  const W = 112;
  const H = 40;
  const segments = sparklineSegments(series, W, H);
  const lastIdx = series.length - 1 - [...series].reverse().findIndex((v) => v !== null);
  const lastVal = series[lastIdx] ?? null;
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;

  if (segments.length === 0) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-glow h-10 w-28" aria-hidden="true">
      {segments.map((points, i) =>
        points.includes(" ") ? (
          <polyline
            key={i}
            points={points}
            pathLength={100}
            className="anim-draw"
            fill="none"
            stroke="oklch(0.62 0.19 260)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        ) : (
          <circle
            key={i}
            cx={Number(points.split(",")[0])}
            cy={Number(points.split(",")[1])}
            r="1.5"
            fill="oklch(0.62 0.19 260)"
            opacity="0.7"
          />
        )
      )}
      {lastVal !== null && (
        <circle
          cx={lastIdx * stepX}
          cy={H - (lastVal / 100) * H}
          r="3"
          fill="oklch(0.72 0.13 180)"
          className="anim-fade"
          style={{ animationDelay: "600ms" }}
        />
      )}
    </svg>
  );
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const programme = user ? findProgrammeByUserId(user.id) : undefined;
  const sessions = user ? findWorkoutSessionsByUserId(user.id) : [];
  const subscription = user ? findSubscriptionByUserId(user.id) : undefined;
  const subscriptionPlan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;
  const recoveryLogs = user ? findRecoveryLogsByUserId(user.id) : [];
  const latestRecoveryLog = recoveryLogs[0];

  // Readiness module data — all from the member's own logs.
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayReadiness =
    recoveryLogs.find((l) => l.date === todayISO)?.readinessScore ?? null;
  const readinessTrend = readinessSeries(recoveryLogs, todayISO, 14);
  const hasTrend = readinessTrend.some((v) => v !== null);
  const delta = readinessDelta(recoveryLogs, todayISO);
  const rolling = computeRollingTrainingLoad(recoveryLogs);
  const loadBand = classifyLoad(rolling.sevenDaySum, rolling.daysWithLoad);
  const weekChange = weeklyTrainingSummary(recoveryLogs, todayISO, 2)[0]?.changePct ?? null;
  const sessionsLast7 = sessions.filter((s) => s.date >= (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  })()).length;

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
      // Programme is a coach-enabled feature — don't reference it when off.
      hint: profile?.programmeEnabled && programme?.title ? programme.title : "Log & review sessions",
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

  return (
    <section className="anim-rise space-y-8">

      {/* Immersive header */}
      <div className="relative -mx-4 -mt-8 overflow-hidden border-b border-white/[0.06] px-4 pb-7 pt-9 sm:-mx-6 sm:px-6">
        <div className="relative">
          <p className="chip label-caps w-fit border-teal-400/20 bg-teal-400/[0.07] !text-teal-300/90">{today}</p>
          <h1 className="title-athletic mt-3 text-[30px] leading-[1.05]">Hi {firstName}</h1>
          <p className="mt-2 text-sm text-zinc-400">Ready when you are.</p>
        </div>
      </div>

      {/* Readiness + key numbers */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Readiness</h2>
          <Link href="/dashboard/recovery" className="text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300">Recovery →</Link>
        </div>
        <div className="panel relative overflow-hidden p-5">
          <div className={`pointer-events-none absolute inset-0 ${readinessWashClass(todayReadiness)}`} />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              {todayReadiness !== null ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <p className="text-display text-[44px] leading-none tabular-nums"><CountUp value={todayReadiness} durationMs={600} /></p>
                    <span className="text-sm text-zinc-500">/100</span>
                    {delta !== null && delta !== 0 && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                          delta > 0
                            ? "border-teal-500/25 bg-teal-500/[0.08] text-teal-300"
                            : "border-amber-500/25 bg-amber-500/[0.08] text-amber-300"
                        }`}
                      >
                        {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-semibold tracking-tight text-zinc-200">
                    {readinessStatus(todayReadiness)}
                  </p>
                  <p className="mt-1 max-w-[36ch] text-[12px] leading-relaxed text-zinc-500">
                    {readinessGuidance(todayReadiness)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-display text-[44px] leading-none text-zinc-600">—</p>
                  <p className="mt-1.5 text-sm font-semibold tracking-tight text-zinc-300">No check-in yet</p>
                  <p className="mt-1 max-w-[36ch] text-[12px] leading-relaxed text-zinc-500">
                    Log today&apos;s recovery to get a readiness score and session guidance.
                  </p>
                </>
              )}
            </div>
            {hasTrend && (
              <div className="shrink-0 text-right">
                <ReadinessSparkline series={readinessTrend} />
                <p className="mt-1 text-[10px] text-zinc-600">14 days</p>
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="panel mt-2.5 grid grid-cols-3 divide-x divide-white/[0.06]">
          <div className="px-3 py-3.5 text-center sm:px-4">
            <p className="label-caps text-[9px]">7-day load</p>
            <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums">
              {rolling.sevenDaySum > 0 ? <CountUp value={rolling.sevenDaySum} /> : "—"}
            </p>
            <p className="mt-1 text-[10px] text-zinc-600">
              {rolling.daysWithLoad > 0 ? (
                <>
                  {LOAD_BAND_LABEL[loadBand]}
                  {weekChange !== null && (
                    <span className="text-blue-400 tabular-nums"> · {weekChange > 0 ? "+" : ""}{weekChange}% wk</span>
                  )}
                </>
              ) : (
                "log duration & RPE"
              )}
            </p>
          </div>
          <div className="px-3 py-3.5 text-center sm:px-4">
            <p className="label-caps text-[9px]">Sleep</p>
            <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums">
              {latestRecoveryLog?.sleepHours != null ? (
                <>
                  <CountUp
                    value={latestRecoveryLog.sleepHours}
                    decimals={Number.isInteger(latestRecoveryLog.sleepHours) ? 0 : 1}
                  />{" "}
                  h
                </>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-1 text-[10px] text-zinc-600">
              {latestRecoveryLog?.sleepQuality != null
                ? `quality ${latestRecoveryLog.sleepQuality}/5`
                : "last check-in"}
            </p>
          </div>
          <div className="px-3 py-3.5 text-center sm:px-4">
            <p className="label-caps text-[9px]">Sessions</p>
            <p className="text-display mt-1.5 text-[20px] leading-none tabular-nums"><CountUp value={sessionsLast7} /></p>
            <p className="mt-1 text-[10px] text-zinc-600">workouts · 7 days</p>
          </div>
        </div>
      </div>

      {/* Hero: next session */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Next Session</h2>
          <Link href="/dashboard/bookings" className="text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300">My bookings →</Link>
        </div>
        <div className="panel overflow-hidden">
          {nextBooking ? (
            <div className="flex items-stretch">
              <div className="flex w-[88px] flex-shrink-0 flex-col items-center justify-center gap-0.5 border-r border-white/[0.08] bg-white/[0.03] py-6">
                <span className="text-display text-[24px] leading-none tabular-nums">{nextBooking.startTime.split(":")[0]}</span>
                <span className="text-[13px] leading-none text-zinc-500 tabular-nums">:{nextBooking.startTime.split(":")[1]}</span>
              </div>
              <div className="min-w-0 flex-1 p-4">
                <p className="text-display text-[17px] leading-tight">{nextBooking.title}</p>
                <p className="mt-1 text-[13px] text-zinc-400 tabular-nums">
                  {nextBooking.date} · {nextBooking.durationMins} min
                </p>
              </div>
            </div>
          ) : (
            <div className="px-5 py-6 text-center">
              <p className="text-display text-[17px]">Nothing booked</p>
              <p className="mt-1 text-[13px] text-zinc-500">Browse the schedule to reserve your next session.</p>
            </div>
          )}
          <div className="border-t border-white/[0.06] p-3">
            <Link
              href="/dashboard/schedule"
              className="flex w-full items-center justify-center btn-primary py-2.5"
            >
              {nextBooking ? "View schedule" : "Book a session"}
            </Link>
          </div>
        </div>
      </div>

      {/* Status strip: membership + coach */}
      <div>
        <h2 className="label-caps mb-2.5">Your Club</h2>
        <div className="panel divide-y divide-white/[0.05] overflow-hidden">
          <Link
            href="/dashboard/membership"
            className={`flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-white/[0.02] ${needsAttention ? "bg-destructive/[0.04]" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="label-caps text-[10px]">Membership</p>
              <p className="mt-1 truncate text-[15px] font-semibold tracking-tight">
                {subscriptionPlan?.name ?? "No active plan"}
              </p>
              {subscription && subscriptionPlan && subscription.status === "active" && !isPeriodLapsed(subscription) ? (
                <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                  {formatRemainingSessions(remainingSessions(subscriptionPlan, subscription))}
                </p>
              ) : !subscription ? (
                <p className="mt-0.5 text-xs text-zinc-500">Choose a plan to start booking sessions</p>
              ) : null}
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${membershipBadgeClass}`}>
              {membershipBadgeLabel}
            </span>
          </Link>
          <Link href="/dashboard/messages" className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-white/[0.02]">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-teal-500/20 bg-teal-500/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-teal-300">
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tracking-tight">Coach</p>
              <p className="mt-0.5 text-xs text-zinc-500">Message your coach</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-zinc-600">
              <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="label-caps mb-2.5">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {quickActions.map(({ href, icon, label, hint }) => (
            <Link key={href} href={href} className="panel hover-lift flex h-full flex-col gap-3 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.05]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-teal-300">
                  <path d={icon} />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold leading-tight tracking-tight">{label}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{hint}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

    </section>
  );
}
