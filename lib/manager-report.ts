// Builds the weekly and monthly manager reports from the datastore (docs/manager-reports-2026-11.md). READ-ONLY: nothing here writes anything. Every number is plain
// arithmetic on stored records, reusing the same sources as the rest of the staff area (the Finances ledger and its tax-rate setting, the Reports class rows, the
// Overview's attendance and gone-quiet logic), so a figure here matches the page it came from. No AI is involved.
//
// Scope: every report is for ONE gym (the acting person's own). The money, app and platform sections are only built for the platform owner, and only for the
// primary S&C gym: tenant billing is not live, so tenant reports carry no money. SERVER-ONLY (imports lib/db.ts).

import {
  findAllAiUsageLogs,
  findAllDigitalEntitlements,
  findAllNoShows,
  findAllPurchases,
  findGymBySlug,
  findGyms,
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findMembers,
  findSubscriptionByUserId,
  findUserById,
  getFinanceSettings,
  type DigitalEntitlementRecord,
} from "@/lib/db";
import { describeDigitalPlan } from "@/lib/digital-entitlement";
import { buildFinanceLedgerLines } from "@/lib/finance";
import { sameGym } from "@/lib/gym-scope";
import { memberListGroup } from "@/lib/member-list-group";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { purchasedPassBalance } from "@/lib/payments";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";
import { isPlatformOperator, isStaffRole } from "@/lib/permissions";
import { buildClassReportRows, groupClassesByType, type ClassReportRow } from "@/lib/reports";
import { buildStaffToday } from "@/lib/staff-today";
import {
  buildAttention,
  busiestHours,
  effectiveTaxRate,
  inPeriod,
  percentChange,
  previousPeriod,
  reportPeriod,
  summarizeAiCost,
  summarizeMoney,
  taxSetAsideCents,
  type AppSection,
  type Comparison,
  type GymMoneySection,
  type GymSection,
  type ManagerReport,
  type PlatformGymRow,
  type ReportCadence,
  type ReportPeriod,
} from "@/lib/manager-report-shared";
import type { FinanceLine } from "@/lib/finance-shared";

export * from "@/lib/manager-report-shared";

export interface ReportActor {
  id: string;
  role: string;
  gymId?: string | null;
}

const PRIMARY_GYM_NAME = "S&C Performance Coaching";

function gymNameFor(gymId: string | null | undefined): string {
  if (!gymId) return findGymBySlug(PRIMARY_GYM_SLUG)?.name ?? PRIMARY_GYM_NAME;
  return findGyms().find((g) => g.id === gymId)?.name ?? "Your gym";
}

const cmp = (current: number, previous: number | null): Comparison => ({ previous, changePercent: percentChange(current, previous) });

// The figures that need a previous-period comparison, for one gym and one period.
interface CoreFigures {
  rows: ClassReportRow[];
  bookings: number;
  attended: number;
  noShows: number;
  capacity: number;
  signups: number;
  lost: number;
}

function coreFigures(gym: { gymId?: string | null }, period: ReportPeriod): CoreFigures {
  const rows = buildClassReportRows(gym).filter((r) => r.date >= period.startDate && r.date < period.endDate);
  const classIds = new Set(rows.map((r) => r.classId));
  const members = findMembers().filter((m) => sameGym(gym, m) && !m.archivedAt);
  const lost = members.filter((m) => {
    const sub = findSubscriptionByUserId(m.id);
    return memberListGroup(sub, findMembershipPackageById) === "past" && inPeriod(period, sub?.updatedAt);
  }).length;
  return {
    rows,
    bookings: rows.reduce((n, r) => n + r.bookingCount, 0),
    attended: rows.reduce((n, r) => n + r.attendedCount, 0),
    noShows: findAllNoShows().filter((n) => classIds.has(n.classId) && n.classDate >= period.startDate && n.classDate < period.endDate).length,
    capacity: rows.reduce((n, r) => n + r.capacity, 0),
    signups: members.filter((m) => inPeriod(period, m.createdAt)).length,
    lost,
  };
}

