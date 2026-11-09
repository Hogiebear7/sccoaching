// Server side of the member summary and class brief: gathers one member's data and hands it to lib/member-summary.ts. Callers MUST already have checked
// that the viewer is staff of the member's own gym and that the member holds a gym Membership (lib/member-tier-wall.ts); nothing here checks either.
import { classStartDate } from "./class-time";
import {
  findBodyWeightLogsByUserId,
  findBookingsByUserId,
  findClassById,
  findFoodEntriesByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findWaterLogByUserIdAndDate,
  findWorkoutSessionsByUserId,
} from "./db";
import { buildClassBrief, buildMemberSummary, daysAgoISO, type SummaryBooking, type SummaryInputs } from "./member-summary";
import { getResolvedNutritionTarget } from "./nutrition-target-data";

export function loadSummaryInputs(userId: string, todayISO: string = new Date().toISOString().slice(0, 10)): SummaryInputs {
  const profile = findProfileByUserId(userId);
  const now = Date.now();

  const bookings: SummaryBooking[] = findBookingsByUserId(userId).flatMap((b) => {
    const cls = findClassById(b.classId);
    if (!cls) return [];
    return [
      {
        date: cls.date,
        startTime: cls.startTime,
        title: cls.title,
        attended: b.attendedAt !== null,
        missed: b.attendedAt === null && b.noShowProcessedAt !== null,
        upcoming: classStartDate(cls.date, cls.startTime).getTime() >= now,
      },
    ];
  });

  const dates = [...Array(7)].map((_, i) => daysAgoISO(todayISO, i));
  const foodByDate: SummaryInputs["foodByDate"] = {};
  for (const e of findFoodEntriesByUserId(userId)) {
    if (!dates.includes(e.date)) continue;
    const day = (foodByDate[e.date] ??= { calories: 0, proteinG: 0 });
    day.calories += e.calories;
    day.proteinG += e.proteinG;
  }
  const waterByDate: SummaryInputs["waterByDate"] = {};
  for (const d of dates) {
    const log = findWaterLogByUserIdAndDate(userId, d);
    if (log) waterByDate[d] = log.ml;
  }

  let target: ReturnType<typeof getResolvedNutritionTarget> = null;
  try {
    target = getResolvedNutritionTarget(userId, todayISO, todayISO);
  } catch {
    target = null; // a missing or odd target never stops the summary
  }

  return {
    todayISO,
    fullName: profile?.fullName ?? null,
    primaryGoal: profile?.primaryGoal ?? null,
    trainingDaysPerWeek: profile?.trainingDaysPerWeek ?? null,
    goalWeightKg: profile?.goalWeightKg ?? null,
    goalTargetDate: profile?.goalTargetDate ?? null,
    sessions: findWorkoutSessionsByUserId(userId),
    bookings,
    recoveryLogs: findRecoveryLogsByUserId(userId),
    foodByDate,
    targetCalories: target?.calories ?? null,
    targetProteinG: target?.proteinG ?? null,
    waterByDate,
    weightLogs: findBodyWeightLogsByUserId(userId),
  };
}

export const memberSummaryFor = (userId: string, todayISO?: string) => buildMemberSummary(loadSummaryInputs(userId, todayISO));
export const classBriefFor = (userId: string, todayISO?: string) => buildClassBrief(loadSummaryInputs(userId, todayISO));
