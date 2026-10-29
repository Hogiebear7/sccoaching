// The staff overview's "This month" figures and At-risk list (admin revamp slice S2, docs/admin-revamp-plan-2026-10.md). Built from the same
// rows as the spreadsheet exports (lib/exports.ts), so a number on the page always matches the master workbook. Scoped to the staff member's
// own gym. No money: the overview is open to coaches (operations.view).
//
// SERVER-ONLY.

import { findAllBookings, findAllNoShows, findClasses, findMembershipPackageById, findSubscriptionByUserId, findUserById } from "@/lib/db";
import { buildMembersSheet } from "@/lib/exports";
import { sameGym } from "@/lib/gym-scope";
import { memberListGroup } from "@/lib/member-list-group";

export interface MonthFigure {
  label: string;
  value: number | null;
  previous: number | null;
  /** How to read the change: "up" is good for joiners and attendance, bad for leavers and no-shows. */
  better: "up" | "down" | "none";
  unit?: "percent";
  note: string;
}

export interface AtRiskMember {
  userId: string;
  name: string;
  plan: string | null;
  lastSeen: string | null;
  daysSince: number | null;
}

export interface StaffToday {
  monthLabel: string;
  figures: MonthFigure[];
  atRisk: AtRiskMember[];
}

const AT_RISK_DAYS = 14;

function monthBounds(now: Date, offset: number): [string, string] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
const within = (d: string | null | undefined, [a, b]: [string, string]) => !!d && d.slice(0, 10) >= a && d.slice(0, 10) <= b;

export function buildStaffToday(staff: { gymId?: string | null }, now: Date = new Date()): StaffToday {
  const today = now.toISOString().slice(0, 10);
  const thisMonth = monthBounds(now, 0);
  const lastMonth = monthBounds(now, -1);
  // This month runs to today; last month is compared over the same number of days, so a half-way-through month isn't judged against a whole one.
  const sameDays: [string, string] = [lastMonth[0], new Date(Math.min(Date.parse(`${lastMonth[1]}T00:00:00Z`), Date.parse(`${lastMonth[0]}T00:00:00Z`) + (now.getUTCDate() - 1) * 86_400_000)).toISOString().slice(0, 10)];
  const current: [string, string] = [thisMonth[0], today];

  const members = buildMembersSheet(staff, "all", now).rows;
  const subs = members.map((r) => findSubscriptionByUserId(String(r.userId)));
  const ended = (range: [string, string]) =>
    subs.filter((s) => memberListGroup(s, findMembershipPackageById) === "past" && within(s?.updatedAt, range)).length;

  const classes = findClasses().filter((c) => {
    const coach = findUserById(c.coachUserId);
    return !!coach && sameGym(staff, coach);
  });
  const classIds = new Set(classes.map((c) => c.id));
  const classDate = new Map(classes.map((c) => [c.id, c.date]));
  const bookings = findAllBookings().filter((b) => classIds.has(b.classId));
  const attendances = (range: [string, string]) => bookings.filter((b) => b.attendedAt && within(classDate.get(b.classId), range)).length;
  const fill = (range: [string, string]) => {
    const inRange = classes.filter((c) => within(c.date, range) && c.date <= today);
    const capacity = inRange.reduce((n, c) => n + c.capacity, 0);
    if (capacity === 0) return null;
    const ids = new Set(inRange.map((c) => c.id));
    return bookings.filter((b) => b.attendedAt && ids.has(b.classId)).length / capacity;
  };
  const noShows = (range: [string, string]) => findAllNoShows().filter((n) => classIds.has(n.classId) && within(classDate.get(n.classId), range)).length;

  const figures: MonthFigure[] = [
    {
      label: "Gym members",
      value: members.filter((r) => r.group === "Current").length,
      previous: null,
      better: "none",
      note: `${members.filter((r) => r.group === "Paused").length} paused`,
    },
    { label: "New sign-ups", value: members.filter((r) => within(r.joined as string, current)).length, previous: members.filter((r) => within(r.joined as string, sameDays)).length, better: "up", note: "Accounts created" },
    { label: "Memberships ended", value: ended(current), previous: ended(sameDays), better: "down", note: "Cancelled or lapsed" },
    { label: "Attendances", value: attendances(current), previous: attendances(sameDays), better: "up", note: "Class check-ins" },
    { label: "Class fill rate", value: fill(current), previous: fill(sameDays), better: "up", unit: "percent", note: "Attended ÷ capacity" },
    { label: "No-shows", value: noShows(current), previous: noShows(sameDays), better: "down", note: "Booked, not checked in" },
  ];

  const atRisk: AtRiskMember[] = members
    .filter((r) => r.group === "Current" && !r.archived)
    .map((r) => {
      const lastSeen = ([r.lastClass, r.lastSession].filter(Boolean) as string[]).sort().at(-1) ?? null;
      const daysSince = lastSeen ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastSeen}T00:00:00Z`)) / 86_400_000) : null;
      return { userId: String(r.userId), name: String(r.name ?? r.email), plan: (r.plan as string | null) ?? null, lastSeen, daysSince };
    })
    .filter((m) => m.daysSince === null || m.daysSince > AT_RISK_DAYS)
    // Longest absence first; never seen at all comes after, as those are usually brand-new members.
    .sort((a, b) => (a.daysSince === null ? 1 : b.daysSince === null ? -1 : b.daysSince - a.daysSince));

  return {
    monthLabel: new Date(`${thisMonth[0]}T00:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }),
    figures,
    atRisk,
  };
}