function buildGymSection(actor: ReportActor, period: ReportPeriod, now: Date): GymSection {
  const gym = { gymId: actor.gymId ?? null };
  const cur = coreFigures(gym, period);
  const prev = coreFigures(gym, previousPeriod(period));
  const members = findMembers().filter((m) => sameGym(gym, m) && !m.archivedAt);
  const groups = members.map((m) => memberListGroup(findSubscriptionByUserId(m.id), findMembershipPackageById));
  const memberIds = new Set(members.map((m) => m.id));
  const passesBought = findAllPurchases().filter((p) => p.kind === "pass_pack" && p.status === "paid" && memberIds.has(p.userId) && inPeriod(period, p.updatedAt)).length;
  const quiet = buildStaffToday(gym, now).atRisk;

  return {
    bookings: {
      total: cur.bookings,
      attended: cur.attended,
      noShows: cur.noShows,
      classes: cur.rows.length,
      fillRate: cur.capacity > 0 ? cur.attended / cur.capacity : null,
      byType: groupClassesByType(cur.rows),
      busiestHours: busiestHours(cur.rows),
      comparison: cmp(cur.bookings, prev.bookings),
    },
    members: {
      total: members.length,
      current: groups.filter((g) => g === "current").length,
      paused: groups.filter((g) => g === "paused").length,
      passHolders: members.filter((m) => purchasedPassBalance(m.id, now) > 0).length,
      newSignups: cur.signups,
      newSignupsComparison: cmp(cur.signups, prev.signups),
      passesBought,
      lost: cur.lost,
      lostComparison: cmp(cur.lost, prev.lost),
      quiet: quiet.length,
      quietNames: quiet.slice(0, 5).map((q) => ({ name: q.name, daysSince: q.daysSince })),
    },
  };
}

// Which group an AI usage log's cost counts against: the App Subscription (digital access wins, as on the Finances page) or everything else.
function isAppAiUser(userId: string | null): boolean {
  if (!userId) return false;
  const user = findUserById(userId);
  if (!user || isStaffRole(user.role)) return false;
  return resolveMemberAccessForUser(userId).digital;
}

// Ledger lines for the primary gym: lines tied to a tenant gym's member are left out (tenant billing is not live, but the exclusion is explicit).
function primaryGymLines(): FinanceLine[] {
  return buildFinanceLedgerLines().filter((l) => {
    if (l.origin === "ai_usage") return false; // AI is worked out from the usage logs, split between the gym and the app below
    if (!l.memberId) return true;
    return !findUserById(l.memberId)?.gymId;
  });
}

const isAppLine = (l: FinanceLine) =>
  l.incomeType === "tier2_app_subscription" || l.feeType === "apple_fee" || l.feeType === "google_fee" || l.incomeSource === "apple" || l.incomeSource === "google";

function buildGymMoney(period: ReportPeriod, lines: FinanceLine[], taxRate: number): GymMoneySection {
  const gymLines = lines.filter((l) => !isAppLine(l));
  const summary = summarizeMoney(gymLines, period, taxRate);
  const ai = summarizeAiCost(findAllAiUsageLogs().filter((l) => inPeriod(period, l.createdAt) && !isAppAiUser(l.userId)));
  // The balance also takes off the AI cost of everyone who is not an App Subscription user (that cost goes in the app report), so nothing is counted twice.
  const balanceCents = summary.balanceCents - Math.round(ai.costEur * 100);
  const prev = summarizeMoney(gymLines, previousPeriod(period), taxRate);
  return { ...summary, balanceCents, taxSetAsideCents: taxSetAsideCents(balanceCents, taxRate) ?? 0, ai, incomeComparison: cmp(summary.incomeCents, prev.incomeCents) };
}

function planLabel(e: DigitalEntitlementRecord): string {
  const option = e.billingOptionId ? findMembershipBillingOptionById(e.billingOptionId) : undefined;
  return option?.name ?? (e.productId ? `Product ${e.productId}` : "App Subscription");
}

