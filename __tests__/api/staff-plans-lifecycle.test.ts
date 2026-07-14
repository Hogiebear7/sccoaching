import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindMembershipPlanById,
  mockCountSubscriptionsByPlanId,
  mockDeleteMembershipPlan,
  mockSaveMembershipPlan,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockCountSubscriptionsByPlanId: vi.fn(),
  mockDeleteMembershipPlan: vi.fn(),
  mockSaveMembershipPlan: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findMembershipPlanById: mockFindMembershipPlanById,
  countSubscriptionsByPlanId: mockCountSubscriptionsByPlanId,
  deleteMembershipPlan: mockDeleteMembershipPlan,
  saveMembershipPlan: mockSaveMembershipPlan,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

const PLAN = {
  id: "plan-1",
  name: "Premium",
  description: null,
  priceCents: 4999,
  billingInterval: "monthly" as const,
  monthlySessionAllowance: 8,
  allowedCategories: ["general"],
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callRoute(path: "delete" | "archive", body: unknown, cookie?: string) {
  const { POST } = await import(`@/app/api/staff/plans/${path}/route`);
  const request = new NextRequest(`http://localhost/api/staff/plans/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("plan archive/delete routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockCountSubscriptionsByPlanId.mockReturnValue(0);
  });

  it("delete rejects non-staff sessions", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const res = await callRoute("delete", { id: "plan-1" }, signSession({ userId: MEMBER_USER.id }));

    expect(res.status).toBe(403);
    expect(mockDeleteMembershipPlan).not.toHaveBeenCalled();
  });

  it("delete refuses when any subscription references the plan", async () => {
    mockCountSubscriptionsByPlanId.mockReturnValue(3);
    const res = await callRoute("delete", { id: "plan-1" }, signSession({ userId: STAFF_USER.id }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toContain("3 memberships");
    expect(data.message).toContain("Archive");
    expect(mockDeleteMembershipPlan).not.toHaveBeenCalled();
  });

  it("delete removes an unreferenced plan", async () => {
    const res = await callRoute("delete", { id: "plan-1" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    expect(mockDeleteMembershipPlan).toHaveBeenCalledWith("plan-1");
  });

  it("archive toggles isActive without touching other fields", async () => {
    const res = await callRoute(
      "archive",
      { id: "plan-1", isActive: false },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(200);
    const saved = mockSaveMembershipPlan.mock.calls[0][0];
    expect(saved.isActive).toBe(false);
    expect(saved.name).toBe(PLAN.name);
    expect(saved.priceCents).toBe(PLAN.priceCents);
    expect(saved.allowedCategories).toEqual(PLAN.allowedCategories);
  });

  it("archive requires a boolean isActive", async () => {
    const res = await callRoute(
      "archive",
      { id: "plan-1", isActive: "false" },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(400);
    expect(mockSaveMembershipPlan).not.toHaveBeenCalled();
  });
});
