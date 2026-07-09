import type { BodyWeightLogRecord } from "./db";

// Single source of truth for "current weight":
//   the latest body-weight log entry wins; the profile field is a synced
//   mirror (and the fallback for members with no logs yet).
//
// Both write paths maintain the invariant:
//   - logging a weight updates profile.currentWeightKg to the latest entry
//   - editing the weight in Profile upserts today's log entry
// and read sites resolve through this helper so a mismatch can never show.

export function latestWeightLog(
  logs: BodyWeightLogRecord[]
): BodyWeightLogRecord | null {
  if (logs.length === 0) return null;
  return [...logs].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  )[0];
}

export function resolveCurrentWeightKg(
  profileWeightKg: number | null,
  logs: BodyWeightLogRecord[]
): number | null {
  return latestWeightLog(logs)?.weightKg ?? profileWeightKg;
}
