// Client-safe pieces of the class-series model: pure constants and
// formatters with no db (fs) dependency, importable from client components.
// The generation engine lives in lib/class-series.ts (server-only).

export const WEEKDAY_LABELS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

export function describeSeriesDays(weekdays: number[]): string {
  return WEEKDAY_LABELS.filter((d) => weekdays.includes(d.value))
    .map((d) => d.short)
    .join(", ");
}
