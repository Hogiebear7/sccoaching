import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindSubscriptionByUserId,
  mockFindMembershipPlanById,
  mockSaveSubscription,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockSaveSubscription: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPlanById: mockFindMembershipPlanById,
  saveSubscription: mockSaveSubscription,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "athlete@example.com", role: "member" as const };

const CAPPED_PLAN = {
  id: "plan-1",
  name: "Standard",
  monthlySessionAllowance: 8,
  allowedCategories: [],
};

const SUBSCRIPTION = {
  userId: MEMBER_USER.id,
  planId: "plan-1",
  status: "active" as const,
  provider: "none" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  providerSetupOrderId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 6,
  extraSessionGrants: [],
  periodLapsedNotifiedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

async function callGrant(body: unknown, cookie?: string, targetUserId = MEMBER_USER.id) {
  const { POST } = await import("@/app/api/staff/members/[userId]/extra-sessions/route");
  const request = new NextRequest(
    `http://localhost/api/staff/members/${targetUserId}/extra-sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: `session=${cookie}` } : {}),
      },
      body: JSON.stringify(body),
    }
  );
  return POST(request, { params: Promise.resolve({ userId: targetUserId }) });
}

describe("POST /api/staff/members/[userId]/extra-sessions", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockFindMembershipPlanById.mockReset();
    mockSaveSubscription.mockReset();

    mockFindUserById.mockImplementation((id: string) =>
      id === STAFF_USER.id ? STAFF_USER : id === MEMBER_USER.id ? MEMBER_USER : undefined
    );
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);
    mockFindMembershipPlanById.mockReturnValue(CAPPED_PLAN);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callGrant({ amount: 2 });

    expect(res.status).toBe(401);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("rejects non-staff users", async () => {
    const res = await callGrant({ amount: 2 }, signSession({ userId: MEMBER_USER.id }));

    expect(res.status).toBe(403);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    const res = await callGrant({ amount: 2 }, signSession({ userId: STAFF_USER.id }), "nobody");

    expect(res.status).toBe(404);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it.each([0, -1, 2.5, 21, "3"])("rejects invalid amount %p", async (amount) => {
    const res = await callGrant({ amount }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(400);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("rejects when the member has no plan", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);

    const res = await callGrant({ amount: 2 }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(400);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("rejects when the plan is unlimited", async () => {
    mockFindMembershipPlanById.mockReturnValue({
      ...CAPPED_PLAN,
      monthlySessionAllowance: null,
    });

    const res = await callGrant({ amount: 2 }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(400);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("appends a grant and returns the new remaining balance", async () => {
    const res = await callGrant(
      { amount: 3, note: "  Missed class goodwill  " },
      signSession({ userId: STAFF_USER.id })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);

    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.extraSessionGrants).toHaveLength(1);
    expect(saved.extraSessionGrants[0]).toMatchObject({
      amount: 3,
      note: "Missed class goodwill",
      grantedByUserId: STAFF_USER.id,
    });
    // 8 included − 6 used + 3 extra = 5 remaining
    expect(data.remainingSessions).toBe(5);
  });

  it("stores an empty note as null and keeps prior grants", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      ...SUBSCRIPTION,
      extraSessionGrants: [
        {
          id: "grant-0",
          amount: 1,
          note: null,
          grantedByUserId: STAFF_USER.id,
          createdAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    const res = await callGrant({ amount: 2 }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.extraSessionGrants).toHaveLength(2);
    expect(saved.extraSessionGrants[1].note).toBeNull();
  });
});
