// Minimal iCalendar (.ics) generator for a single class booking. Emits a
// "floating" local time (no Z suffix, no VTIMEZONE) — the gym runs a single
// physical location, so every member reads the class time correctly without
// needing timezone conversion, and it keeps the format simple and broadly
// compatible with Apple/Google/Outlook calendar imports.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// "2026-08-10" + "07:00" + 45 -> { start: "20260810T070000", end: "20260810T074500" }
function classDateTimeStamps(date: string, startTime: string, durationMins: number) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = startTime.split(":").map(Number);
  const start = new Date(y, m - 1, d, h, min);
  const end = new Date(start.getTime() + durationMins * 60_000);

  const stamp = (dt: Date) =>
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;

  return { start: stamp(start), end: stamp(end) };
}

// Escapes text per RFC 5545 (backslash, semicolon, comma, then newlines).
function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildClassIcsEvent({
  uid,
  title,
  date,
  startTime,
  durationMins,
  location,
  description,
}: {
  uid: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
  location?: string;
  description?: string;
}): string {
  const { start, end } = classDateTimeStamps(date, startTime, durationMins);
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//S&C Performance Coaching//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n");
}
