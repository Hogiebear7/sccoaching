import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";

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
} from "./db";
import { classStartMs } from "@/lib/class-time";
import { estimatePhase } from "./cycle-phase";
import { isPeriodLapsed, SUBSCRIPTION_STATUS_LABEL } from "./membership-status";
import { readinessDelta, readinessSeries, weeklyTrainingSummary } from "./progress";
import { computeRollingTrainingLoad, readinessGuidance } from "./recovery";
import { classPassBalance, remainingSessions } from "./scheduling-status";
import { classifyLoad, LOAD_BAND_LABEL } from "./workout-helper";

export function readinessStatus(score: number): string {
  if (score >= 80) return "Primed";
  if (score >= 60) return "Ready";
  if (score >= 40) return "Steady";
  return "Ease off";
}

export interface DashboardData {
  firstName: string;
  todayISO: string;

  nextSession: {
    classId: string;
    title: string;
    date: string;
    startTime: string;
    durationMins: number;
    category: string;
    imageUrl: string | null;
    imageAlt: string | null;
  } | null;
  monthPassesRemaining: number | null; // null = unlimited or not applicable
  hasMonthPasses: boolean;

  readiness: {
    today: number | null;
    status: string | null;
    guidance: string | null;
    trend: (number | null)[];
    hasTrend: boolean;
    delta: number | null;
    phaseNote: string | null;
  };

  kpis: {
    sevenDaySum: number;
    daysWithLoad: number;
    loadBandLabel: string;
    weekChangePct: number | null;
    sleepHours: number | null;
    sleepQuality: number | null;
    sessionsLast7: number;
  };

  nutrition: {
    dietaryPreference: string | null; // null when "standard" (nothing distinctive to show)
  };

  club: {
    hasSubscription: boolean;
    planName: string | null;
    statusLabel: string | null;
    isActive: boolean;
    needsAttention: boolean; // lapsed / past_due / canceled
    remainingSessionsLabel: string | null;
  };

  quickActions: {
    programmeEnabled: boolean;
    programmeTitle: string | null;
    primaryGoal: string | null;
  };
}

// Single source of truth for the dashboard's data, shared by the web page
// (app/(dashboard)/dashboard/page.tsx) and the mobile JSON API
// (app/api/mobile/dashboard/route.ts) — both render the same underlying
// numbers, just through different UI layers. Returns null for a signed-out
// or missing user; callers decide how to handle that (redirect for web,
// 401 for the API).
export function getDashboardData(userId: string | undefined): DashboardData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const profile = findProfileByUserId(user.id);
  const programme = findProgrammeByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);
  const subscription = findSubscriptionByUserId(user.id);
  const subscriptionPlan = resolveSubscriptionEntitlement(subscription);
  const recoveryLogs = findRecoveryLogsByUserId(user.id);
  const latestRecoveryLog = recoveryLogs[0];

  const cycleSettings =
    profile?.cycleTrackingEligible && profile.cycleTrackingEnabled
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

  const todayISO = new Date().toISOString().slice(0, 10);
  const todayReadiness = recoveryLogs.find((l) => l.date === todayISO)?.readinessScore ?? null;
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

  const sevenDaysAgoISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const sessionsLast7 = sessions.filter((s) => s.date >= sevenDaysAgoISO).length;

  const now = Date.now();
  const nextClass = findBookingsByUserId(user.id)
    .flatMap((b) => {
      const c = findClassById(b.classId);
      if (!c) return [];
      if (classStartMs(c.date, c.startTime) < now) return [];
      return [c];
    })
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))[0] ?? null;

  const needsAttention =
    !!subscription &&
    (isPeriodLapsed(subscription) || subscription.status === "past_due" || subscription.status === "canceled");

  const remaining =
    subscription && subscriptionPlan ? remainingSessions(subscriptionPlan, subscription) : null;

  return {
    firstName: profile?.fullName?.split(" ")[0] ?? "athlete",
    todayISO,
    nextSession: nextClass
      ? {
          classId: nextClass.id,
          title: nextClass.title,
          date: nextClass.date,
          startTime: nextClass.startTime,
          durationMins: nextClass.durationMins,
          category: nextClass.category,
          imageUrl: nextClass.imageUrl ?? null,
          imageAlt: nextClass.imageAlt ?? null,
        }
      : null,
    monthPassesRemaining: monthPasses?.remaining ?? null,
    hasMonthPasses: monthPasses !== null,
    readiness: {
      today: todayReadiness,
      status: todayReadiness !== null ? readinessStatus(todayReadiness) : null,
      guidance: todayReadiness !== null ? readinessGuidance(todayReadiness) : null,
      trend: readinessTrend,
      hasTrend,
      delta,
      phaseNote: phaseEstimate && phaseEstimate.phase !== "Unknown" ? phaseEstimate.readinessNote : null,
    },
    kpis: {
      sevenDaySum: rolling.sevenDaySum,
      daysWithLoad: rolling.daysWithLoad,
      loadBandLabel: LOAD_BAND_LABEL[loadBand],
      weekChangePct: weekChange,
      sleepHours: latestRecoveryLog?.sleepHours ?? null,
      sleepQuality: latestRecoveryLog?.sleepQuality ?? null,
      sessionsLast7,
    },
    nutrition: {
      dietaryPreference:
        profile?.dietaryPreference && profile.dietaryPreference !== "standard"
          ? profile.dietaryPreference
          : null,
    },
    club: {
      hasSubscription: !!subscription,
      planName: subscriptionPlan?.name ?? null,
      statusLabel: subscription ? SUBSCRIPTION_STATUS_LABEL[subscription.status] : null,
      isActive: subscription?.status === "active" && !isPeriodLapsed(subscription),
      needsAttention,
      remainingSessionsLabel:
        subscription && subscriptionPlan && subscription.status === "active" && !isPeriodLapsed(subscription)
          ? remaining === null
            ? "Unlimited sessions"
            : `${remaining} session${remaining === 1 ? "" : "s"} left`
          : null,
    },
    quickActions: {
      programmeEnabled: profile?.programmeEnabled ?? false,
      programmeTitle: programme?.title ?? null,
      primaryGoal: profile?.primaryGoal ?? null,
    },
  };
}
