import { getFinanceSettings } from "./db";
import { buildRevenueLines } from "./finance";
import { boundsForPreset, sumCents } from "./finance-shared";
import { buildClassReportRows, buildMemberSignupRows, buildSubscriptionRows } from "./reports";
import { boundsForReportPreset, currentlyActiveCount, filterByRange, filterClassesByRange } from "./reports-shared";

export interface StaffBusinessData {
  revenue: {
    thisMonthCents: number;
    lastMonthCents: number;
    currency: string;
    taxRatePercent: number | null;
  } | null;
  membership: {
    activeMembers: number;
    newSignupsThisMonth: number;
  } | null;
  classes: {
    classesThisMonth: number;
    bookingsThisMonth: number;
    attendedThisMonth: number;
  } | null;
}

// Mobile-first "Business" snapshot: this-month vs last-month revenue, active
// member count, and this-month class throughput. The web app's Finances and
// Reports tabs additionally have full line-item ledgers, custom date
// ranges, age-bracket/retention breakdowns, and per-class-type tables — a
// separate, larger mobile build; this is the at-a-glance numbers an owner
// actually checks from their phone. Each section is independently gated by
// the caller's capabilities (finance.view / reports.view), same as the web
// staff nav — null means "not permitted to see this section".
export function getStaffBusinessData(
  canViewFinance: boolean,
  canViewReports: boolean
): StaffBusinessData {
  let revenue: StaffBusinessData["revenue"] = null;
  if (canViewFinance) {
    const lines = buildRevenueLines();
    const [thisMonthFrom, thisMonthTo] = boundsForPreset("this_month");
    const [lastMonthFrom, lastMonthTo] = boundsForPreset("last_month");
    const thisMonthLines = filterByRange(lines, (l) => l.occurredAt, thisMonthFrom, thisMonthTo);
    const lastMonthLines = filterByRange(lines, (l) => l.occurredAt, lastMonthFrom, lastMonthTo);
    const settings = getFinanceSettings();
    revenue = {
      thisMonthCents: sumCents(thisMonthLines),
      lastMonthCents: sumCents(lastMonthLines),
      currency: lines[0]?.currency ?? "EUR",
      taxRatePercent: settings.taxRatePercent,
    };
  }

  let membership: StaffBusinessData["membership"] = null;
  let classes: StaffBusinessData["classes"] = null;
  if (canViewReports) {
    const [thisMonthFrom, thisMonthTo] = boundsForReportPreset("this_month");
    const subscriptions = buildSubscriptionRows();
    const signups = buildMemberSignupRows();
    membership = {
      activeMembers: currentlyActiveCount(subscriptions),
      newSignupsThisMonth: filterByRange(signups, (s) => s.createdAt, thisMonthFrom, thisMonthTo).length,
    };

    const classRows = filterClassesByRange(buildClassReportRows(), thisMonthFrom, thisMonthTo);
    classes = {
      classesThisMonth: classRows.length,
      bookingsThisMonth: classRows.reduce((sum, r) => sum + r.bookingCount, 0),
      attendedThisMonth: classRows.reduce((sum, r) => sum + r.attendedCount, 0),
    };
  }

  return { revenue, membership, classes };
}
