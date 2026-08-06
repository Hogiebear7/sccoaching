import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import Link from "next/link";
import { cookies } from "next/headers";

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
import { CountUp } from "@/components/ui/CountUp";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { ClassImageSlot } from "@/components/ui/ClassImageSlot";
import { DashboardTour } from "@/components/dashboard/DashboardTour";

function readinessStatus(score: number): string {
  if (score >= 80) return "Primed";
  if (score >= 60) return "Ready";
  if (score >= 40) return "Steady";
  return "Ease off";
}

// Token-driven (not literal hues) so the wash recolors correctly per
// palette/theme, same band language as ReadinessRing.
function readinessWashVar(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 60) return "--success";
  if (score >= 40) return "--accent-data";
  return "--warning";
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

  return (
    <>
    <DashboardTour initialCompleted={profile?.dashboardTourCompleted ?? true} />
    <section className="anim-rise space-y-8">

      {/* Immersive header. The decorative image sits on its own aria-hidden
          layer; the greeting sits above on a `relative` layer. The scrim stack
          (bottom-up + left) keeps the greeting readable across desktop/mobile
          crops and works for any drop-in image — swap the src for a real photo
          and the safe-area still holds. Image is decorative only. */}
      <div className="relative -mx-4 -mt-8 overflow-hidden border-b border-white/[0.06] px-4 pb-7 pt-9 sm:-mx-6 sm:px-6">
        <div aria-hidden="true" className="absolute inset-0">
          {/* Decorative, on-brand banner — carries no information. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dashboard-header.svg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-right"
          />
          {/* Bottom-up scrim → blends the image into the page and protects the
              greeting; left scrim → extra safe-area for the bottom-left text. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/10 to-transparent" />
        </div>
        <div className="relative">
          <p className="chip label-caps w-fit border-primary/25 bg-primary/[0.08] !text-gold">{today}</p>
          <h1 className="mt-3 text-editorial text-[32px] italic leading-[1.05] text-zinc-50">Hi {firstName}</h1>
          <p className="mt-2 text-sm text-zinc-400">Ready when you are.</p>
        </div>
      </div>

      {/* Hero: next session — the one intentional/primary card, marked with
          the accent bar so it reads as the page's main event, not an equal
          tile among many. */}
      <div data-tour="next-session">
        <div className="mb-2.5 flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <h2 className="label-caps">Next Session</h2>
            {monthPasses && (
              <span className="chip text-[10px] font-semibold tabular-nums">
                {monthPasses.remaining === null
                  ? "Unlimited classes"
                  : `${monthPasses.remaining} class${monthPasses.remaining === 1 ? "" : "es"} left this month`}
              </span>
            )}
          </div>
          <Link href="/dashboard/bookings" className="text-xs font-medium text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]">My bookings →</Link>
        </div>
        <div className="surface-card surface-card--accent overflow-hidden">
          {nextBooking ? (
            <div className="flex items-stretch">
              <div className="relative w-[88px] flex-shrink-0 overflow-hidden">
                {/* Image rail — real class cover or on-brand placeholder */}
                <ClassImageSlot
                  seed={nextBooking.category || nextBooking.id}
                  label={nextBooking.title}
                  imageUrl={nextBooking.imageUrl}
                  alt={nextBooking.imageAlt}
                  className="absolute inset-0"
                />
                {/* Dedicated dark scrim so the time stays legible over any cover
                    or placeholder, strongest at the bottom where the time sits */}
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
                <div className="relative flex h-full flex-col items-center justify-end gap-0.5 px-2 pb-3 pt-6">
                  <span className="text-display text-[24px] leading-none tabular-nums text-white">{nextBooking.startTime.split(":")[0]}</span>
                  <span className="text-[13px] leading-none tabular-nums text-white/75">:{nextBooking.startTime.split(":")[1]}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 p-4">
                <p className="text-display text-[17px] leading-tight">{nextBooking.title}</p>
                <p className="mt-1 text-[13px] text-zinc-400 tabular-nums">
                  {formatFriendlyClassDate(nextBooking.date)} · {nextBooking.durationMins} min
                </p>
              </div>
            </div>
          ) : (
            <div className="px-5 py-6 text-center">
              <p className="text-display text-[17px]">Nothing booked</p>
              <p className="mt-1 text-[13px] text-zinc-500">Reserve your next session in a couple of taps.</p>
              <Link href="/dashboard/schedule" className="btn-primary mt-4 w-full py-2.5">
                Book a session
              </Link>
            </div>
          )}
          {nextBooking && (
            <div className="border-t border-white/[0.06] p-3">
              <Link
                href="/dashboard/schedule"
                className="flex w-full items-center justify-center btn-primary py-2.5"
              >
                View schedule
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Readiness + key numbers */}
      <div data-tour="readiness">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Readiness</h2>
          <Link href="/dashboard/recovery" className="text-xs font-medium text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]">Recovery →</Link>
        </div>
        <div className="surface-card relative overflow-hidden p-5">
          {readinessWashVar(todayReadiness) && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(75% 100% at 20% 0%, color-mix(in oklch, var(${readinessWashVar(todayReadiness)}) 14%, transparent), transparent)`,
              }}
            />
          )}
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-start gap-4">
                <ReadinessRing score={todayReadiness} />
                <div className="min-w-0">
                  {todayReadiness !== null ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold tracking-tight text-zinc-200">
                          {readinessStatus(todayReadiness)}
                        </p>
                        {delta !== null && delta !== 0 && (
                          <span
                            aria-label={`${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since yesterday`}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${
                              delta > 0
                                ? "border-[var(--success)]/30 bg-[var(--success-weak)] text-[var(--success)]"
                                : "border-[var(--warning)]/30 bg-[var(--warning-weak)] text-[var(--warning)]"
                            }`}
                          >
                            {/* SVG instead of ▲/▼ text glyphs — the unicode
                                triangles size and sit differently per device
                                font, which is what made the chip look broken
                                on mobile. */}
                            <svg
                              viewBox="0 0 8 8"
                              aria-hidden="true"
                              className={`h-2 w-2 shrink-0 ${delta > 0 ? "" : "rotate-180"}`}
                              fill="currentColor"
                            >
                              <path d="M4 1 L7.2 6.4 H0.8 Z" />
                            </svg>
                            {Math.abs(delta)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-500">
                        {readinessGuidance(todayReadiness)}
                      </p>
                      {phaseEstimate && phaseEstimate.phase !== "Unknown" ? (
                        <p className="mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-500">
                          {phaseEstimate.readinessNote}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold tracking-tight text-zinc-300">No check-in yet</p>
                      <p className="mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-500">
                        Log today&apos;s recovery to get a readiness score and session guidance.
                      </p>
                      {phaseEstimate && phaseEstimate.phase !== "Unknown" ? (
                        <p className="mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-500">
                          {phaseEstimate.readinessNote}
                        </p>
                      ) : null}
                      <Link href="/dashboard/recovery" className="mt-2 inline-block text-[12px] font-medium text-primary hover:text-[var(--primary-hover)]">
                        Log recovery →
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
            {hasTrend && (
              <div className="shrink-0 border-t border-white/[0.06] pt-3 text-right sm:border-t-0 sm:pt-0">
                <ReadinessSparkline series={readinessTrend} />
                <p className="mt-1 text-[10px] text-zinc-600">Readiness · 14d trend</p>
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="surface-card mt-2.5 grid grid-cols-3 divide-x divide-white/[0.06]">
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
                    <span className="text-[var(--accent-data)] tabular-nums"> · {weekChange > 0 ? "+" : ""}{weekChange}% wk</span>
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

      {/* Nutrition — promoted from the quick-actions grid to its own entry
          point (priority 4 in the dashboard brief), with real profile
          context where available rather than a generic hint. */}
      <div data-tour="nutrition">
        <h2 className="label-caps mb-2.5">Nutrition</h2>
        <Link href="/dashboard/nutrition" className="surface-card hover-lift flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary">
              <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.657 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657zM9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tracking-tight">Fuel today&apos;s training</p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {profile?.dietaryPreference && profile.dietaryPreference !== "standard"
                ? `${profile.dietaryPreference.charAt(0).toUpperCase()}${profile.dietaryPreference.slice(1)} · log meals & hydration`
                : "Log meals & hydration"}
            </p>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-zinc-600">
            <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>

      {/* Status strip: membership + coach */}
      <div data-tour="club">
        <h2 className="label-caps mb-2.5">Your Club</h2>
        <div className="surface-card divide-y divide-white/[0.05] overflow-hidden">
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
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary">
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

      {/* Quick actions — trimmed to two (see quickActions comment); deliberately
          not a larger grid of equal-weight tiles. */}
      <div data-tour="quick-actions">
        <h2 className="label-caps mb-2.5">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {quickActions.map(({ href, icon, label, hint }) => (
            <Link key={href} href={href} className="surface-card hover-lift flex h-full flex-col gap-3 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.05]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-primary">
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
    </>
  );
}
