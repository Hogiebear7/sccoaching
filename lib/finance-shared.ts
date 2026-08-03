// Pure revenue helpers safe to import from client components — no
// dependency on lib/db.ts (which pulls in Node's `fs` and breaks the client
// bundle if imported transitively). Server-only aggregation that actually
// reads the datastore lives in lib/finance.ts, which imports from here.

export type RevenueKind = "membership_renewal" | "pass_pack";

export interface RevenueLine {
  id: string;
  userId: string;
  amountCents: number;
  currency: string;
  provider: string;
  kind: RevenueKind;
  packageName: string | null;
  ageBracket: AgeBracket;
  /** ISO timestamp this payment was actually received — the field every
      range filter and grouping operates on. */
  occurredAt: string;
}

export function sumCents(lines: RevenueLine[]): number {
  return lines.reduce((total, l) => total + l.amountCents, 0);
}

export interface RevenueRangePreset {
  key: "this_month" | "last_month" | "this_year" | "all_time";
  label: string;
}

export const REVENUE_RANGE_PRESETS: RevenueRangePreset[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

// Returns [fromISO, toISO) — toISO is exclusive. null bounds mean "no limit"
// on that side (used by all_time).
export function boundsForPreset(preset: RevenueRangePreset["key"], now = new Date()): [string | null, string | null] {
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

export function filterByRange(lines: RevenueLine[], fromISO: string | null, toISO: string | null): RevenueLine[] {
  return lines.filter((l) => {
    if (fromISO && l.occurredAt < fromISO) return false;
    if (toISO && l.occurredAt >= toISO) return false;
    return true;
  });
}

export function groupByPackage(lines: RevenueLine[]): { label: string; amountCents: number; count: number }[] {
  const map = new Map<string, { amountCents: number; count: number }>();
  for (const l of lines) {
    const label = l.packageName ?? "Unknown package";
    const entry = map.get(label) ?? { amountCents: 0, count: 0 };
    entry.amountCents += l.amountCents;
    entry.count += 1;
    map.set(label, entry);
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

// ─── Age brackets — shared by Finances (revenue cut) and Members (headcount
// cut). ─────────────────────────────────────────────────────────────────

export type AgeBracket = "under_18" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus" | "unknown";

export const AGE_BRACKETS: AgeBracket[] = [
  "under_18",
  "18_24",
  "25_34",
  "35_44",
  "45_54",
  "55_64",
  "65_plus",
  "unknown",
];

export const AGE_BRACKET_LABEL: Record<AgeBracket, string> = {
  under_18: "Under 18",
  "18_24": "18–24",
  "25_34": "25–34",
  "35_44": "35–44",
  "45_54": "45–54",
  "55_64": "55–64",
  "65_plus": "65+",
  unknown: "Unknown",
};

export function ageFromDateOfBirth(dateOfBirth: string | null | undefined, onDate = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = onDate.getFullYear() - dob.getFullYear();
  const monthDiff = onDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function ageBracketForAge(age: number | null): AgeBracket {
  if (age === null) return "unknown";
  if (age < 18) return "under_18";
  if (age <= 24) return "18_24";
  if (age <= 34) return "25_34";
  if (age <= 44) return "35_44";
  if (age <= 54) return "45_54";
  if (age <= 64) return "55_64";
  return "65_plus";
}

export function groupByAgeBracket(lines: RevenueLine[]): { bracket: AgeBracket; label: string; amountCents: number; count: number }[] {
  const map = new Map<AgeBracket, { amountCents: number; count: number }>();
  for (const l of lines) {
    const entry = map.get(l.ageBracket) ?? { amountCents: 0, count: 0 };
    entry.amountCents += l.amountCents;
    entry.count += 1;
    map.set(l.ageBracket, entry);
  }
  return AGE_BRACKETS.filter((b) => map.has(b)).map((bracket) => ({
    bracket,
    label: AGE_BRACKET_LABEL[bracket],
    ...map.get(bracket)!,
  }));
}
