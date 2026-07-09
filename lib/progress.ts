// Pure derivations for athlete-progress displays: readiness series and
// deltas, week-by-week training load, and intensity mix. All computed from
// the member's own recovery logs — nothing here estimates or invents data;
// days without a log stay null/absent and render as gaps.

import type { RecoveryLogRecord } from "./db";
import { trainingLoadForLog } from "./recovery";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday of the ISO week containing the date.
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

// ISO-8601 week number, for compact week labels ("W28").
export function isoWeekNumber(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  // Shift to the Thursday of this week — ISO weeks belong to the year of
  // their Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

// Daily readiness scores for the trailing window, oldest → newest.
// One slot per day; null where no log (or no score) exists.
export function readinessSeries(
  logs: RecoveryLogRecord[],
  todayISO: string,
  days = 14
): (number | null)[] {
  const byDate = new Map<string, number>();
  for (const log of logs) {
    if (log.readinessScore !== null) byDate.set(log.date, log.readinessScore);
  }
  const series: (number | null)[] = [];
  for (let i = days - 1; i >= 0; i--) {
    series.push(byDate.get(addDays(todayISO, -i)) ?? null);
  }
  return series;
}

// Today's readiness compared with the most recent earlier log that has a
// score. Null when either side is missing.
export function readinessDelta(
  logs: RecoveryLogRecord[],
  todayISO: string
): number | null {
  const todayScore = logs.find((l) => l.date === todayISO)?.readinessScore ?? null;
  if (todayScore === null) return null;
  const previous = logs
    .filter((l) => l.date < todayISO && l.readinessScore !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!previous || previous.readinessScore === null) return null;
  return todayScore - previous.readinessScore;
}

export interface WeekSummary {
  weekStartISO: string;
  /** Compact ISO-week label, e.g. "W28". */
  label: string;
  isCurrentWeek: boolean;
  /** Mon→Sun training load (duration × RPE); null = no load logged. */
  dayLoads: (number | null)[];
  totalLoad: number;
  /** Change vs the previous week's total, percent; null when not comparable. */
  changePct: number | null;
}

// Week-by-week training summary, newest week first.
export function weeklyTrainingSummary(
  logs: RecoveryLogRecord[],
  todayISO: string,
  weeks = 5
): WeekSummary[] {
  const loadByDate = new Map<string, number>();
  for (const log of logs) {
    const load = trainingLoadForLog(log);
    if (load !== null) loadByDate.set(log.date, (loadByDate.get(log.date) ?? 0) + load);
  }

  const currentMonday = mondayOf(todayISO);
  // Oldest → newest so change % can chain, then reversed for display.
  const summaries: WeekSummary[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStartISO = addDays(currentMonday, -7 * w);
    const dayLoads: (number | null)[] = [];
    let totalLoad = 0;
    for (let d = 0; d < 7; d++) {
      const load = loadByDate.get(addDays(weekStartISO, d)) ?? null;
      dayLoads.push(load);
      totalLoad += load ?? 0;
    }
    const prev = summaries[summaries.length - 1];
    const changePct =
      prev && prev.totalLoad > 0
        ? Math.round(((totalLoad - prev.totalLoad) / prev.totalLoad) * 100)
        : null;
    summaries.push({
      weekStartISO,
      label: `W${isoWeekNumber(weekStartISO)}`,
      isCurrentWeek: weekStartISO === currentMonday,
      dayLoads,
      totalLoad,
      changePct,
    });
  }
  return summaries.reverse();
}

export interface IntensityMix {
  /** Share of training load done at RPE ≤ 5 / 6–7 / ≥ 8, in percent. */
  easyPct: number;
  moderatePct: number;
  hardPct: number;
  sessions: number;
}

// Distribution of the trailing window's training load across RPE bands,
// weighted by each session's load so a long easy day counts for more than a
// short one. Null when nothing in the window has both duration and RPE.
export function intensityMix(
  logs: RecoveryLogRecord[],
  todayISO: string,
  days = 28
): IntensityMix | null {
  const fromISO = addDays(todayISO, -(days - 1));
  let easy = 0;
  let moderate = 0;
  let hard = 0;
  let sessions = 0;

  for (const log of logs) {
    if (log.date < fromISO || log.date > todayISO) continue;
    const load = trainingLoadForLog(log);
    if (load === null || log.rpe === null) continue;
    sessions += 1;
    if (log.rpe <= 5) easy += load;
    else if (log.rpe <= 7) moderate += load;
    else hard += load;
  }

  const total = easy + moderate + hard;
  if (total === 0) return null;

  const easyPct = Math.round((easy / total) * 100);
  const hardPct = Math.round((hard / total) * 100);
  return {
    easyPct,
    hardPct,
    moderatePct: 100 - easyPct - hardPct,
    sessions,
  };
}

// SVG polyline points for a compact sparkline. Null values leave gaps by
// splitting into segments; returns one points-string per contiguous run.
export function sparklineSegments(
  values: (number | null)[],
  width: number,
  height: number,
  min = 0,
  max = 100
): string[] {
  if (values.length === 0) return [];
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const range = max - min || 1;
  const segments: string[] = [];
  let current: string[] = [];

  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = Math.round(i * stepX * 10) / 10;
    const y = Math.round((height - ((v - min) / range) * height) * 10) / 10;
    current.push(`${x},${y}`);
  });
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}
