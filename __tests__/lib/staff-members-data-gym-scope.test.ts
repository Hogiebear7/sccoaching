// getStaffMembersData(staff) (lib/staff-members-data.ts, served by GET
// /api/mobile/staff/members): the list is scoped to the acting staff member's own
// gym BEFORE any profile or subscription is read — previously every gym's
// members were loaded and the route filtered the rows afterwards, so other
// gyms' profile/subscription data was read (though not returned). gymId null is
// the primary gym (lib/gym-scope.ts). sameGym is deliberately not mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findBookingsByUserId: vi.fn(),
  findClassById: vi.fn(),
  findCoachNoteByUserId: vi.fn(),
  findMembers: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findStaffMemberStars: vi.fn((): { userId: string; starredByStaffId: string; starredAt: string }[] => []),
  findProfileByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWeeklyTrainingScheduleByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null, resolveMemberAccessForUser: () => ({ digital: false, gymMembership: true }) }));

const member = (id: string, gymId: string | null) => ({
  id,
  email: `${id}@x.test`,
  role: "member",
  gymId,
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
});
// Gym A = primary gym (gymId null / absent). Gym B = "gym-b".
const A1 = member("member-a1", null);
const A2 = { ...member("member-a2", null), gymId: undefined }; // legacy record with no gymId
const B1 = member("member-b1", "gym-b");

beforeEach(() => {
  vi.clearAllMocks();
  h.findMembers.mockImplementation(() => [A1, B1, A2]);
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name of ${id}`, phone: "123" }));
  h.findSubscriptionByUserId.mockImplementation((id: string) => ({ userId: id, status: "active" }));
});

describe("getStaffMembersData — gym-scoped before any lookup", () => {
  it("returns only the acting gym's members, in order, reading no other gym's profile or subscription", async () => {
    const { getStaffMembersData } = await import("@/lib/staff-members-data");

    const rows = getStaffMembersData({ gymId: null });

    expect(rows.map((r) => r.userId)).toEqual(["member-a1", "member-a2"]);
    expect(rows[0]).toMatchObject({ email: A1.email, fullName: "Name of member-a1", phone: "123", currentStatus: "active" });
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).toEqual(["member-a1", "member-a2"]);
    expect(h.findSubscriptionByUserId.mock.calls.map((c) => c[0])).toEqual(["member-a1", "member-a2"]);
    expect(JSON.stringify(rows)).not.toContain("member-b1");
  });

  it("gym B staff see only gym B", async () => {
    const { getStaffMembersData } = await import("@/lib/staff-members-data");

    expect(getStaffMembersData({ gymId: "gym-b" }).map((r) => r.userId)).toEqual(["member-b1"]);
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).toEqual(["member-b1"]);
  });

  it("returns an empty list, reading nothing, for a gym with no members", async () => {
    const { getStaffMembersData } = await import("@/lib/staff-members-data");

    expect(getStaffMembersData({ gymId: "gym-empty" })).toEqual([]);
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
    expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
  });
});

describe("getStaffMemberWalledSummary — a member without a gym Membership", () => {
  it("shows who they are and what they hold, and nothing they have logged or told us", async () => {
    const { getStaffMemberWalledSummary } = await import("@/lib/staff-members-data");
    h.findUserById.mockReturnValue(A1);
    h.findProfileByUserId.mockReturnValue({
      fullName: "Walled Member", phone: "0831234567", dateOfBirth: "1990-01-01", emergencyContactName: "Next of kin", emergencyContactPhone: "0870000000",
    });
    h.findSubscriptionByUserId.mockReturnValue({ userId: A1.id, status: "canceled", currentPeriodEnd: "2026-10-01T00:00:00.000Z" });

    const s = getStaffMemberWalledSummary(A1.id)!;

    expect(s).toMatchObject({ userId: A1.id, email: A1.email, fullName: "Walled Member", currentStatus: "canceled", walled: true });
    expect([s.phone, s.dateOfBirth, s.emergencyContactName, s.emergencyContactPhone, s.coachNotes, s.weeklyTrainingSchedule]).toEqual([null, null, null, null, null, null]);
    expect([s.totalSessionsLogged, s.personalBests.length, s.upcomingBookings.length, s.pastBookings.length]).toEqual([0, 0, 0, 0]);
    expect(h.findWorkoutSessionsByUserId).not.toHaveBeenCalled();
    expect(h.findBookingsByUserId).not.toHaveBeenCalled();
    expect(h.findCoachNoteByUserId).not.toHaveBeenCalled();
  });
});

describe("getStaffMembersData — groups, stars and the phone number", () => {
  it("each row carries its list group and star, and a member without a gym Membership has no phone number in the list", async () => {
    vi.resetModules();
    vi.doMock("@/lib/membership-entitlement", () => ({
      resolveSubscriptionEntitlement: () => null,
      resolveMemberAccessForUser: (id: string) => ({ digital: false, gymMembership: id === "member-a1" }),
    }));
    const { getStaffMembersData } = await import("@/lib/staff-members-data");
    h.findMembershipPackageById.mockReturnValue({ deliveryChannel: "in_person" });
    h.findSubscriptionByUserId.mockImplementation((id: string) => (id === "member-a1" ? { userId: id, packageId: "p", status: "active" } : undefined));
    h.findStaffMemberStars.mockReturnValue([{ userId: "member-a2", starredByStaffId: "s", starredAt: "now" }]);

    const rows = getStaffMembersData({ gymId: null });

    expect(rows.map((r) => [r.userId, r.membershipGroup, r.starred, r.phone])).toEqual([
      ["member-a1", "current", false, "123"],
      ["member-a2", "none", true, null],
    ]);
    vi.doUnmock("@/lib/membership-entitlement");
  });
});

