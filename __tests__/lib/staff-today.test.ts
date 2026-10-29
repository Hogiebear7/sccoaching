// lib/staff-today.ts: the overview's month figures (compared over the same days last month) and the At-risk list.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ex = vi.hoisted(() => ({ buildMembersSheet: vi.fn() }));
vi.mock("@/lib/exports", () => ex);
const h = vi.hoisted(() => ({
  findAllBookings: vi.fn(),
  findAllNoShows: vi.fn(() => []),
  findClasses: vi.fn(),
  findMembershipPackageById: vi.fn(() => ({ deliveryChannel: "in_person" })),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn((id: string) => ({ id, gymId: id === "coach-b" ? "gym-b" : null })),
}));
vi.mock("@/lib/db", () => h);

import { buildStaffToday } from "@/lib/staff-today";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const row = (userId: string, extra: object) => ({ userId, name: userId, email: `${userId}@x.test`, group: "Current", plan: "Premium", lastClass: null, lastSession: null, joined: "2026-01-01", archived: "", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  ex.buildMembersSheet.mockReturnValue({
    rows: [
      row("recent", { lastClass: "2026-10-25" }),
      row("away", { lastSession: "2026-10-01" }),
      row("never", { joined: "2026-10-20" }),
      row("paused", { group: "Paused" }),
      row("left", { group: "Past member", joined: "2026-09-10" }),
    ],
  });
  h.findSubscriptionByUserId.mockImplementation((id: string) =>
    id === "left" ? { packageId: "p", status: "canceled", updatedAt: "2026-10-05T00:00:00.000Z" } : { packageId: "p", status: "active" }
  );
  h.findClasses.mockReturnValue([
    { id: "c-oct", coachUserId: "coach-a", date: "2026-10-10", capacity: 4 },
    { id: "c-sep", coachUserId: "coach-a", date: "2026-09-10", capacity: 4 },
    { id: "c-sep-late", coachUserId: "coach-a", date: "2026-09-30", capacity: 4 },
    { id: "c-other-gym", coachUserId: "coach-b", date: "2026-10-10", capacity: 4 },
  ]);
  h.findAllBookings.mockReturnValue([
    { classId: "c-oct", userId: "recent", attendedAt: "x" },
    { classId: "c-oct", userId: "away", attendedAt: "x" },
    { classId: "c-sep", userId: "recent", attendedAt: "x" },
    { classId: "c-sep-late", userId: "recent", attendedAt: "x" },
    { classId: "c-other-gym", userId: "b", attendedAt: "x" },
  ]);
});

describe("buildStaffToday", () => {
  it("compares this month with the same days of last month, for the staff member's own gym", () => {
    const t = buildStaffToday({ gymId: null }, NOW);
    expect(t.monthLabel).toBe("October 2026");
    const f = Object.fromEntries(t.figures.map((x) => [x.label, x]));
    expect(f["Gym members"]).toMatchObject({ value: 3, note: "1 paused" });
    expect(f["New sign-ups"]).toMatchObject({ value: 1, previous: 1 });
    expect(f["Memberships ended"]).toMatchObject({ value: 1, previous: 0 });
    // 1–29 Oct vs 1–29 Sep: the 30 Sep class is left out of the comparison, and the other gym's class is never counted.
    expect(f["Attendances"]).toMatchObject({ value: 2, previous: 1 });
    expect(f["Class fill rate"]).toMatchObject({ value: 0.5, previous: 0.25 });
  });

  it("At risk: current members unseen for more than 14 days, longest absence first, never-seen last", () => {
    const t = buildStaffToday({ gymId: null }, NOW);
    expect(t.atRisk.map((m) => [m.userId, m.daysSince])).toEqual([
      ["away", 28],
      ["never", null],
    ]);
  });
});
