// What a gym pays S&C depends on how big it is (owner decision 2026-11-25): up to 50 members, 51 to 100, 101 to 149, and 150 or more, billed monthly or yearly. A "member" is
// a member account that has not been archived.
//
// The band a gym pays for in a period is set by the HIGHEST member count seen in the previous period (a daily snapshot, see lib/jobs/tenant-member-high-water.ts), not by the
// count on renewal day. So taking members off before the month ends and adding them back afterwards does not lower the band. The band can still go down, but only when the whole
// period stayed lower.
//
// This file is only the rules (pure). The Stripe price for each band and interval is configured in TENANT_PRICES (JSON, below); money is only ever set in Stripe.
import type { GymPlatformBilling } from "./gyms-schema";

export type TenantInterval = "month" | "year";
export type TenantBand = "b50" | "b100" | "b149" | "b150";

export const TENANT_BANDS: { key: TenantBand; label: string; maxMembers: number }[] = [
  { key: "b50", label: "Up to 50 members", maxMembers: 50 },
  { key: "b100", label: "51 to 100 members", maxMembers: 100 },
  { key: "b149", label: "101 to 149 members", maxMembers: 149 },
  { key: "b150", label: "150 members or more", maxMembers: Number.POSITIVE_INFINITY },
];

export function bandForCount(count: number): TenantBand {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return (TENANT_BANDS.find((b) => n <= b.maxMembers) ?? TENANT_BANDS[TENANT_BANDS.length - 1]).key;
}

export function bandLabel(band: TenantBand): string {
  return TENANT_BANDS.find((b) => b.key === band)?.label ?? band;
}

export type TenantPriceMap = Record<TenantInterval, Record<TenantBand, string>>;

/**
 * TENANT_PRICES is JSON: {"month":{"b50":"price_...","b100":"price_...","b149":"price_...","b150":"price_..."},"year":{...same four...}}.
 * Returns null unless every one of the eight Stripe price ids is there and looks like a price id, so a half-filled setting never charges the wrong band.
 */
export function parseTenantPrices(raw: string | undefined | null): TenantPriceMap | null {
  if (!raw || !raw.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const out: Partial<TenantPriceMap> = {};
  for (const interval of ["month", "year"] as const) {
    const group = (value as Record<string, unknown> | null)?.[interval];
    if (!group || typeof group !== "object") return null;
    const bands: Partial<Record<TenantBand, string>> = {};
    for (const { key } of TENANT_BANDS) {
      const id = (group as Record<string, unknown>)[key];
      if (typeof id !== "string" || !/^price_[A-Za-z0-9]+$/.test(id)) return null;
      bands[key] = id;
    }
    out[interval] = bands as Record<TenantBand, string>;
  }
  return out as TenantPriceMap;
}

export function tenantPriceMap(): TenantPriceMap | null {
  return parseTenantPrices(process.env.TENANT_PRICES);
}

type HighWater = NonNullable<GymPlatformBilling["memberHighWater"]>;

/** Records today's member count: the peak only ever goes up within a period. Returns the same object when nothing changed. */
export function recordMemberCount(current: HighWater | undefined, count: number, today: string): HighWater {
  const n = Math.max(0, Math.floor(count));
  if (!current) return { peak: n, since: today };
  return n > current.peak ? { ...current, peak: n } : current;
}

/** The band for the NEXT period: the highest count seen this period (or the live count if that is higher). */
export function bandForNextPeriod(highWater: HighWater | undefined, liveCount: number): TenantBand {
  return bandForCount(Math.max(highWater?.peak ?? 0, liveCount));
}

/** A new period starts from the members the gym has right now (not from zero, and not from the old peak). */
export function startNewPeriod(count: number, today: string): HighWater {
  return { peak: Math.max(0, Math.floor(count)), since: today };
}
