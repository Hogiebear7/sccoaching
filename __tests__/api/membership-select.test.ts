import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindMembershipPlanById,
  mockFindSubscriptionByUserId,
  mockFindUserById,
  mockSaveSubscription,
  mockCreateCheckoutForPlan,
} = vi.hoisted(() => ({
  mockFindMembershipPlanById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindUserById: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockCreateCheckoutForPlan: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembershipPlanById: mockFindMembershipPlanById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findUserById: mockFindUserById,
  saveSubscription: mockSaveSubscription,
}));

vi.mock("@/lib/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
  return { ...actual, createCheckoutForPlan: mockCreateCheckoutForPlan };
});

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const PLAN = {
  id: "plan-1",
  name: "Premium",
  description: null,
  priceCents: 4999,
  billingInterval: "monthly" as const,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callSelect(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/membership/select/route");
  const request = new NextRequest("http://localhost/api/membership/select", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/membership/select", () => {
  beforeEach(() => {
    mockFindMembershipPlanById.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockFindUserById.mockReset();
    mockSaveSubscription.mockReset();
    mockCreateCheckoutForPlan.mockReset();
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockCreateCheckoutForPlan.mockResolvedValue({
      provider: "none",
      checkoutUrl: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      providerCustomerId: null,
      error: null,
    });
  });

  it("blocks a duplicate checkout while a recent one is still pending", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      planId: PLAN.id,
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: new Date().toISOString(),
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);

    expect(res.status).toBe(409);
    expect(mockCreateCheckoutForPlan).not.toHaveBeenCalled();
  });

  it("allows retrying once the pending checkout is stale", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      planId: PLAN.id,
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);

    expect(res.status).toBe(200);
    expect(mockCreateCheckoutForPlan).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
  });

  it("allows retrying when the existing pending subscription is for a different plan", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      planId: "some-other-plan",
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: new Date().toISOString(),
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);

    expect(res.status).toBe(200);
    expect(mockCreateCheckoutForPlan).toHaveBeenCalledTimes(1);
  });

  it("records honest inactive intent when billing isn't configured", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBeNull();
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("inactive");
    expect(saved.provider).toBe("none");
  });

  it("returns the checkout URL, marks pending, and stores all provider IDs when billing is configured", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockCreateCheckoutForPlan.mockResolvedValue({
      provider: "revolut",
      checkoutUrl: "https://sandbox-pay.revolut.com/payment-link/ord-setup-1",
      providerSubscriptionId: "sub-1",
      providerSetupOrderId: "ord-setup-1",
      providerCustomerId: "cust-1",
      error: null,
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBe("https://sandbox-pay.revolut.com/payment-link/ord-setup-1");
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("pending");
    expect(saved.providerSubscriptionId).toBe("sub-1");
    expect(saved.providerSetupOrderId).toBe("ord-setup-1");
    expect(saved.providerCustomerId).toBe("cust-1");
  });

  it("passes the existing customer ID to createCheckoutForPlan when the member already has one", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      planId: "some-other-plan",
      status: "inactive",
      provider: "revolut",
      providerCustomerId: "cust-existing",
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      sessionsUsedThisPeriod: 0,
      periodLapsedNotifiedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: new Date().toISOString(),
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    await callSelect({ planId: PLAN.id }, cookie);

    expect(mockCreateCheckoutForPlan).toHaveBeenCalledWith(
      expect.objectContaining({ existingCustomerId: "cust-existing" })
    );
  });

  it("returns 502 with the provider's error instead of faking success", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockCreateCheckoutForPlan.mockResolvedValue({
      provider: "revolut",
      checkoutUrl: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      providerCustomerId: null,
      error: "Revolut subscription creation failed (401): Invalid API key",
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callSelect({ planId: PLAN.id }, cookie);

    expect(res.status).toBe(502);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });
});
