// Member profile stats: Classes completed, Total weight lifted, Total distance
// run — computed from the member's stored records over a selectable date range.
//
// Units are standardized here: weight in KG, distance in KM (the schema already
// pins runs to km). Rounding lives in the format* helpers so the UI is
// consistent everywhere. Everything is pure and grounded in stored fields:
//  - a "completed class" is a booking with attendedAt set (staff-marked),
//    time-bucketed by the class's calendar date;
//  - weight volume is Σ weight×reps×sets (per-set detail wins when present),
//    with non-numeric weights (bodyweight/blank) counting as 0;
//  - distance is Σ runs[].distance (already km).

import type { BookingRecord, WorkoutSessionRecord } from "./db";

export type StatsRange = "all" | "year" | "6months" | "3months" | "month" | "week" | "custom";

// One flattened workout: its date plus the volume/distance it contributed.
// Precomputed server-side so the client can filter by range instantly without
// shipping raw exercise rows.
export interface WorkoutStatEntry {
  date: string; // YYYY-MM-DD
  weightKg: number;
  distanceKm: number;
}

export interface MemberStatsData {
  workouts: WorkoutStatEntry[];
  /** Calendar dates (YYYY-MM-DD) of completed (attended) classes. */
  completedClassDates: string[];
}

export interface MemberStatTotals {
  classesCompleted: number;
  totalWeightKg: number;
  totalDistanceKm: number;
}

// Parse a stored weight string to a number; anything non-numeric (blank,
// "bodyweight", null) is 0 so it simply doesn't add to lifted volume.
function parseWeight(weight: string | null | undefined): number {
  if (!weight) return 0;
  const n = Number.parseFloat(weight);
  return Number.isFinite(n) ? n : 0;
}

// Total kg lifted in a single session: per exercise, per-set detail wins over
// the shared weight/reps/sets summary.
export function workoutVolumeKg(session: WorkoutSessionRecord): number {
  let total = 0;
  for (const ex of session.exercises ?? []) {
    if (ex.setDetails && ex.setDetails.length > 0) {
      for (const set of ex.setDetails) {
        total += parseWeight(set.weight) * (set.reps ?? 0);
      }
    } else {
      total += parseWeight(ex.weight) * (ex.reps ?? 0) * (ex.sets ?? 0);
    }
  }
  return total;
}

// Total km run in a single session.
export function workoutDistanceKm(session: WorkoutSessionRecord): number {
  let total = 0;
  for (const run of session.runs ?? []) {
    total += run.distance ?? 0;
  }
  return total;
}

// Flatten a member's raw records into range-filterable stat entries. classDateById
// maps a booking's classId to that class's calendar date; a booking whose class
// is missing falls back to the attendedAt date so it still counts.
export function buildMemberStatsData(
  workouts: WorkoutSessionRecord[],
  bookings: BookingRecord[],
  classDateById: Record<string, string>
): MemberStatsData {
  const workoutEntries: WorkoutStatEntry[] = workouts.map((s) => ({
    date: s.date,
    weightKg: workoutVolumeKg(s),
    distanceKm: workoutDistanceKm(s),
  }));

  const completedClassDates: string[] = [];
  for (const b of bookings) {
    if (!b.attendedAt) continue;
    const classDate = classDateById[b.classId] ?? b.attendedAt.slice(0, 10);
    completedClassDates.push(classDate);
  }

  return { workouts: workoutEntries, completedClassDates };
}

// Local YYYY-MM-DD for a Date (avoids UTC off-by-one from toISOString).
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The inclusive start date (YYYY-MM-DD) for a range, or null for "all time".
// customFrom is only used for the "custom" range.
export function rangeStartDate(
  range: StatsRange,
  today: Date = new Date(),
  customFrom?: string | null
): string | null {
  if (range === "all") return null;
  if (range === "custom") return customFrom && customFrom.trim() ? customFrom : null;

  const d = new Date(today);
  switch (range) {
    case "week":
      d.setDate(d.getDate() - 7);
      break;
    case "month":
      d.setMonth(d.getMonth() - 1);
      break;
    case "3months":
      d.setMonth(d.getMonth() - 3);
      break;
    case "6months":
      d.setMonth(d.getMonth() - 6);
      break;
    case "year":
      d.setFullYear(d.getFullYear() - 1);
      break;
  }
  return isoDate(d);
}

// Sum stats whose date falls within [startISO, endISO] (both inclusive; null =
// unbounded on that side).
export function sumStatsInRange(
  data: MemberStatsData,
  startISO: string | null,
  endISO: string | null
): MemberStatTotals {
  const inRange = (date: string) =>
    (startISO === null || date >= startISO) && (endISO === null || date <= endISO);

  let totalWeightKg = 0;
  let totalDistanceKm = 0;
  for (const w of data.workouts) {
    if (!inRange(w.date)) continue;
    totalWeightKg += w.weightKg;
    totalDistanceKm += w.distanceKm;
  }

  const classesCompleted = data.completedClassDates.filter(inRange).length;

  return { classesCompleted, totalWeightKg, totalDistanceKm };
}

// ── Display formatting (single source of rounding rules) ────────────────

// Weight: whole kg, thousands-separated. Volume is inherently approximate, so
// no decimals.
export function formatWeightKg(kg: number): string {
  return `${Math.round(kg).toLocaleString("en-IE")} kg`;
}

// Distance: one decimal km.
export function formatDistanceKm(km: number): string {
  return `${km.toFixed(1)} km`;
}
