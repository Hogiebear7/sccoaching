// Spreadsheet exports for the staff Reports & exports page (admin revamp slice S1, docs/admin-revamp-plan-2026-10.md). Each sheet is a plain
// table built from data the app already stores; the master workbook is every sheet plus a Summary. Everything is scoped to the acting staff
// member's own gym before any member, booking or class is read (same rule as lib/reports.ts), and the route checks reports.view (admin).
//
// SERVER-ONLY: imports lib/db.ts. The file formats (CSV, Excel) are in lib/exports-format.ts.

import { aiUsdPerEur } from "@/lib/ai-allowance";
import {
  findAllAiUsageLogs,
  findAllBookings,
  findAllNoShows,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findDigitalEntitlementsByUserId,
  findMembers,
  findMembershipPackageById,
  findProfileByUserId,
  findStaffMemberStars,
  findSubscriptionByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { describeDigitalPlan } from "@/lib/digital-entitlement";
import { sameGym } from "@/lib/gym-scope";
import { hasGymMembership } from "@/lib/member-access";
import { memberListGroup, type MemberListGroup } from "@/lib/member-list-group";
import { resolveMemberAccessForUser, resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { classCategoryLabel } from "@/lib/scheduling-status";

export type ExportCell = string | number | null;
export type ExportColumnKind = "text" | "number" | "date" | "percent" | "money";
export interface ExportColumn {
  key: string;
  header: string;
  kind?: ExportColumnKind;
  width?: number;
}
export interface ExportSheet {
  key: ExportSheetKey;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, ExportCell>[];
}

export const EXPORT_SHEET_KEYS = ["summary", "members", "memberships", "classes", "bookings", "app-access"] as const;
export type ExportSheetKey = (typeof EXPORT_SHEET_KEYS)[number];

export const EXPORT_RANGES = ["30d", "last-month", "90d", "12m", "all"] as const;
export type ExportRange = (typeof EXPORT_RANGES)[number];
export const EXPORT_RANGE_LABEL: Record<ExportRange, string> = {
  "30d": "Last 30 days",
  "last-month": "Last month",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  all: "All time",
};

/** What each sheet holds, for the page and the file names. Summary is in the master workbook only. */
export const EXPORT_SHEET_INFO: Record<ExportSheetKey, { title: string; description: string; usesRange: boolean }> = {
  summary: { title: "Summary", description: "The headline numbers for the period: members, joiners, leavers, classes, attendance and app subscribers.", usesRange: true },
  members: { title: "Members", description: "Every member: contact (gym members only), membership group and plan, app access, and attendance in the period.", usesRange: true },
  memberships: { title: "Memberships", description: "Every gym Membership record: plan, status, how it's billed, start, last change and end.", usesRange: false },
  classes: { title: "Classes", description: "Each class in the period: type, capacity, booked, attended, fill rate and no-shows.", usesRange: true },
  bookings: { title: "Bookings", description: "Every booking in the period: class, member, when it was booked, attended or no-show.", usesRange: true },
  "app-access": { title: "App access & AI", description: "Who has the App Subscription (store or complimentary), until when, and their AI use and cost in the period.", usesRange: true },
};

type Actor = { gymId?: string | null };

const GROUP_LABEL: Record<MemberListGroup, string> = { current: "Current", paused: "Paused", past: "Past member", none: "Non-member" };
const SOURCE_LABEL: Record<string, string> = { google_play: "Google Play", app_store: "App Store", staff_grant: "Complimentary" };

const day = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);

/** The first and last dates (YYYY-MM-DD) a range covers; start is null for all time. "last-month" is the previous calendar month. */
export function rangeBounds(range: ExportRange, now: Date = new Date()): { start: string | null; end: string } {
  const today = now.toISOString().slice(0, 10);
  if (range === "all") return { start: null, end: today };
  if (range === "last-month") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  }
  const d = new Date(now);
  if (range === "30d") d.setUTCDate(d.getUTCDate() - 30);
  else if (range === "90d") d.setUTCDate(d.getUTCDate() - 90);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return { start: d.toISOString().slice(0, 10), end: today };
}

