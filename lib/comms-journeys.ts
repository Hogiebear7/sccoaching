// Which getting-started email is due for a member (owner plan 2026-11-17). Pure, so it is testable. Two separate journeys, and a gym membership always wins:
// a member with a live gym membership gets the gym journey and never the app one, and a member who moves from app-only to gym stops getting app emails at
// once (the journey is chosen at send time, not stored).
export type JourneyId = "app" | "gym";

export interface JourneyStep {
  id: string;
  /** Days after the journey started that this step becomes due. */
  afterDays: number;
}

export const APP_STEPS: JourneyStep[] = [
  { id: "app-welcome", afterDays: 0 },
  { id: "app-how-it-works", afterDays: 1 },
  { id: "app-check-in", afterDays: 3 },
  { id: "app-tip", afterDays: 5 },
];

export const GYM_STEPS: JourneyStep[] = [
  { id: "gym-welcome", afterDays: 0 },
  { id: "gym-booking", afterDays: 2 },
  { id: "gym-anything-we-should-know", afterDays: 5 },
];

/** A step missed by more than this many days is dropped rather than sent late (a welcome sent a fortnight late is odd). */
export const STEP_EXPIRY_DAYS = 3;

export function journeyFor(access: { gymMembership: boolean; digital: boolean }): JourneyId {
  return access.gymMembership ? "gym" : "app";
}

export function stepsFor(journey: JourneyId): JourneyStep[] {
  return journey === "gym" ? GYM_STEPS : APP_STEPS;
}

/**
 * The next step to send, or null. At most one per run, so a member never gets two on the same day. A step is due from `afterDays` after the start and
 * expires `STEP_EXPIRY_DAYS` later. Steps already sent are skipped.
 */
export function nextDueStep(opts: { journey: JourneyId; startedAtISO: string; now: Date; sent: Set<string> }): JourneyStep | null {
  const days = (opts.now.getTime() - Date.parse(opts.startedAtISO)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return null;
  for (const step of stepsFor(opts.journey)) {
    if (opts.sent.has(step.id)) continue;
    if (days >= step.afterDays && days < step.afterDays + STEP_EXPIRY_DAYS + 1) return step;
  }
  return null;
}
