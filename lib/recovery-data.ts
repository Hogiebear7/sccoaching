import {
  findCycleSettingsByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "./db";
import { memberPhaseEstimateForViewer } from "./cycle-phase-data";
import { hasHealthNoteAccess } from "./health-note";
import { resolveMemberAccessForUser } from "./membership-entitlement";
import { computeRollingTrainingLoad, readinessGuidance } from "./recovery";

export interface RecoveryLogSummary {
  id: string;
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  fatigue: number | null;
  trainingDurationMins: number | null;
  rpe: number | null;
  goal: string | null;
  notes: string | null;
  /** The optional "injured or sick?" note (App tier or gym Membership). */
  healthNote: string | null;
  readinessScore: number | null;
}

export interface RecoveryData {
  /** True when this member can write the "injured or sick?" note (App tier or gym Membership); the app shows the field only then. */
  healthNoteEnabled: boolean;
  logs: RecoveryLogSummary[];
  latestReadinessScore: number | null;
  latestGuidance: string | null;
  rollingLoad: { sevenDaySum: number; sevenDayAverage: number; daysWithLoad: number };
  phaseNote: string | null;
  hasLoggedToday: boolean;
  todayISO: string;
}

// Shared by the web Recovery page (app/(dashboard)/dashboard/recovery/
// page.tsx) and the mobile JSON API (app/api/mobile/recovery/route.ts).
export function getRecoveryData(userId: string | undefined): RecoveryData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const logs = findRecoveryLogsByUserId(user.id);
  const latestLog = logs[0] ?? null;
  const sessions = findWorkoutSessionsByUserId(user.id);
  const rollingLoad = computeRollingTrainingLoad(logs, sessions);

  const profile = findProfileByUserId(user.id);
  const cycleSettings =
    profile?.cycleTrackingEligible && profile.cycleTrackingEnabled
      ? findCycleSettingsByUserId(user.id)
      : undefined;
  const phaseEstimate = cycleSettings
    ? memberPhaseEstimateForViewer(user.id, cycleSettings)
    : null;

  const todayISO = new Date().toISOString().slice(0, 10);

  return {
    healthNoteEnabled: hasHealthNoteAccess(resolveMemberAccessForUser(user.id)),
    logs: logs.map((l) => ({
      id: l.id,
      date: l.date,
      sleepHours: l.sleepHours,
      sleepQuality: l.sleepQuality,
      soreness: l.soreness,
      fatigue: l.fatigue,
      trainingDurationMins: l.trainingDurationMins,
      rpe: l.rpe,
      goal: l.goal,
      notes: l.notes,
      healthNote: l.healthNote ?? null,
      readinessScore: l.readinessScore,
    })),
    latestReadinessScore: latestLog?.readinessScore ?? null,
    latestGuidance:
      latestLog && latestLog.readinessScore !== null ? readinessGuidance(latestLog.readinessScore) : null,
    rollingLoad,
    phaseNote: phaseEstimate && phaseEstimate.phase !== "Unknown" ? phaseEstimate.readinessNote : null,
    hasLoggedToday: logs.some((l) => l.date === todayISO),
    todayISO,
  };
}
