import { randomUUID } from "crypto";

import {
  findClassBySeriesAndDate,
  findClassSeries,
  saveClass,
  type ClassRecord,
  type ClassSeriesRecord,
} from "./db";

// Recurring classes are a SERIES that generates ordinary ClassRecord
// occurrences on a rolling horizon — never an unbounded materialisation.
// Each generated occurrence is a normal class: bookable, waitlistable,
// editable and deletable one at a time. Generation is idempotent (one
// occurrence per series+date) and honours tombstones (skippedDates), so a
// deleted or moved occurrence never comes back on the next run.

/** How far ahead occurrences exist at any time. Refilled daily by the cron
    job and on every staff Classes page load, so the window never drains. */
export const SERIES_HORIZON_DAYS = 28;

// Plain Y-M-D arithmetic (local calendar space) — the same timezone-safe
// approach the classes route uses; no UTC round-trips that can shift days.
function isoAddDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + days);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

function isoWeekday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function todayISO(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Creates any missing occurrences for one series within the horizon.
 * Returns how many were created on this call.
 */
export function generateOccurrencesForSeries(
  series: ClassSeriesRecord,
  now: Date = new Date()
): number {
  if (!series.isActive) return 0;

  const from = todayISO(now);
  const start = series.startDate > from ? series.startDate : from;
  const horizonEnd = isoAddDays(from, SERIES_HORIZON_DAYS);
  const end = series.endDate !== null && series.endDate < horizonEnd ? series.endDate : horizonEnd;

  let created = 0;

  for (let date = start; date <= end; date = isoAddDays(date, 1)) {
    if (!series.weekdays.includes(isoWeekday(date))) continue;
    if (series.skippedDates.includes(date)) continue;
    if (findClassBySeriesAndDate(series.id, date)) continue;

    const nowIso = new Date().toISOString();
    const occurrence: ClassRecord = {
      id: randomUUID(),
      title: series.title,
      category: series.category,
      coachUserId: series.coachUserId,
      date,
      startTime: series.startTime,
      durationMins: series.durationMins,
      capacity: series.capacity,
      seriesId: series.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    saveClass(occurrence);
    created += 1;
  }

  return created;
}

/** Tops up every active series. Safe to call from anywhere, any number of
    times — generation is keyed on (series, date). */
export function ensureSeriesOccurrences(now: Date = new Date()): number {
  let created = 0;
  for (const series of findClassSeries()) {
    created += generateOccurrencesForSeries(series, now);
  }
  return created;
}

// Client-safe constants/formatters are re-exported from the shared module
// so server code can keep one import path.
export { WEEKDAY_LABELS, describeSeriesDays } from "./class-series-shared";
