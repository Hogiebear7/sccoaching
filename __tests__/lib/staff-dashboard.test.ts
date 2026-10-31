// lib/staff-dashboard.ts: the Overview's trends (sign-ups, check-ins), plan mix, today's classes, renewals and the role-gated to-dos.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ex = vi.hoisted(() => ({ buildMembersSheet: vi.fn() }));
vi.mock("@/lib/exports", () => ex);
const h = vi.hoisted(() => ({
  findAllBookings: vi.fn(),
  findAllBugReports: vi.fn(),
  findAllFoodSubmissions: vi.fn(),
  findClasses: vi.fn(),
  findMessageThreadSummaries: vi.fn(),
  findProfileByUserId: vi.fn((id: string) => (id === "me" ? { fullName: "Mark Coach" } : id === "coach-a" ? { fullName: "Aoife Coach" } : undefined)),
  findUserById: vi.fn((id: string) => ({ id, gymId: id.endsWith("-b") ? "gym-b" : null })),
}));
vi.mock("@/lib/db", () => h);

import { buildStaffDashboard, weekStart } from "@/lib/staff-dashboard";

const NOW = new Date("2026-10-29T18:30:00.000Z"); // a Thursday evening
const row = (userId: string, extra: object) => ({ userId, name: userId, email: `${userId}@x.test`, group: "Current", plan: "Premium", joined: "2026-01-01", periodEnd: null, archived: "", ...extra });
const ADMIN = { id: "me", role: "admin_manager", gymId: null };

beforeEach(() => {
  vi.clearAllMocks();
  ex.buildMembersSheet.mockReturnValue({
    rows: [
      row("a", { joined: "2026-10-03", periodEnd: "2026-11-05" }),
      row("b", { joined: "2026-10-20", plan: "Over 50s", periodEnd: "2026-10-29" }),
      row("c", { joined: "2026-08-14", periodEnd: "2026-12-30" }),
      row("d", { group: "Past member", joined: "2026-05-01", periodEnd: "2026-11-01" }),
    ],
  });
  h.findClasses.mockReturnValue([
    { id: "today-late", title: "Strength", coachUserId: "coach-a", date: "2026-10-29", startTime: "19:00", durationMins: 60, capacity: 8 },
    { id: "today-early", title: "Conditioning", coachUserId: "coach-a", date: "2026-10-29", startTime: "07:00", durationMins: 45, capacity: 2 },
    { id: "last-week", title: "Strength", coachUserId: "coach-a", date: "2026-10-21", startTime: "19:00", durationMins: 60, capacity: 8 },
    { id: "other-gym", title: "Elsewhere", coachUserId: "coach-b", date: "2026-10-29", startTime: "08:00", durationMins: 60, capacity: 8 },
  ]);
  h.findAllBookings.mockReturnValue([
    { classId: "today-early", userId: "a", attendedAt: "x" },
    { classId: "today-early", userId: "b", attendedAt: null },
    { classId: "last-week", userId: "a", attendedAt: "x" },
    { classId: "last-week", userId: "c", attendedAt: "x" },
    { classId: "other-gym", userId: "z", attendedAt: "x" },
  ]);
  h.findMessageThreadSummaries.mockReturnValue([
    { memberId: "a", unreadFromMemberCount: 2 },
    { memberId: "z-b", unreadFromMemberCount: 5 },
  ]);
  h.findAllFoodSubmissions.mockReturnValue([{ status: "pending_review" }, { status: "approved" }]);
  h.findAllBugReports.mockReturnValue([
    { status: "open", userId: "a" },
    { status: "resolved", userId: "a" },
    { status: "open", userId: "y-b" },
  ]);
});

describe("weekStart", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });
});

describe("buildStaffDashboard", () => {
  it("builds six months of sign-ups and eight weeks of check-ins for the staff member's own gym", () => {
    const d = buildStaffDashboard(ADMIN, 0, NOW);
    expect(d.signupsByMonth.map((p) => p.value)).toEqual([1, 0, 0, 1, 0, 2]);
    expect(d.signupsByMonth.at(-1)?.full).toBe("October 2026");
    expect(d.attendanceByWeek).toHaveLength(8);
    // This week: one check-in today (the other gym's class never counts); last week: two.
    expect(d.attendanceByWeek.slice(-2).map((p) => p.value)).toEqual([2, 1]);
  });

  it("lists today's classes in time order with bookings, and current members' plan mix", () => {
    const d = buildStaffDashboard(ADMIN, 0, NOW);
    expect(d.todayClasses.map((c) => [c.title, c.time, c.booked, c.attended, c.capacity, c.coach])).toEqual([
      ["Conditioning", "07:00", 2, 1, 2, "Aoife Coach"],
      ["Strength", "19:00", 0, 0, 8, "Aoife Coach"],
    ]);
    expect(d.planMix).toEqual([
      { label: "Premium", value: 2 },
      { label: "Over 50s", value: 1 },
    ]);
  });

  it("renewals: current members whose period ends within 30 days, soonest first", () => {
    const d = buildStaffDashboard(ADMIN, 0, NOW);
    expect(d.renewals.map((r) => [r.userId, r.daysLeft])).toEqual([
      ["b", 0],
      ["a", 7],
    ]);
  });

  it("to-dos are gym-scoped and only for roles that can open the page", () => {
    const admin = buildStaffDashboard(ADMIN, 3, NOW);
    expect(Object.fromEntries(admin.tasks.map((t) => [t.key, t.count]))).toEqual({ messages: 2, atRisk: 3, renewals: 2, foodReviews: 1, bugReports: 1 });
    const coach = buildStaffDashboard({ ...ADMIN, role: "coach" }, 3, NOW);
    expect(coach.tasks.map((t) => t.key)).not.toContain("foodReviews");
  });

  it("greets by first name and time of day in Ireland", () => {
    const d = buildStaffDashboard(ADMIN, 0, NOW);
    expect(d.greeting).toBe("Good evening");
    expect(d.greetingName).toBe("Mark");
  });
});
