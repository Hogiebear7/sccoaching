// Gym isolation for the staff reporting/operations data builders:
//   lib/reports.ts          buildMemberSignupRows / buildSubscriptionRows / buildClassReportRows
//   lib/staff-operations.ts buildMemberOperationalSummaries / buildUpcomingClassPressureSummaries
// Ownership: a member/subscription belongs to the member's gym; a class belongs
// to its coach's gym (class -> coachUserId -> gym). Both are compared with the
// acting staff member's gym (gymId: null is the primary gym, lib/gym-scope.ts).
// The point is not only that rows are filtered but that other gyms' members and
// classes are never LOOKED UP: no profile, subscription, recovery-log, message,
// booking or waitlist read happens for an excluded target. sameGym is
// deliberately not mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findAllSubscriptions: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findClassCategories: vi.fn(),
  findClasses: vi.fn(),
  findDeletedCategoryLabels: vi.fn(),
  findMembers: vi.fn(),
  findMessagesByMemberId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null }));
vi.mock("@/lib/billing", () => ({ isPendingCheckoutStale: () => false }));

type U = { id: string; email: string; role: string; gymId: string | null; createdAt: string };
const user = (id: string, role: string, gymId: string | null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  createdAt: "2026-05-01T00:00:00.000Z",
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const MGR_A = user("mgr-a", "admin", null);
const MGR_B = user("mgr-b", "admin", "gym-b");
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A1 = user("member-a1", "member", null);
const MEMBER_A2 = user("member-a2", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const EVERYONE = [MGR_A, MGR_B, COACH_A, COACH_B, MEMBER_A1, MEMBER_A2, MEMBER_B];
const MEMBERS = [MEMBER_A1, MEMBER_B, MEMBER_A2];

const NAMES: Record<string, string> = {
  "member-a1": "Alice One",
  "member-a2": "Amy Two",
  "member-b": "Bob SecretMember",
};

const sub = (userId: string, status = "active") => ({
  userId,
  status,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
});
const SUBSCRIPTIONS = [sub(MEMBER_A1.id), sub(MEMBER_B.id), sub("member-gone"), sub(MEMBER_A2.id, "canceled")];

const cls = (id: string, coachUserId: string, date: string, startTime: string, capacity = 10) => ({
  id,
  title: `Class ${id}`,
  category: "strength",
  date,
  startTime,
  capacity,
  coachUserId,
});
const CLASSES = [
  cls("class-a-late", COACH_A.id, "2099-06-03", "18:00"),
  cls("class-b", COACH_B.id, "2099-06-02", "09:00"),
  cls("class-orphan", "coach-gone", "2099-06-02", "10:00"),
  cls("class-a-early", COACH_A.id, "2099-06-01", "07:00", 1),
  cls("class-a-past", COACH_A.id, "2020-01-01", "09:00"),
];
const BOOKINGS: Record<string, { id: string; attendedAt: string | null }[]> = {
  "class-a-late": [{ id: "b1", attendedAt: "2099-06-03T18:00:00.000Z" }, { id: "b2", attendedAt: null }],
  "class-a-early": [{ id: "b3", attendedAt: null }],
  "class-b": [{ id: "b4", attendedAt: null }],
  "class-orphan": [{ id: "b5", attendedAt: null }],
};
const WAITLISTS: Record<string, { id: string }[]> = { "class-a-early": [{ id: "w1" }], "class-b": [{ id: "w2" }] };

const STAFF_A = { gymId: MGR_A.gymId };
const STAFF_B = { gymId: MGR_B.gymId };

const profileLookups = () => h.findProfileByUserId.mock.calls.map((c) => c[0]);
const bookingLookups = () => h.findBookingsByClassId.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findMembers.mockImplementation(() => MEMBERS);
  h.findAllSubscriptions.mockImplementation(() => SUBSCRIPTIONS);
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  h.findClasses.mockImplementation(() => CLASSES);
  h.findClassCategories.mockReturnValue([]);
  h.findDeletedCategoryLabels.mockReturnValue({});
  h.findBookingsByClassId.mockImplementation((id: string) => BOOKINGS[id] ?? []);
  h.findWaitlistEntriesByClassId.mockImplementation((id: string) => WAITLISTS[id] ?? []);
  h.findSubscriptionByUserId.mockImplementation((id: string) => SUBSCRIPTIONS.find((s) => s.userId === id));
  h.findRecoveryLogsByUserId.mockReturnValue([]);
  h.findMessagesByMemberId.mockReturnValue([]);
});

