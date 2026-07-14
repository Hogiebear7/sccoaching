// Friendly, spoken-style date display for member-facing class cards.
// Storage stays ISO (YYYY-MM-DD) everywhere — these helpers are UI-only.

// "Wednesday 15 July", prefixed with "Tomorrow, " when the date is exactly
// one calendar day after `now`, and "Today, " on the day itself. Locale is
// pinned to en-GB (hydration safety — same rule as the rest of the app).
export function formatFriendlyClassDate(isoDate: string, now: Date = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;

  const date = new Date(y, m - 1, d);
  const base = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (dayDiff === 0) return `Today, ${base}`;
  if (dayDiff === 1) return `Tomorrow, ${base}`;
  return base;
}
