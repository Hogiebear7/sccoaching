// Editing a repeating class for ALL its upcoming sessions at once, with a plain preview first.
// Pure planning only: the route loads the rows, calls planSeriesEdit, and (on apply) saves what the plan says.
import { classStartMs } from "./class-time";
import type { ClassRecord, ClassSeriesRecord } from "./db";

export interface SeriesChanges {
  title?: string;
  startTime?: string;
  durationMins?: number;
  capacity?: number;
}

export interface PlannedOccurrence {
  classId: string;
  date: string;
  bookings: number;
  /** Set when this session cannot take the change (fewer spaces than people already booked). */
  blocked: string | null;
}

export interface SeriesEditPlan {
  /** Cleaned changes that actually differ from the series today. */
  changes: SeriesChanges;
  occurrences: PlannedOccurrence[];
  willChange: number;
  blocked: number;
  bookedMembers: number;
  /** Plain sentences for the preview screen. */
  lines: string[];
  error: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanSeriesChanges(input: unknown): { changes: SeriesChanges; error: string | null } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const changes: SeriesChanges = {};
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 80) return { changes, error: "Class name must be 1 to 80 characters." };
    changes.title = raw.title.trim();
  }
  if (raw.startTime !== undefined) {
    if (typeof raw.startTime !== "string" || !TIME.test(raw.startTime.trim())) return { changes, error: "Start time must look like 18:30." };
    changes.startTime = raw.startTime.trim();
  }
  for (const key of ["durationMins", "capacity"] as const) {
    if (raw[key] === undefined) continue;
    const n = Number(raw[key]);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return { changes, error: key === "capacity" ? "Spaces must be a whole number, 1 or more." : "Length must be a whole number of minutes, 1 or more." };
    }
    changes[key] = n;
  }
  return { changes, error: null };
}

export function planSeriesEdit(
  series: ClassSeriesRecord,
  occurrences: ClassRecord[],
  bookingCount: (classId: string) => number,
  rawChanges: unknown,
  nowMs: number,
): SeriesEditPlan {
  const cleaned = cleanSeriesChanges(rawChanges);
  const empty: SeriesEditPlan = { changes: {}, occurrences: [], willChange: 0, blocked: 0, bookedMembers: 0, lines: [], error: cleaned.error };
  if (cleaned.error) return empty;

  // Keep only what really differs, so "nothing changed" can be told apart.
  const changes: SeriesChanges = {};
  if (cleaned.changes.title !== undefined && cleaned.changes.title !== series.title) changes.title = cleaned.changes.title;
  if (cleaned.changes.startTime !== undefined && cleaned.changes.startTime !== series.startTime) changes.startTime = cleaned.changes.startTime;
  if (cleaned.changes.durationMins !== undefined && cleaned.changes.durationMins !== series.durationMins) changes.durationMins = cleaned.changes.durationMins;
  if (cleaned.changes.capacity !== undefined && cleaned.changes.capacity !== series.capacity) changes.capacity = cleaned.changes.capacity;
  if (Object.keys(changes).length === 0) return { ...empty, error: "Nothing has been changed yet." };

  const upcoming = occurrences
    .filter((o) => o.seriesId === series.id && classStartMs(o.date, o.startTime) > nowMs)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const planned: PlannedOccurrence[] = upcoming.map((o) => {
    const bookings = bookingCount(o.id);
    const blocked = changes.capacity !== undefined && changes.capacity < bookings ? `${bookings} people are booked, so it cannot drop to ${changes.capacity} spaces` : null;
    return { classId: o.id, date: o.date, bookings, blocked };
  });

  const willChange = planned.filter((p) => !p.blocked).length;
  const blocked = planned.length - willChange;
  const bookedMembers = planned.filter((p) => !p.blocked).reduce((n, p) => n + p.bookings, 0);

  const lines: string[] = [];
  lines.push(
    planned.length === 0
      ? "There are no upcoming sessions yet. New sessions will use the new details."
      : `${willChange} upcoming session${willChange === 1 ? "" : "s"} will change.`,
  );
  if (changes.title) lines.push(`Name becomes "${changes.title}".`);
  if (changes.startTime) lines.push(`Start time becomes ${changes.startTime}.`);
  if (changes.durationMins) lines.push(`Length becomes ${changes.durationMins} minutes.`);
  if (changes.capacity) lines.push(`Spaces become ${changes.capacity}.`);
  if ((changes.startTime || changes.durationMins) && bookedMembers > 0) {
    lines.push(`${bookedMembers} booking${bookedMembers === 1 ? "" : "s"} will move to the new time. Let those members know.`);
  }
  if (blocked > 0) lines.push(`${blocked} session${blocked === 1 ? "" : "s"} will stay as they are, because more people are booked than the new number of spaces.`);
  lines.push("Past sessions are never changed.");

  return { changes, occurrences: planned, willChange, blocked, bookedMembers, lines, error: null };
}
