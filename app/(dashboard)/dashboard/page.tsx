import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import {
  findBookingsByUserId,
  findClassById,
  findCycleSettingsByUserId,
  findProfileByUserId,
  findProgrammeByUserId,
  findRecoveryLogsByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { estimatePhase } from "@/lib/cycle-phase";
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
import { classPassBalance, formatRemainingSessions, remainingSessions } from "@/lib/scheduling-status";
import { formatFriendlyClassDate } from "@/lib/dates";
import { verifySession } from "@/lib/session";
import { classifyLoad, LOAD_BAND_LABEL } from "@/lib/workout-helper";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { DashboardTour } from "@/components/dashboard/DashboardTour";
import { ListGroup, ListRow, StatusBadge } from "@/components/member/ListGroup";
import { SectionTitle } from "@/components/member/ScreenHeader";
import { readinessStatus } from "@/lib/dashboard-data";

// Compact 14-day readiness sparkline; gaps stay gaps — no interpolation.
// Data blue line, the latest point in the accent.
function ReadinessSparkline({ series }: { series: (number | null)[] }) {
  const W = 112;
  const H = 40;
  const segments = sparklineSegments(series, W, H);
  const lastIdx = series.length - 1 - [...series].reverse().findIndex((v) => v !== null);
  const lastVal = series[lastIdx] ?? null;
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;

  if (segments.length === 0) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-28 overflow-visible" aria-hidden="true">
      {segments.map((points, i) =>
        points.includes(" ") ? (
          <polyline
            key={i}
            points={points}
            pathLength={100}
            className="anim-draw"
            fill="none"
            stroke="var(--accent-data)"
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
            fill="var(--accent-data)"
            opacity="0.7"
          />
        )
      )}
      {lastVal !== null && (
        <circle
          cx={lastIdx * stepX}
          cy={H - (lastVal / 100) * H}
          r="3"
          fill="var(--primary)"
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
  const subscriptionPlan = resolveSubscriptionEntitlement(subscription);
  const recoveryLogs = user ? findRecoveryLogsByUserId(user.id) : [];
  const latestRecoveryLog = recoveryLogs[0];

  const cycleSettings =
    user && profile?.cycleTrackingEligible && profile.cycleTrackingEnabled
      ? findCycleSettingsByUserId(user.id)
      : undefined;
  const phaseEstimate = cycleSettings
    ? estimatePhase(
        cycleSettings.lastPeriodStartDate,
        cycleSettings.averageCycleLengthDays,
        cycleSettings.periodLengthDays,
        cycleSettings.regularity
      )
    : null;

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
  const monthPasses =
    subscriptionPlan && subscription && subscription.status === "active" && !isPeriodLapsed(subscription)
      ? classPassBalance(subscriptionPlan, subscription)
      : null;
  const sessionsLast7 = sessions.filter((s) => s.date >= (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  })()).length;

  // Server component: rendered once per request, so reading the clock here is
  // intentional (bookings are resolved against "now" for this response).
  // eslint-disable-next-line react-hooks/purity
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

  const membershipTone: "neutral" | "good" | "warn" | "bad" =
    !subscription
      ? "neutral"
      : isPeriodLapsed(subscription) || subscription.status === "past_due"
        ? "bad"
        : subscription.status === "active"
          ? "good"
          : "neutral";

  const membershipBadgeLabel = !subscription
    ? "Get started"
    : isPeriodLapsed(subscription)
    ? "Period ended"
    : SUBSCRIPTION_STATUS_LABEL[subscription.status];

  // Trimmed to the two actions not already covered by their own dedicated
  // module above (Nutrition has its own entry card; Recovery already has a
  // "Recovery →" link on the Readiness module) — deliberately not a 2x2
  // grid of equal-weight tiles.
  const quickActions = [
    {
      href: "/dashboard/workouts",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
      label: "Today's workout",
      // Programme is a coach-enabled feature — don't reference it when off.
      hint: profile?.programmeEnabled && programme?.title ? programme.title : "Log & review sessions",
    },
    {
      href: "/dashboard/profile",
      icon: "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      label: "View profile",
      hint: profile?.primaryGoal ?? "Goals & intake",
    },
  ];

  // The one question Home answers first: "what should I do today?". No
  // check-in → check in; checked in → plan the session (or, when the score
  // says ease off, still plan it, the helper scales it down).
  const todayAction =
    todayReadiness === null
      ? { href: "/dashboard/recovery", label: "Log today's check-in" }
      : { href: "/dashboard/workouts", label: "Plan today's session" };

  const nextStart = nextBooking ? new Date(`${nextBooking.date}T${nextBooking.startTime}`) : null;

  return (
    <>
    <DashboardTour initialCompleted={profile?.dashboardTourCompleted ?? true} />
    <section className="anim-rise space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{today}</p>
        <h1 className="mt-1.5 text-headline text-[48px] text-zinc-50 sm:text-[56px]">Hi {firstName}.</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-300">
          {todayReadiness === null
            ? "Start with a 30-second check-in and today's guidance appears here."
            : `Readiness ${todayReadiness}: ${readinessStatus(todayReadiness).toLowerCase()}. ${nextBooking ? `Next class ${formatFriendlyClassDate(nextBooking.date).toLowerCase()} at ${nextBooking.startTime}.` : ""}`}
        </p>
      </header>

      {/* Today — the signature card: readiness, what it means, the next
          action, and three numbers with context. */}
      <div data-tour="readiness">
        <SectionTitle action={<TextLink href="/dashboard/recovery">Recovery</TextLink>}>Today</SectionTitle>
        <div className="surface-card surface-card--accent overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-5">
              <ReadinessRing score={todayReadiness} size={88} quiet />
              <div className="min-w-0 flex-1">
                {todayReadiness !== null ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-headline text-[30px] text-zinc-50">{readinessStatus(todayReadiness)}</p>
                      {delta !== null && delta !== 0 && (
                        <span
                          aria-label={`${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since yesterday`}
                          className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums ${
                            delta > 0
                              ? "border-[var(--success)]/35 text-[var(--success)]"
                              : "border-[var(--warning)]/35 text-[var(--warning)]"
                          }`}
                        >
                          <svg viewBox="0 0 8 8" aria-hidden="true" className={`h-2 w-2 shrink-0 ${delta > 0 ? "" : "rotate-180"}`} fill="currentColor">
                            <path d="M4 1 L7.2 6.4 H0.8 Z" />
                          </svg>
                          {Math.abs(delta)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-300">{readinessGuidance(todayReadiness)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-headline text-[30px] text-zinc-50">No check-in yet</p>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-300">
                      Sleep, soreness and fatigue give you a readiness score and session guidance.
                    </p>
                  </>
                )}
                {phaseEstimate && phaseEstimate.phase !== "Unknown" ? (
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{phaseEstimate.readinessNote}</p>
                ) : null}
              </div>
            </div>

            <Link href={todayAction.href} className="btn-primary mt-5 w-full px-5 text-sm sm:w-auto">
              {todayAction.label}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* Three numbers, each with its context line. */}
          <dl className="grid grid-cols-3 divide-x divide-white/[0.06] border-t border-white/[0.06]">
            <Metric
              label="7-day load"
              value={rolling.sevenDaySum > 0 ? rolling.sevenDaySum.toLocaleString() : "—"}
              context={
                rolling.daysWithLoad > 0
                  ? `${LOAD_BAND_LABEL[loadBand]}${weekChange !== null ? ` · ${weekChange > 0 ? "+" : ""}${weekChange}% wk` : ""}`
                  : "Log time and RPE"
              }
            />
            <Metric
              label="Sleep"
              value={latestRecoveryLog?.sleepHours != null ? String(latestRecoveryLog.sleepHours) : "—"}
              unit={latestRecoveryLog?.sleepHours != null ? "h" : undefined}
              context={latestRecoveryLog?.sleepQuality != null ? `Quality ${latestRecoveryLog.sleepQuality}/10` : "Last check-in"}
            />
            <Metric label="Sessions" value={String(sessionsLast7)} context="Last 7 days" />
          </dl>

          {hasTrend && (
            <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] px-5 py-3 sm:px-6">
              <p className="text-sm text-zinc-400">Readiness, last 14 days</p>
              <ReadinessSparkline series={readinessTrend} />
            </div>
          )}
        </div>
      </div>

      {/* Next session */}
      <div data-tour="next-session">
        <SectionTitle action={<TextLink href="/dashboard/bookings">Bookings</TextLink>}>Next session</SectionTitle>
        {nextBooking && nextStart ? (
          <div className="surface-card overflow-hidden">
            <div className="flex items-stretch">
              <div className="flex w-[84px] shrink-0 flex-col items-center justify-center border-r border-white/[0.06] bg-[var(--bg-0)] py-4">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">
                  {nextStart.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="mt-1 text-headline text-[30px] tabular-nums text-zinc-50">{nextBooking.startTime}</span>
              </div>
              <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
                <p className="truncate text-[17px] font-semibold text-zinc-50">{nextBooking.title}</p>
                <p className="mt-1 text-sm tabular-nums text-zinc-400">
                  {formatFriendlyClassDate(nextBooking.date)} · {nextBooking.durationMins} min
                </p>
                {monthPasses && (
                  <p className="mt-1 text-sm tabular-nums text-zinc-400">
                    {monthPasses.remaining === null
                      ? "Unlimited classes this month"
                      : `${monthPasses.remaining} class${monthPasses.remaining === 1 ? "" : "es"} left this month`}
                  </p>
                )}
              </div>
            </div>
            <Link
              href="/dashboard/schedule"
              className="flex min-h-12 items-center justify-center gap-1.5 border-t border-white/[0.06] text-sm font-semibold text-zinc-100 transition-colors duration-150 hover:bg-white/[0.03]"
            >
              View schedule <span aria-hidden="true">→</span>
            </Link>
          </div>
        ) : (
          <div className="surface-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[17px] font-semibold text-zinc-50">Nothing booked</p>
              <p className="mt-1 text-sm text-zinc-400">
                {monthPasses && monthPasses.remaining !== null
                  ? `${monthPasses.remaining} class${monthPasses.remaining === 1 ? "" : "es"} left this month. Reserve one in a couple of taps.`
                  : "Reserve your next class in a couple of taps."}
              </p>
            </div>
            <Link
              href="/dashboard/schedule"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[3px] border border-white/[0.16] px-5 text-sm font-semibold text-zinc-100 transition-colors duration-150 hover:border-primary/50"
            >
              Book a session
            </Link>
          </div>
        )}
      </div>

      {/* Fuel */}
      <div data-tour="nutrition">
        <SectionTitle>Fuel</SectionTitle>
        <ListGroup>
          <ListRow
            href="/dashboard/nutrition"
            icon="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.657 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657zM9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
            title="Fuel today's training"
            detail={
              profile?.dietaryPreference && profile.dietaryPreference !== "standard"
                ? `${profile.dietaryPreference.charAt(0).toUpperCase()}${profile.dietaryPreference.slice(1)} · log meals and hydration`
                : "Log meals and hydration"
            }
          />
        </ListGroup>
      </div>

      {/* Club: membership + coach */}
      <div data-tour="club">
        <SectionTitle>Your club</SectionTitle>
        <ListGroup>
          <ListRow
            href="/dashboard/membership"
            icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            title={subscriptionPlan?.name ?? "No active plan"}
            tone={needsAttention ? "attention" : "default"}
            detail={
              subscription && subscriptionPlan && subscription.status === "active" && !isPeriodLapsed(subscription)
                ? formatRemainingSessions(remainingSessions(subscriptionPlan, subscription))
                : !subscription
                  ? "Choose a plan to start booking"
                  : "Membership"
            }
            trailing={<StatusBadge tone={membershipTone}>{membershipBadgeLabel}</StatusBadge>}
          />
          <ListRow
            href="/dashboard/messages"
            icon="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            title="Coach"
            detail="Message your coach"
          />
        </ListGroup>
      </div>

      {/* Shortcuts */}
      <div data-tour="quick-actions">
        <SectionTitle>Shortcuts</SectionTitle>
        <ListGroup>
          {quickActions.map(({ href, icon, label, hint }) => (
            <ListRow key={href} href={href} icon={icon} title={label} detail={hint} />
          ))}
        </ListGroup>
      </div>
    </section>
    </>
  );
}

// One KPI: caps label, Teko figure (units in small Inter so Teko's
// uppercase never turns "h" into "H"), and a context line.
function Metric({ label, value, unit, context }: { label: string; value: string; unit?: string; context: string }) {
  return (
    <div className="px-3 py-4 text-center sm:px-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{label}</dt>
      <dd className="mt-1.5 text-headline text-[32px] tabular-nums text-zinc-50">
        {value}
        {unit ? <span className="ml-0.5 font-sans text-sm font-semibold normal-case text-zinc-300">{unit}</span> : null}
      </dd>
      <dd className="mt-1 text-xs leading-snug text-zinc-400">{context}</dd>
    </div>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]"
    >
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}
