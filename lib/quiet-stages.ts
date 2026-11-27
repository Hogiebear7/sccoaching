// How long a member has been quiet, in the stages staff act on. Pure and shared so the Attendance chips and tests agree.
export const QUIET_STAGES = [
  { key: "q10", label: "10+ days quiet", minDays: 10 },
  { key: "q15", label: "15+ days", minDays: 15 },
  { key: "q20", label: "20+ days", minDays: 20 },
  { key: "q30", label: "30+ days", minDays: 30 },
] as const;

export type QuietStageKey = (typeof QUIET_STAGES)[number]["key"];

/** Whole days between a YYYY-MM-DD date and now (UTC); null when there is no date (never attended). */
export function daysQuiet(lastDate: string | null, now: Date = new Date()): number | null {
  if (!lastDate) return null;
  const then = Date.parse(`${lastDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor((today - then) / 86_400_000));
}

/** True when the member has been quiet at least `minDays`. Never-attended members are not "quiet": they have a chip of their own. */
export function isQuietAtLeast(lastDate: string | null, minDays: number, now: Date = new Date()): boolean {
  const d = daysQuiet(lastDate, now);
  return d !== null && d >= minDays;
}