function buildAppSection(period: ReportPeriod, lines: FinanceLine[], taxRate: number, now: Date): AppSection {
  const members = findMembers().filter((m) => !m.archivedAt);
  const allEntitlements = findAllDigitalEntitlements();
  const byUser = new Map<string, DigitalEntitlementRecord[]>();
  for (const e of allEntitlements) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
  const plans = members.map((m) => describeDigitalPlan(byUser.get(m.id) ?? [], now.getTime()));
  const subscribers = {
    appStore: plans.filter((p) => p?.source === "app_store").length,
    googlePlay: plans.filter((p) => p?.source === "google_play").length,
    complimentary: plans.filter((p) => p?.source === "staff_grant").length,
    total: plans.filter((p) => !!p).length,
  };

  const store = allEntitlements.filter((e) => e.source !== "staff_grant" && e.environment !== "sandbox");
  const bought = new Map<string, number>();
  for (const e of store.filter((x) => inPeriod(period, x.createdAt))) bought.set(planLabel(e), (bought.get(planLabel(e)) ?? 0) + 1);

  const trials = store.filter((e) => e.trial === true);
  const trialsStarted = trials.filter((e) => inPeriod(period, e.createdAt)).length;
  const trialsEnded = trials.filter((e) => inPeriod(period, e.updatedAt) && (e.autoRenewing === false || e.status === "expired" || e.status === "revoked" || e.status === "canceled" || e.status === "on_hold")).length;

  const appLines = lines.filter(isAppLine);
  const money = summarizeMoney(appLines, period, taxRate);
  const ai = summarizeAiCost(findAllAiUsageLogs().filter((l) => inPeriod(period, l.createdAt) && isAppAiUser(l.userId)));
  const aiCents = Math.round(ai.costEur * 100);
  const net = money.balanceCents - aiCents;
  return {
    totalUsers: members.length,
    subscribers,
    plansBought: [...bought.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    trialsStarted,
    trialsEndedWithoutConverting: trialsEnded,
    money: { ...money, balanceCents: net, taxSetAsideCents: taxSetAsideCents(net, taxRate) ?? 0 },
    ai,
    downloads: downloadsFor(period),
  };
}

// The Apple and Google download numbers typed in for a calendar month (monthly reports only; a week has none).
function downloadsFor(period: ReportPeriod): AppSection["downloads"] {
  if (period.cadence !== "monthly") return { appStore: null, googlePlay: null, month: null };
  const saved = getFinanceSettings().storeDownloads?.[period.key];
  return { appStore: saved?.appStore ?? null, googlePlay: saved?.googlePlay ?? null, month: period.key };
}

function buildPlatformRows(period: ReportPeriod): PlatformGymRow[] {
  return findGyms()
    .filter((g) => g.slug !== PRIMARY_GYM_SLUG)
    .map((g) => {
      const f = coreFigures({ gymId: g.id }, period);
      return {
        name: g.name,
        members: findMembers().filter((m) => !m.archivedAt && m.gymId === g.id).length,
        newSignups: f.signups,
        bookings: f.bookings,
        classes: f.rows.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The report for `actor`'s gym and one period. A platform owner viewing the primary gym also gets the money, app and platform sections; everyone else gets the
 * gym section only, scoped to their own gym.
 */
export function buildManagerReport(actor: ReportActor, cadence: ReportCadence, offset = 0, now: Date = new Date()): ManagerReport {
  const period = reportPeriod(cadence, offset, now);
  const gymId = actor.gymId ?? null;
  const gym = buildGymSection(actor, period, now);
  const ownerView = isPlatformOperator(actor.role) && gymId === null;

  let money: GymMoneySection | null = null;
  let app: AppSection | null = null;
  let platform: PlatformGymRow[] | null = null;
  if (ownerView) {
    const taxRate = effectiveTaxRate(getFinanceSettings().taxRatePercent);
    const lines = primaryGymLines();
    money = buildGymMoney(period, lines, taxRate);
    app = buildAppSection(period, lines, taxRate, now);
    platform = buildPlatformRows(period);
  }

  const notes: string[] = [];
  if (app) {
    notes.push(
      cadence === "monthly"
        ? "App downloads are the numbers you type in each month (the stores do not report them to this system)."
        : "App downloads are only recorded monthly: they show in the monthly report, from the numbers you type in."
    );
    notes.push("App income and the Apple and Google cut are the figures entered in Staff > Finances.");
    notes.push("Trials started is a lower bound and trials ended is approximate: the system keeps each subscription's current state, not its history.");
  }
  notes.push("Memberships ended counts memberships whose status changed to cancelled or inactive in the period; the system does not keep a full history.");
  notes.push('"Gone quiet" is as of now, not as of the end of the period.');
  if (money) notes.push(`Tax set aside is ${money.taxRatePercent}% of the balance (income minus fees, expenses and AI cost), worked out the way Staff > Finances does it. It is an estimate, not tax advice.`);

  return {
    cadence,
    period,
    generatedAt: now.toISOString(),
    gymName: gymNameFor(gymId),
    gym,
    money,
    app,
    platform,
    attention: buildAttention({ cadence, gym, money, app }),
    notes,
  };
}
