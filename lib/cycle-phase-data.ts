import type { CycleSettingsRecord } from "./profile-schema";
import { findPregnancyStatusByUserId, findProfileByUserId } from "./db";
import { cyclePauseFor, estimatePhase, pausedPhase, type CyclePause, type PhaseEstimate } from "./cycle-phase";
import { hasAccess } from "./member-access";
import { resolveMemberAccessForUser } from "./membership-entitlement";

// The member's phase estimate with pregnancy taken into account. Every
// server-side phase display goes through here so none can show a phase
// while the cycle is paused.
export function memberCyclePause(userId: string, settings: CycleSettingsRecord | null | undefined, asOfDateISO?: string): CyclePause | null {
  if (findProfileByUserId(userId)?.menopauseStage === "postmenopause") return "postmenopause";
  return cyclePauseFor(findPregnancyStatusByUserId(userId), settings?.lastPeriodStartDate ?? null, asOfDateISO);
}

export function memberPhaseEstimate(
  userId: string,
  settings: CycleSettingsRecord | null | undefined,
  asOfDateISO?: string
): PhaseEstimate {
  const pause = memberCyclePause(userId, settings, asOfDateISO);
  if (pause) return pausedPhase(pause, settings?.averageCycleLengthDays ?? null);
  const estimate = estimatePhase(
    settings?.lastPeriodStartDate ?? null,
    settings?.averageCycleLengthDays ?? null,
    settings?.periodLengthDays ?? null,
    settings?.regularity ?? null,
    asOfDateISO
  );
  // Cycles change length in perimenopause, so a dated estimate is rough.
  if (estimate.phase !== "Unknown" && findProfileByUserId(userId)?.menopauseStage === "perimenopause") {
    return {
      ...estimate,
      confidence: "low",
      explanation: `${estimate.explanation} In perimenopause cycles often change length, so treat this as a rough guide and log each new period start.`,
    };
  }
  return estimate;
}

/**
 * The phase estimate as THIS member may see it. Cycle tracking (the phase and what it means) is on the Free tier; the phase-aware training,
 * intensity and recovery guidance and the readiness note are part of the App subscription, so a Free member gets them empty. Use this, not
 * memberPhaseEstimate, wherever a member is shown their own estimate (staff views and the AI keep the full estimate).
 */
export function memberPhaseEstimateForViewer(userId: string, settings: CycleSettingsRecord | null): PhaseEstimate | null {
  const estimate = memberPhaseEstimate(userId, settings);
  if (!estimate || hasAccess(resolveMemberAccessForUser(userId), "cyclePhaseGuidance")) return estimate;
  return { ...estimate, trainingGuidance: "", intensityGuidance: "", recoveryGuidance: "", readinessNote: "" };
}