describe("lib/reports.ts — gym-scoped report rows", () => {
  it("member sign-ups: only the acting gym's members, and no other gym's profile is read", async () => {
    const { buildMemberSignupRows } = await import("@/lib/reports");

    const rows = buildMemberSignupRows(STAFF_A);

    expect(rows.map((r) => r.userId)).toEqual(["member-a1", "member-a2"]);
    expect(rows[0]).toMatchObject({ email: MEMBER_A1.email, fullName: "Alice One", createdAt: MEMBER_A1.createdAt });
    expect(profileLookups()).toEqual(["member-a1", "member-a2"]);
    expect(JSON.stringify(rows)).not.toContain("SecretMember");
  });

  it("member sign-ups: gym B staff see only gym B", async () => {
    const { buildMemberSignupRows } = await import("@/lib/reports");

    expect(buildMemberSignupRows(STAFF_B).map((r) => r.userId)).toEqual(["member-b"]);
  });

  it("subscriptions: only the acting gym's members' subscriptions; an unresolvable owner fails closed", async () => {
    const { buildSubscriptionRows } = await import("@/lib/reports");

    const rows = buildSubscriptionRows(STAFF_A);

    expect(rows.map((r) => r.userId)).toEqual(["member-a1", "member-a2"]);
    expect(rows.map((r) => r.status)).toEqual(["active", "canceled"]);
    expect(rows.some((r) => r.userId === "member-gone")).toBe(false);
    expect(profileLookups()).not.toContain("member-b");
    expect(profileLookups()).not.toContain("member-gone");
    expect(JSON.stringify(rows)).not.toContain("member-b");
  });

  it("class report: only classes whose coach is in the acting gym, sorted by date/time, counting only their bookings", async () => {
    const { buildClassReportRows } = await import("@/lib/reports");

    const rows = buildClassReportRows(STAFF_A);

    expect(rows.map((r) => r.classId)).toEqual(["class-a-past", "class-a-early", "class-a-late"]);
    expect(rows.find((r) => r.classId === "class-a-late")).toMatchObject({ bookingCount: 2, attendedCount: 1, capacity: 10 });
    // Booking rows are only read for owned classes.
    expect(bookingLookups().sort()).toEqual(["class-a-early", "class-a-late", "class-a-past"]);
    expect(bookingLookups()).not.toContain("class-b");
    expect(bookingLookups()).not.toContain("class-orphan");
    expect(buildClassReportRows(STAFF_B).map((r) => r.classId)).toEqual(["class-b"]);
  });

  it("returns empty rows (not an error) when the acting gym has no data", async () => {
    const { buildMemberSignupRows, buildSubscriptionRows, buildClassReportRows } = await import("@/lib/reports");
    const lonely = { gymId: "gym-empty" };

    expect(buildMemberSignupRows(lonely)).toEqual([]);
    expect(buildSubscriptionRows(lonely)).toEqual([]);
    expect(buildClassReportRows(lonely)).toEqual([]);
  });
});

describe("lib/staff-operations.ts — gym-scoped operations", () => {
  it("member summaries: only the acting gym's members; no other gym's profile/subscription/recovery/message read", async () => {
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const rows = buildMemberOperationalSummaries(STAFF_A);

    expect(rows.map((r) => r.userId)).toEqual(["member-a1", "member-a2"]);
    expect(rows[0]).toMatchObject({ email: MEMBER_A1.email, fullName: "Alice One", subscriptionStatus: "active" });
    for (const fn of [h.findProfileByUserId, h.findSubscriptionByUserId, h.findRecoveryLogsByUserId, h.findMessagesByMemberId]) {
      expect(fn.mock.calls.map((c) => c[0])).not.toContain("member-b");
    }
    expect(JSON.stringify(rows)).not.toContain("SecretMember");
    expect(buildMemberOperationalSummaries(STAFF_B).map((r) => r.userId)).toEqual(["member-b"]);
  });

  it("class pressure: only upcoming classes owned by the acting gym; no other gym's booking/waitlist read", async () => {
    const { buildUpcomingClassPressureSummaries } = await import("@/lib/staff-operations");

    const rows = buildUpcomingClassPressureSummaries(STAFF_A);

    // Existing behavior: past class excluded, findClasses() order kept.
    expect(rows.map((r) => r.classId)).toEqual(["class-a-late", "class-a-early"]);
    expect(rows.find((r) => r.classId === "class-a-early")).toMatchObject({ bookedCount: 1, waitlistCount: 1, isFull: true });
    for (const fn of [h.findBookingsByClassId, h.findWaitlistEntriesByClassId]) {
      const ids = fn.mock.calls.map((c) => c[0]);
      expect(ids).not.toContain("class-b");
      expect(ids).not.toContain("class-orphan");
    }
    expect(buildUpcomingClassPressureSummaries(STAFF_B).map((r) => r.classId)).toEqual(["class-b"]);
  });

  it("returns empty summaries (not an error) when the acting gym has no data", async () => {
    const { buildMemberOperationalSummaries, buildUpcomingClassPressureSummaries } = await import("@/lib/staff-operations");
    const lonely = { gymId: "gym-empty" };

    expect(buildMemberOperationalSummaries(lonely)).toEqual([]);
    expect(buildUpcomingClassPressureSummaries(lonely)).toEqual([]);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
  });

  it("a legacy actor with gymId undefined is the primary gym, same as null", async () => {
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    expect(buildMemberOperationalSummaries({}).map((r) => r.userId)).toEqual(["member-a1", "member-a2"]);
  });
});
