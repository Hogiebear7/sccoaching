import type { CycleSettingsRecord } from "./profile-schema";
import { findPregnancyStatusByUserId } from "./db";
import { cyclePauseFor, estimatePhase, pausedPhase, type CyclePause, type PhaseEstimate } from "./cycle-phase";

// The member's phase estimate with pregnancy taken into account. Every
// server-side phase display goes through here so none can show a phase
// while the cycle is paused.
export function memberCyclePause(userId: string, settings: CycleSettingsRecord | null | undefined, asOfDateISO?: string): CyclePause | null {
  return cyclePauseFor(findPregnancyStatusByUserId(userId), settings?.lastPeriodStartDate ?? null, asOfDateISO);
}

export function memberPhaseEstimate(
  userId: string,
  settings: CycleSettingsRecord | null | undefined,
  asOfDateISO?: string
): PhaseEstimate {
  const pause = memberCyclePause(userId, settings, asOfDateISO);
  if (pause) return pausedPhase(pause, settings?.averageCycleLengthDays ?? null);
  return estimatePhase(
    settings?.lastPeriodStartDate ?? null,
    settings?.averageCycleLengthDays ?? null,
    settings?.periodLengthDays ?? null,
    settings?.regularity ?? null,
    asOfDateISO
  );
}
