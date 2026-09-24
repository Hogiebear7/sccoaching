// Gym isolation for system-generated member messages sent by two scheduled jobs
// (lib/jobs/notify-lapsed-memberships.ts, lib/jobs/drop-lapsed-manual-memberships.ts).
// Both previously attributed the in-thread message to findAnyStaffUser() — the
// FIRST staff account of ANY gym — so a gym B member's thread could carry a gym A
// staff member's identity. The sender is now resolved per member by
// lib/jobs/system-sender.ts: a staff user in the MEMBER's gym (gymId null = the
// primary gym). A gym with no staff skips only the in-thread message; the
// notification, email, tier drop and notified-marker still happen. The jobs
// remain platform-global runs (they iterate every gym's subscriptions by
// design) — only the cross-gym attribution is closed. sameGym is not mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createMessage: vi.fn(),
  createNotification: vi.fn(),
  findAllSubscriptions: vi.fn(),
  findAnyStaffUser: vi.fn(),
  findProfileByUserId: vi.fn(),
  findStaffUsers: vi.fn(),
  findUserById: vi.fn(),
  saveSubscription: vi.fn(),
  grantMemberTier: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/email", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null }));
vi.mock("@/lib/tier-grant", () => ({ grantMemberTier: h.grantMemberTier }));

type U = { id: string; email: string; role: string; gymId: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId });

// Gym A = primary gym (gymId: null). Gym B = "gym-b". Gym C = "gym-c" has NO staff.
const STAFF_A = user("staff-a", "coach", null);
const STAFF_B = user("staff-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const MEMBER_C = user("member-c", "member", "gym-c");
const EVERYONE = [STAFF_A, STAFF_B, MEMBER_A, MEMBER_B, MEMBER_C];

const ancient = new Date(Date.now() - 30 * 86_400_000).toISOString();
const lapsedSubscription = (userId: string) => ({
  userId,
  packageId: "pkg",
  status: "active",
  provider: "none",
  currentPeriodEnd: ancient,
  periodLapsedNotifiedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const messageSenders = () => Object.fromEntries(h.createMessage.mock.calls.map((c) => [c[0].memberId, c[0].senderId]));

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  // Deliberately gym B's staff FIRST: the old findAnyStaffUser() would have picked them for everyone.
  h.findStaffUsers.mockImplementation(() => [STAFF_B, STAFF_A]);
  h.findAnyStaffUser.mockImplementation(() => STAFF_B);
  h.findAllSubscriptions.mockImplementation(() => [
    lapsedSubscription(MEMBER_A.id),
    lapsedSubscription(MEMBER_B.id),
    lapsedSubscription(MEMBER_C.id),
    lapsedSubscription("member-gone"),
  ]);
  h.findProfileByUserId.mockReturnValue(undefined);
  h.grantMemberTier.mockResolvedValue({ ok: true, tier: "free" });
});

describe("lib/jobs/system-sender.ts", () => {
  it("picks a staff user in the member's own gym; none when the gym has no staff or the member is unresolvable", async () => {
    const { findSystemSenderForMember } = await import("@/lib/jobs/system-sender");

    expect(findSystemSenderForMember(MEMBER_A.id)?.id).toBe("staff-a");
    expect(findSystemSenderForMember(MEMBER_B.id)?.id).toBe("staff-b");
    expect(findSystemSenderForMember(MEMBER_C.id)).toBeUndefined();
    expect(findSystemSenderForMember("member-gone")).toBeUndefined();
  });
});

describe("notifyLapsedMembershipsJob — sender is same-gym", () => {
  it("attributes each message to a staff user in that member's gym, never another gym's", async () => {
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    await notifyLapsedMembershipsJob.run();

    expect(messageSenders()).toEqual({ "member-a": "staff-a", "member-b": "staff-b" });
    expect(h.createMessage.mock.calls.some((c) => c[0].memberId === "member-a" && c[0].senderId === "staff-b")).toBe(false);
  });

  it("a gym with no staff (and an unresolvable member) skips only the message: notification and notified-marker still happen", async () => {
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    const summary = await notifyLapsedMembershipsJob.run();

    expect(h.createMessage.mock.calls.map((c) => c[0].memberId)).not.toContain("member-c");
    expect(h.createMessage.mock.calls.map((c) => c[0].memberId)).not.toContain("member-gone");
    expect(h.createNotification.mock.calls.map((c) => c[0].userId).sort()).toEqual(["member-a", "member-b", "member-c", "member-gone"]);
    expect(h.saveSubscription).toHaveBeenCalledTimes(4);
    expect(summary).toMatch(/notified 4/i);
  });

  it("keeps the existing 'no staff account exists at all' skip", async () => {
    h.findAnyStaffUser.mockReturnValue(undefined);
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    const summary = await notifyLapsedMembershipsJob.run();

    expect(summary).toMatch(/skipped/i);
    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});

describe("dropLapsedManualMembershipsJob — sender is same-gym", () => {
  it("drops every lapsed manual membership and attributes each message to a same-gym staff user", async () => {
    const { dropLapsedManualMembershipsJob } = await import("@/lib/jobs/drop-lapsed-manual-memberships");

    const summary = await dropLapsedManualMembershipsJob.run();

    expect(h.grantMemberTier.mock.calls.map((c) => c[0]).sort()).toEqual(["member-a", "member-b", "member-c", "member-gone"]);
    expect(messageSenders()).toEqual({ "member-a": "staff-a", "member-b": "staff-b" });
    expect(h.createNotification).toHaveBeenCalledTimes(4);
    expect(summary).toMatch(/4/);
  });

  it("does not touch memberships that aren't manual or aren't lapsed past the grace period (unchanged)", async () => {
    h.findAllSubscriptions.mockReturnValue([
      { ...lapsedSubscription(MEMBER_A.id), provider: "stripe" },
      { ...lapsedSubscription(MEMBER_B.id), currentPeriodEnd: new Date(Date.now() - 86_400_000).toISOString() },
    ]);
    const { dropLapsedManualMembershipsJob } = await import("@/lib/jobs/drop-lapsed-manual-memberships");

    await dropLapsedManualMembershipsJob.run();

    expect(h.grantMemberTier).not.toHaveBeenCalled();
    expect(h.createMessage).not.toHaveBeenCalled();
  });
});
