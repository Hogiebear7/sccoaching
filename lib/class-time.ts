// The gym operates in Ireland — every class date/time in the data model
// ("2026-08-17", "07:00") is a wall-clock reading in Europe/Dublin, with no
// timezone info attached. Two patterns used throughout this codebase to
// turn that into a real instant — `new Date(dateOnlyString)` + .setHours(),
// and `new Date(`${date}T${startTime}`)` — both actually resolve using the
// SERVER's own local timezone, not Dublin's specifically. Locally that's
// invisible (dev machines here happen to already be set to Europe/Dublin),
// but production hosts commonly default to UTC, and Dublin is UTC+1 for
// roughly seven months of the year (BST) — so every one of those call
// sites was silently computing class start times up to an hour late
// whenever the server isn't already in Dublin time. Confirmed against a
// real member's misfired class reminder (see git history for this file).
//
// This is the one correct way to do it: Intl's real IANA timezone data is
// DST-aware and does not depend on the runtime's own local-time setting.

const GYM_TIME_ZONE = "Europe/Dublin";

// Standard "double conversion" trick: build the naive UTC instant for the
// wall-clock numbers, ask Intl what that instant reads as in Dublin, and
// use the difference to correct it. Works correctly across the BST/GMT
// transition for any date, including the clock-change day itself.
export function classStartMs(date: string, startTime: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = startTime.split(":").map(Number);

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: GYM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(naiveUtcMs))) {
    parts[part.type] = part.value;
  }

  // Some engines format midnight as "24" rather than "00" — normalize.
  const readHour = Number(parts.hour) % 24;

  const readAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    readHour,
    Number(parts.minute),
    Number(parts.second)
  );

  const offsetMs = readAsUtcMs - naiveUtcMs;
  return naiveUtcMs - offsetMs;
}

export function classStartDate(date: string, startTime: string): Date {
  return new Date(classStartMs(date, startTime));
}

// The current hour of day in the gym's own timezone — for anything gating
// behavior on "is it currently quiet hours / business hours in Dublin"
// (e.g. scheduling.ts's waitlist-offer quiet-hours extension), which needs
// Dublin's clock reading, not the server's.
export function currentHourInGymTimeZone(at: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: GYM_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(at)) % 24;
}

// "YYYY-MM-DD" for whatever calendar date `at` falls on in Dublin — en-CA
// happens to format that way by default.
export function gymLocalDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GYM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// The next occurrence (today or tomorrow, Dublin calendar) of `hour`:00 at
// or after `at` — e.g. "the next 10am Dublin time".
export function nextGymLocalHourMs(at: Date, hour: number): number {
  const hh = String(hour).padStart(2, "0");
  const todayStr = gymLocalDateString(at);
  const todayMs = classStartMs(todayStr, `${hh}:00`);
  if (todayMs > at.getTime()) return todayMs;

  // +25h from today's Dublin midnight always lands within tomorrow's
  // Dublin calendar date regardless of DST (a Dublin day is 23-25h long),
  // so re-reading the date from that instant reliably gives "tomorrow".
  const tomorrowProbe = new Date(classStartMs(todayStr, "00:00") + 25 * 60 * 60 * 1000);
  const tomorrowStr = gymLocalDateString(tomorrowProbe);
  return classStartMs(tomorrowStr, `${hh}:00`);
}