/** The earliest date (YYYY-MM-DD) a range covers, or null for all time. */
export function rangeStart(range: ExportRange, now: Date = new Date()): string | null {
  return rangeBounds(range, now).start;
}
const inRange = (date: string | null | undefined, start: string | null, today: string) => !!date && (!start || date >= start) && date <= today;

function ownMembers(staff: Actor) {
  return findMembers().filter((m) => sameGym(staff, m));
}
function ownClasses(staff: Actor) {
  return findClasses().filter((c) => {
    const coach = findUserById(c.coachUserId);
    return !!coach && sameGym(staff, coach);
  });
}

export function buildMembersSheet(staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet {
  const { start, end } = rangeBounds(range, now);
  const today = now.toISOString().slice(0, 10);
  const stars = new Set(findStaffMemberStars().map((s) => s.userId));
  const classDates = new Map(ownClasses(staff).map((c) => [c.id, c.date]));
  const bookingsByUser = new Map<string, { date: string; attended: boolean }[]>();
  for (const b of findAllBookings()) {
    const date = classDates.get(b.classId);
    if (!date) continue;
    const list = bookingsByUser.get(b.userId) ?? [];
    list.push({ date, attended: b.attendedAt !== null });
    bookingsByUser.set(b.userId, list);
  }
  const rows = ownMembers(staff).map((m) => {
    const profile = findProfileByUserId(m.id);
    const sub = findSubscriptionByUserId(m.id);
    const plan = resolveSubscriptionEntitlement(sub);
    const gymMember = hasGymMembership(resolveMemberAccessForUser(m.id));
    const digital = describeDigitalPlan(findDigitalEntitlementsByUserId(m.id));
    const attended = (bookingsByUser.get(m.id) ?? []).filter((b) => b.attended);
    const lastClass = attended.map((b) => b.date).filter((d) => d <= today).sort().at(-1) ?? null;
    const lastSession = findWorkoutSessionsByUserId(m.id).map((s) => s.date).sort().at(-1) ?? null;
    return {
      // Not a column: kept on the row so the staff overview can link each at-risk member to their page.
      userId: m.id,
      name: profile?.fullName ?? null,
      email: m.email,
      // Contact details are the member's own data: like the rest of it, only for members who hold a gym Membership.
      phone: gymMember ? profile?.phone ?? null : null,
      joined: day(m.createdAt),
      group: GROUP_LABEL[memberListGroup(sub, findMembershipPackageById)],
      plan: plan?.name ?? null,
      status: sub?.status ?? null,
      periodEnd: day(sub?.currentPeriodEnd),
      appAccess: digital ? `${SOURCE_LABEL[digital.source] ?? digital.source}${digital.trial ? " (trial)" : ""}` : "None",
      classesAttended: attended.filter((b) => inRange(b.date, start, end)).length,
      lastClass,
      lastSession,
      starred: stars.has(m.id) ? "Yes" : "",
      archived: m.archivedAt ? "Yes" : "",
    };
  });
  rows.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return {
    key: "members",
    title: EXPORT_SHEET_INFO.members.title,
    columns: [
      { key: "name", header: "Name", width: 24 },
      { key: "email", header: "Email", width: 30 },
      { key: "phone", header: "Phone", width: 16 },
      { key: "joined", header: "Joined", kind: "date" },
      { key: "group", header: "Group", width: 13 },
      { key: "plan", header: "Plan", width: 26 },
      { key: "status", header: "Status", width: 11 },
      { key: "periodEnd", header: "Period ends", kind: "date" },
      { key: "appAccess", header: "App Subscription", width: 18 },
      { key: "classesAttended", header: `Classes attended (${EXPORT_RANGE_LABEL[range].toLowerCase()})`, kind: "number", width: 18 },
      { key: "lastClass", header: "Last class", kind: "date" },
      { key: "lastSession", header: "Last logged session", kind: "date" },
      { key: "starred", header: "Starred", width: 9 },
      { key: "archived", header: "Archived", width: 9 },
    ],
    rows,
  };
}

export function buildMembershipsSheet(staff: Actor): ExportSheet {
  const rows = ownMembers(staff)
    .map((m) => ({ m, sub: findSubscriptionByUserId(m.id) }))
    .filter(({ sub }) => !!sub?.packageId && findMembershipPackageById(sub.packageId)?.deliveryChannel !== "app_only")
    .map(({ m, sub }) => ({
      name: findProfileByUserId(m.id)?.fullName ?? null,
      email: m.email,
      plan: resolveSubscriptionEntitlement(sub)?.name ?? null,
      status: sub!.status,
      billing: sub!.provider === "none" ? "Staff / cash" : sub!.provider,
      started: day(sub!.createdAt),
      lastChange: day(sub!.updatedAt),
      periodEnd: day(sub!.currentPeriodEnd),
      pausedUntil: day(sub!.pausedUntil),
    }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return {
    key: "memberships",
    title: EXPORT_SHEET_INFO.memberships.title,
    columns: [
      { key: "name", header: "Name", width: 24 },
      { key: "email", header: "Email", width: 30 },
      { key: "plan", header: "Plan", width: 26 },
      { key: "status", header: "Status", width: 11 },
      { key: "billing", header: "Billed through", width: 14 },
      { key: "started", header: "Started", kind: "date" },
      { key: "lastChange", header: "Last change", kind: "date" },
      { key: "periodEnd", header: "Period ends", kind: "date" },
      { key: "pausedUntil", header: "Paused until", kind: "date" },
    ],
    rows,
  };
}

export function buildClassesSheet(staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet {
  const { start, end } = rangeBounds(range, now);
  const categories = findClassCategories();
  const deleted = findDeletedCategoryLabels();
  const noShowsByClass = new Map<string, number>();
  for (const n of findAllNoShows()) noShowsByClass.set(n.classId, (noShowsByClass.get(n.classId) ?? 0) + 1);
  const bookingsByClass = new Map<string, { booked: number; attended: number }>();
  for (const b of findAllBookings()) {
    const t = bookingsByClass.get(b.classId) ?? { booked: 0, attended: 0 };
    t.booked++;
    if (b.attendedAt) t.attended++;
    bookingsByClass.set(b.classId, t);
  }
  const rows = ownClasses(staff)
    .filter((c) => inRange(c.date, start, end))
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
    .map((c) => {
      const t = bookingsByClass.get(c.id) ?? { booked: 0, attended: 0 };
      return {
        date: c.date,
        time: c.startTime,
        title: c.title,
        type: classCategoryLabel(categories, c.category, deleted),
        coach: findProfileByUserId(c.coachUserId)?.fullName ?? null,
        capacity: c.capacity,
        booked: t.booked,
        attended: t.attended,
        fill: c.capacity > 0 ? t.attended / c.capacity : null,
        noShows: noShowsByClass.get(c.id) ?? 0,
      };
    });
  return {
    key: "classes",
    title: EXPORT_SHEET_INFO.classes.title,
    columns: [
      { key: "date", header: "Date", kind: "date" },
      { key: "time", header: "Time", width: 8 },
      { key: "title", header: "Class", width: 26 },
      { key: "type", header: "Type", width: 22 },
      { key: "coach", header: "Coach", width: 18 },
      { key: "capacity", header: "Capacity", kind: "number" },
      { key: "booked", header: "Booked", kind: "number" },
      { key: "attended", header: "Attended", kind: "number" },
      { key: "fill", header: "Fill rate (attended)", kind: "percent", width: 16 },
      { key: "noShows", header: "No-shows", kind: "number" },
    ],
    rows,
  };
}

export function buildBookingsSheet(staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet {
  const { start, end } = rangeBounds(range, now);
  const classes = new Map(ownClasses(staff).filter((c) => inRange(c.date, start, end)).map((c) => [c.id, c]));
  const noShows = new Set(findAllNoShows().map((n) => `${n.classId}:${n.userId}`));
  const rows = findAllBookings()
    .filter((b) => classes.has(b.classId))
    .map((b) => {
      const c = classes.get(b.classId)!;
      const member = findUserById(b.userId);
      return {
        date: c.date,
        time: c.startTime,
        title: c.title,
        name: findProfileByUserId(b.userId)?.fullName ?? null,
        email: member?.email ?? null,
        bookedAt: day(b.createdAt),
        attended: b.attendedAt ? "Yes" : "",
        noShow: noShows.has(`${b.classId}:${b.userId}`) ? "Yes" : "",
      };
    })
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return {
    key: "bookings",
    title: EXPORT_SHEET_INFO.bookings.title,
    columns: [
      { key: "date", header: "Class date", kind: "date" },
      { key: "time", header: "Time", width: 8 },
      { key: "title", header: "Class", width: 26 },
      { key: "name", header: "Member", width: 24 },
      { key: "email", header: "Email", width: 30 },
      { key: "bookedAt", header: "Booked on", kind: "date" },
      { key: "attended", header: "Attended", width: 10 },
      { key: "noShow", header: "No-show", width: 10 },
    ],
    rows,
  };
}

export function buildAppAccessSheet(staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet {
  const { start, end } = rangeBounds(range, now);
  const members = ownMembers(staff);
  const ids = new Set(members.map((m) => m.id));
  const ai = new Map<string, { calls: number; usd: number }>();
  for (const log of findAllAiUsageLogs()) {
    if (!log.userId || !ids.has(log.userId) || !inRange(day(log.createdAt), start, end)) continue;
    const t = ai.get(log.userId) ?? { calls: 0, usd: 0 };
    t.calls++;
    t.usd += log.costUsd;
    ai.set(log.userId, t);
  }
  const usdPerEur = aiUsdPerEur();
  const rows = members
    .map((m) => ({ m, plan: describeDigitalPlan(findDigitalEntitlementsByUserId(m.id)), usage: ai.get(m.id) }))
    .filter(({ plan, usage }) => !!plan || !!usage)
    .map(({ m, plan, usage }) => ({
      name: findProfileByUserId(m.id)?.fullName ?? null,
      email: m.email,
      source: plan ? SOURCE_LABEL[plan.source] ?? plan.source : "None",
      status: plan?.status ?? null,
      trial: plan?.trial ? "Yes" : "",
      autoRenewing: plan && plan.source !== "staff_grant" ? (plan.autoRenewing ? "Yes" : "No") : "",
      until: day(plan?.currentPeriodEnd),
      aiRequests: usage?.calls ?? 0,
      aiCostEur: usage ? Math.round((usage.usd / usdPerEur) * 100) / 100 : 0,
    }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return {
    key: "app-access",
    title: EXPORT_SHEET_INFO["app-access"].title,
    columns: [
      { key: "name", header: "Name", width: 24 },
      { key: "email", header: "Email", width: 30 },
      { key: "source", header: "App Subscription", width: 16 },
      { key: "status", header: "Status", width: 14 },
      { key: "trial", header: "Free trial", width: 10 },
      { key: "autoRenewing", header: "Renews", width: 9 },
      { key: "until", header: "Until", kind: "date" },
      { key: "aiRequests", header: "AI requests", kind: "number" },
      { key: "aiCostEur", header: "AI cost (€)", kind: "money" },
    ],
    rows,
  };
}

/** The headline numbers, built from the other sheets so every figure can be traced back to a row. */
export function buildSummarySheet(
  staff: Actor,
  range: ExportRange,
  parts: { members: ExportSheet; classes: ExportSheet; appAccess: ExportSheet },
  now: Date = new Date()
): ExportSheet {
  const { start, end } = rangeBounds(range, now);
  const count = (pred: (r: Record<string, ExportCell>) => boolean) => parts.members.rows.filter(pred).length;
  const current = count((r) => r.group === "Current");
  const paused = count((r) => r.group === "Paused");
  const joined = count((r) => inRange(r.joined as string | null, start, end));
  const ended = ownMembers(staff).filter((m) => {
    const sub = findSubscriptionByUserId(m.id);
    return memberListGroup(sub, findMembershipPackageById) === "past" && inRange(day(sub?.updatedAt), start, end);
  }).length;
  const classRows = parts.classes.rows;
  const attended = classRows.reduce((n, r) => n + Number(r.attended ?? 0), 0);
  const capacity = classRows.reduce((n, r) => n + Number(r.capacity ?? 0), 0);
  const noShows = classRows.reduce((n, r) => n + Number(r.noShows ?? 0), 0);
  const appRows = parts.appAccess.rows;
  const paid = appRows.filter((r) => r.source === "Google Play" || r.source === "App Store").length;
  const complimentary = appRows.filter((r) => r.source === "Complimentary").length;
  const aiCost = Math.round(appRows.reduce((n, r) => n + Number(r.aiCostEur ?? 0), 0) * 100) / 100;
  const atRisk = parts.members.rows.filter((r) => {
    if (r.group !== "Current") return false;
    const last = [r.lastClass, r.lastSession].filter(Boolean).sort().at(-1) as string | undefined;
    if (!last) return true;
    return (now.getTime() - new Date(`${last}T00:00:00Z`).getTime()) / 86_400_000 > 14;
  }).length;
  const rows: Record<string, ExportCell>[] = [
    { measure: "Period", value: EXPORT_RANGE_LABEL[range], note: start ? `${start} to ${end}` : `up to ${end}` },
    { measure: "Current gym members", value: current, note: "Active or past due today" },
    { measure: "Paused gym members", value: paused, note: "Today" },
    { measure: "New sign-ups", value: joined, note: "Accounts created in the period" },
    { measure: "Memberships ended", value: ended, note: "Ended (cancelled or inactive) in the period" },
    { measure: "At risk", value: atRisk, note: "Current members with no class or logged session in 14 days" },
    { measure: "Classes run", value: classRows.length, note: "In the period" },
    { measure: "Attendances", value: attended, note: "Check-ins in the period" },
    { measure: "Average fill rate", value: capacity > 0 ? attended / capacity : null, note: "Attended ÷ capacity" },
    { measure: "No-shows", value: noShows, note: "Booked but not checked in" },
    { measure: "App Subscription, paid", value: paid, note: "Google Play or App Store, any status" },
    { measure: "App Subscription, complimentary", value: complimentary, note: "Given free by staff" },
    { measure: "AI cost (€)", value: aiCost, note: "Members' AI use in the period, at the conservative exchange rate" },
  ];
  return {
    key: "summary",
    title: EXPORT_SHEET_INFO.summary.title,
    columns: [
      { key: "measure", header: "Measure", width: 32 },
      { key: "value", header: "Value", width: 16 },
      { key: "note", header: "Notes", width: 60 },
    ],
    rows,
  };
}

export function buildExportSheet(key: ExportSheetKey, staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet {
  switch (key) {
    case "members":
      return buildMembersSheet(staff, range, now);
    case "memberships":
      return buildMembershipsSheet(staff);
    case "classes":
      return buildClassesSheet(staff, range, now);
    case "bookings":
      return buildBookingsSheet(staff, range, now);
    case "app-access":
      return buildAppAccessSheet(staff, range, now);
    case "summary":
      return buildMasterWorkbook(staff, range, now)[0];
  }
}

/** Summary first, then every sheet. */
export function buildMasterWorkbook(staff: Actor, range: ExportRange, now: Date = new Date()): ExportSheet[] {
  const members = buildMembersSheet(staff, range, now);
  const classes = buildClassesSheet(staff, range, now);
  const appAccess = buildAppAccessSheet(staff, range, now);
  return [
    buildSummarySheet(staff, range, { members, classes, appAccess }, now),
    members,
    buildMembershipsSheet(staff),
    classes,
    buildBookingsSheet(staff, range, now),
    appAccess,
  ];
}
