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
  findProfileByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWeeklyTrainingScheduleByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null }));

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
