// Watching Resend's free-plan caps (transactional: 3,000 a month and 100 a day, owner's plan 2026-11-17). Pure, so it is testable.
export const DEFAULT_DAILY_LIMIT = 100;
export const DEFAULT_MONTHLY_LIMIT = 3000;
export const EMAIL_USAGE_ALERT_SHARE = 0.8;

export function emailLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): { daily: number; monthly: number } {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return { daily: num(env.EMAIL_DAILY_LIMIT, DEFAULT_DAILY_LIMIT), monthly: num(env.EMAIL_MONTHLY_LIMIT, DEFAULT_MONTHLY_LIMIT) };
}

/** Start of the current UTC day and month, as ISO strings. Resend's own windows are assumed to be UTC. */
export function usageWindows(now: Date = new Date()): { dayStart: string; monthStart: string; dayKey: string; monthKey: string } {
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  return { dayStart: `${dayKey}T00:00:00.000Z`, monthStart: `${monthKey}-01T00:00:00.000Z`, dayKey, monthKey };
}

export interface UsageAlert {
  scope: "daily" | "monthly";
  used: number;
  limit: number;
  /** Once per window: the notification/dedupe key. */
  key: string;
}

/** Which caps have reached 80%. A cap already past 100% still reports (so the owner hears about it once). */
export function usageAlertsFor(used: { day: number; month: number }, limits: { daily: number; monthly: number }, now: Date = new Date()): UsageAlert[] {
  const w = usageWindows(now);
  const alerts: UsageAlert[] = [];
  if (used.day >= limits.daily * EMAIL_USAGE_ALERT_SHARE) alerts.push({ scope: "daily", used: used.day, limit: limits.daily, key: `email-usage-daily:${w.dayKey}` });
  if (used.month >= limits.monthly * EMAIL_USAGE_ALERT_SHARE) alerts.push({ scope: "monthly", used: used.month, limit: limits.monthly, key: `email-usage-monthly:${w.monthKey}` });
  return alerts;
}
