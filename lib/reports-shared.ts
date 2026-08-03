// Pure report helpers safe to import from client components — no dependency
// on lib/db.ts (which pulls in Node's `fs` and breaks the client bundle if
// imported transitively). Mirrors the lib/finance.ts / lib/finance-shared.ts
// split. Server-only row-building lives in lib/reports.ts; this file takes
// those raw rows and does the range filtering/grouping, so switching the
// date range on the Reports tab is instant (no server round trip), same as
// Finances.

export interface ReportRangePreset {
  key: "this_month" | "last_month" | "this_year" | "all_time";
  label: string;
}

export const REPORT_RANGE_PRESETS: ReportRangePreset[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

// Returns [fromISO, toISO) — toISO is exclusive. null bounds mean "no limit"
// on that side (used by all_time).
export function boundsForReportPreset(
  preset: ReportRangePreset["key"],
  now = new Date()
): [string | null, string | null] {
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this_month":
      return [new Date(y, m, 1).toISOString(), new Date(y, m + 1, 1).toISOString()];
    case "last_month":
      return [new Date(y, m - 1, 1).toISOString(), new Date(y, m, 1).toISOString()];
    case "this_year":
      return [new Date(y, 0, 1).toISOString(), new Date(y + 1, 0, 1).toISOString()];
    case "all_time":
      return [null, null];
  }
}

export interface MemberSignupRow {
  userId: string;
  email: string;
  fullName: string | null;
  createdAt: string;
}

export interface SubscriptionRow {
  userId: string;
  email: string;
  fullName: string | null;
  /** Set once, on first-ever activation, and preserved across every later
      re-activation/renewal (see lib/db.ts saveSubscription) — a reliable
      "became a paying member" date, distinct from account signup. */
  createdAt: string;
  /** Last time this subscription's status changed — the best available
      timestamp for a cancellation, since there's no separate history log. */
  updatedAt: string;
  status: string;
}

export interface ClassReportRow {
  classId: string;
  title: string;
  date: string;
  startTime: string;
  categoryLabel: string;
  bookingCount: number;
  capacity: number;
  attendedCount: number;
}

export interface ClassTypeReportRow {
  label: string;
  classCount: number;
  bookingCount: number;
  attendedCount: number;
  capacityTotal: number;
}

export function filterByRange<T>(
  items: T[],
  getISO: (item: T) => string,
  fromISO: string | null,
  toISO: string | null
): T[] {
  return items.filter((item) => {
    const iso = getISO(item);
    if (fromISO && iso < fromISO) return false;
    if (toISO && iso >= toISO) return false;
    return true;
  });
}

// ClassReportRow.date is a plain "YYYY-MM-DD" calendar date with no time
// component (see ClassRecord in lib/db.ts) — compared against the date-only
// slice of the range bounds. This carries the same small timezone
// imprecision (at most a day at a month boundary, depending on the viewer's
// timezone) that already exists everywhere else class dates are handled in
// this app; not worth a stricter scheme than the rest of the codebase uses.
export function filterClassesByRange(
  rows: ClassReportRow[],
  fromISO: string | null,
  toISO: string | null
): ClassReportRow[] {
  const from = fromISO ? fromISO.slice(0, 10) : null;
  const to = toISO ? toISO.slice(0, 10) : null;
  return rows.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date >= to) return false;
    return true;
  });
}

export function groupClassesByType(rows: ClassReportRow[]): ClassTypeReportRow[] {
  const map = new Map<string, ClassTypeReportRow>();
  for (const row of rows) {
    const entry = map.get(row.categoryLabel) ?? {
      label: row.categoryLabel,
      classCount: 0,
      bookingCount: 0,
      attendedCount: 0,
      capacityTotal: 0,
    };
    entry.classCount += 1;
    entry.bookingCount += row.bookingCount;
    entry.attendedCount += row.attendedCount;
    entry.capacityTotal += row.capacity;
    map.set(row.categoryLabel, entry);
  }
  return [...map.values()].sort((a, b) => b.bookingCount - a.bookingCount);
}

export function currentlyActiveCount(subscriptions: SubscriptionRow[]): number {
  return subscriptions.filter((s) => s.status === "active").length;
}

// Retention proxy: of members who first activated before the range began,
// how many are still active today. null when the range has no start (All
// time), since "before the range" is meaningless there. This app only
// stores each member's CURRENT status, not a full history, so this is the
// best available proxy — not a precise point-in-time figure. See the
// methodology note in ReportsView.tsx.
export function computeRetention(
  subscriptions: SubscriptionRow[],
  fromISO: string | null
): { retainedCount: number | null; retainedBaseCount: number | null } {
  if (!fromISO) return { retainedCount: null, retainedBaseCount: null };
  const priorStarters = subscriptions.filter((s) => s.createdAt < fromISO);
  return {
    retainedBaseCount: priorStarters.length,
    retainedCount: priorStarters.filter((s) => s.status === "active").length,
  };
}
