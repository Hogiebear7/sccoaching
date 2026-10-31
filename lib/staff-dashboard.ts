// The staff Overview dashboard's trends and to-do lists (admin area v2, DESIGN.md "Admin area"). Sits beside lib/staff-today.ts (the month
// figures and At-risk list) and is built from the same rows as the spreadsheet exports, so a chart never disagrees with the master workbook.
// Scoped to the staff member's own gym. No money: the Overview is not a finance page.
//
// SERVER-ONLY.

import {
  findAllBookings,
  findAllBugReports,
  findAllFoodSubmissions,
  findClasses,
  findMessageThreadSummaries,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { buildMembersSheet } from "@/lib/exports";
import { sameGym } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";

export interface DashboardPoint {
  /** Short axis label: "Oct", "27 Oct". */
  label: string;
  /** Long label for screen readers and tooltips: "October 2026", "Week of 27 Oct". */
  full: string;
  value: number;
}

export interface DashboardClass {
  id: string;
  title: string;
  time: string;
  durationMins: number;
  coach: string | null;
  booked: number;
  attended: number;
  capacity: number;
}

export interface DashboardRenewal {
  userId: string;
  name: string;
  plan: string | null;
  periodEnd: string;
  daysLeft: number;
}

export interface DashboardTask {
  key: "messages" | "foodReviews" | "bugReports" | "atRisk" | "renewals";
  label: string;
  count: number;
  href: string;
}

export interface StaffDashboard {
  greeting: string;
  greetingName: string;
  dateLabel: string;
  signupsByMonth: DashboardPoint[];
  attendanceByWeek: DashboardPoint[];
  planMix: { label: string; value: number }[];
  todayClasses: DashboardClass[];
  renewals: DashboardRenewal[];
  tasks: DashboardTask[];
}

type Staff = { id: string; role: string; gymId?: string | null };

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week containing `date` (YYYY-MM-DD), as YYYY-MM-DD. */
export function weekStart(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return iso(ms - dow * DAY);
}

export function buildStaffDashboard(staff: Staff, atRiskCount: number, now: Date = new Date()): StaffDashboard {
  const today = iso(now.getTime());
  const members = buildMembersSheet(staff, "all", now).rows;

  // Sign-ups, the last six months including this one.
  const signupsByMonth: DashboardPoint[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = first.toISOString().slice(0, 7);
    signupsByMonth.push({
      label: first.toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" }),
      full: first.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }),
      value: members.filter((r) => typeof r.joined === "string" && r.joined.slice(0, 7) === key).length,
    });
  }

  // Class check-ins per week, the last eight weeks including this one.
  const classes = findClasses().filter((c) => {
    const coach = findUserById(c.coachUserId);
    return !!coach && sameGym(staff, coach);
  });
  const classById = new Map(classes.map((c) => [c.id, c]));
  const bookings = findAllBookings().filter((b) => classById.has(b.classId));
  const thisWeek = weekStart(today);
  const attendanceByWeek: DashboardPoint[] = [];
  for (let offset = 7; offset >= 0; offset--) {
    const start = iso(Date.parse(`${thisWeek}T00:00:00Z`) - offset * 7 * DAY);
    const d = new Date(`${start}T00:00:00Z`);
    attendanceByWeek.push({
      label: d.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" }),
      full: `Week of ${d.toLocaleDateString("en-IE", { day: "numeric", month: "long", timeZone: "UTC" })}`,
      value: bookings.filter((b) => b.attendedAt && weekStart(classById.get(b.classId)!.date) === start).length,
    });
  }

  // What current gym members are on: the five biggest plans, the rest together.
  const plans = new Map<string, number>();
  for (const r of members) {
    if (r.group !== "Current") continue;
    const plan = typeof r.plan === "string" && r.plan ? r.plan : "No plan";
    plans.set(plan, (plans.get(plan) ?? 0) + 1);
  }
  const sortedPlans = [...plans.entries()].sort((a, b) => b[1] - a[1]);
  const planMix = sortedPlans.slice(0, 5).map(([label, value]) => ({ label, value }));
  const others = sortedPlans.slice(5).reduce((n, [, v]) => n + v, 0);
  if (others > 0) planMix.push({ label: "Other plans", value: others });

  const todayClasses: DashboardClass[] = classes
    .filter((c) => c.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((c) => {
      const forClass = bookings.filter((b) => b.classId === c.id);
      return {
        id: c.id,
        title: c.title,
        time: c.startTime,
        durationMins: c.durationMins,
        coach: findProfileByUserId(c.coachUserId)?.fullName ?? null,
        booked: forClass.length,
        attended: forClass.filter((b) => b.attendedAt).length,
        capacity: c.capacity,
      };
    });

  // Gym members whose paid period ends in the next 30 days, soonest first.
  const renewals: DashboardRenewal[] = members
    .filter((r) => r.group === "Current" && !r.archived && typeof r.periodEnd === "string" && r.periodEnd)
    .map((r) => {
      const periodEnd = String(r.periodEnd).slice(0, 10);
      return {
        userId: String(r.userId),
        name: String(r.name ?? r.email),
        plan: (r.plan as string | null) ?? null,
        periodEnd,
        daysLeft: Math.round((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY),
      };
    })
    .filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // To-dos, each only for staff who can open the page it links to.
  const tasks: DashboardTask[] = [];
  if (can(staff.role, "members.view")) {
    const unread = findMessageThreadSummaries().reduce((sum, s) => {
      const member = findUserById(s.memberId);
      return member && sameGym(staff, member) ? sum + s.unreadFromMemberCount : sum;
    }, 0);
    tasks.push({ key: "messages", label: "Unread messages", count: unread, href: "/staff/messages" });
    tasks.push({ key: "atRisk", label: "Members gone quiet", count: atRiskCount, href: "/staff/attendance" });
    tasks.push({ key: "renewals", label: "Renewals in 30 days", count: renewals.length, href: "/staff/members" });
  }
  if (can(staff.role, "foodCatalog.manage")) {
    const pending = findAllFoodSubmissions().filter((s) => s.status === "pending_review").length;
    tasks.push({ key: "foodReviews", label: "Foods to review", count: pending, href: "/staff/nutrition-submissions" });
  }
  if (can(staff.role, "bugReports.manage")) {
    const open = findAllBugReports().filter((r) => {
      if (r.status !== "open") return false;
      const reporter = findUserById(r.userId);
      return !!reporter && sameGym(staff, reporter);
    }).length;
    tasks.push({ key: "bugReports", label: "Open bug reports", count: open, href: "/staff/bug-reports" });
  }

  const fullName = findProfileByUserId(staff.id)?.fullName?.trim();
  const hour = Number(new Intl.DateTimeFormat("en-IE", { hour: "numeric", hour12: false, timeZone: "Europe/Dublin" }).format(now)) % 24;
  return {
    greeting: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening",
    greetingName: fullName ? fullName.split(/\s+/)[0] : "",
    dateLabel: now.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" }),
    signupsByMonth,
    attendanceByWeek,
    planMix,
    todayClasses,
    renewals,
    tasks,
  };
}
