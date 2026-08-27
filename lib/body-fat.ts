import type { BodyFatLogRecord } from "./db";

// Mirrors lib/body-weight.ts exactly — same "latest log wins, profile field
// is a synced mirror + cold-start fallback" invariant, same write-path
// contract (both /api/profile/body-fat and Profile's edit form maintain it).

export function latestBodyFatLog(
  logs: BodyFatLogRecord[]
): BodyFatLogRecord | null {
  if (logs.length === 0) return null;
  return [...logs].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  )[0];
}

export function resolveCurrentBodyFatPct(
  profileBodyFatPct: number | null | undefined,
  logs: BodyFatLogRecord[]
): number | null {
  return latestBodyFatLog(logs)?.bodyFatPct ?? profileBodyFatPct ?? null;
}
