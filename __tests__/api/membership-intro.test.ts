import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindMembershipPlanById,
  mockFindSubscriptionByUserId,
  mockFindUserById,
  mockSavePurchase,
  mockSaveSubscription,
  mockFindPurchasesByUserId,
  mockCreateOneOffCheckout,
} = vi.hoisted(() => ({
  mockFindMembershipPlanById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindUserById: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockFindPurchasesByUserId: vi.fn(),
  mockCreateOneOffCheckout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembershipPlanById: mockFindMembershipPlanById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findUserById: mockFindUserById,
  savePurchase: mockSavePurchase,
  saveSubscription: mockSaveSubscription,
  findPurchasesByUserId: mockFindPurchasesByUserId,
  // Used indirectly by lib/payments imports.
  findPassLedgerByUserId: vi.fn(() => []),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findPassLedgerByBookingId: vi.fn(() => []),
  findClassPassProductById: vi.fn(),
  appendPassLedgerEntry: vi.fn(),
}));

vi.mock("@/lib/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
  return {
    ...actual,
    activeBillingProvider: () => "stripe" as const,
    createCheckoutForPlan: vi.fn(),
    createOneOffCheckout: mockCreateOneOffCheckout,
  };
});

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const INTRO_PLAN = {
  id: "plan-intro",
  name: "Kick-Start",
  description: null,
  priceCents: 9900,
  billingInterval: "monthly" as const,
  monthlySessionAllowance: 12,
  allowedCategories: ["general"],
  isIntro: true,
  introDurationDays: 42,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function purchaseRow(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "pur-intro-1",
    userId: "user-1",
    kind: "membership",
    productId: "plan-intro",
    description: "Kick-Start — introductory membership",
    amountCents: 9900,
    status,
    provider: "stripe",
    providerOrderId: "cs_1",
    providerPaymentRef: null,
    checkoutUrl: "https://checkout.example/1",
    idempotencyKey: "k",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

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

const cookie = () => signSession({ userId: MEMBER_USER.id });

describe("intro membership selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindMembershipPlanById.mockReturnValue(INTRO_PLAN);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockFindPurchasesByUserId.mockReturnValue([]);
    mockCreateOneOffCheckout.mockResolvedValue({
      provider: "stripe",
      providerOrderId: "cs_new",
      checkoutUrl: "https://checkout.example/new",
      error: null,
    });
  });

  it("creates a one-off purchase and checkout — never a subscription", async () => {
    const res = await callSelect({ planId: "plan-intro" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBe("https://checkout.example/new");

    const created = mockSavePurchase.mock.calls[0][0];
    expect(created).toMatchObject({
      kind: "membership",
      productId: "plan-intro",
      amountCents: 9900,
      status: "pending",
    });
    // One-off flow must not touch the subscription record at select time.
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockCreateOneOffCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 9900, productName: expect.stringContaining("introductory") })
    );
  });

  it("blocks a second purchase once one was ever paid (or refunded)", async () => {
    for (const status of ["paid", "refunded"]) {
      mockFindPurchasesByUserId.mockReturnValue([purchaseRow(status)]);
      const res = await callSelect({ planId: "plan-intro" }, cookie());
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.message).toContain("once per member");
    }
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });

  it("blocks members with an active unlapsed membership", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const res = await callSelect({ planId: "plan-intro" }, cookie());
    expect(res.status).toBe(409);
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });

  it("resumes a fresh pending checkout instead of duplicating", async () => {
    mockFindPurchasesByUserId.mockReturnValue([purchaseRow("pending")]);

    const res = await callSelect({ planId: "plan-intro" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBe("https://checkout.example/1");
    expect(mockCreateOneOffCheckout).not.toHaveBeenCalled();
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });

  it("failed and cancelled attempts don't burn eligibility", async () => {
    mockFindPurchasesByUserId.mockReturnValue([
      purchaseRow("failed"),
      purchaseRow("cancelled", { id: "pur-intro-2" }),
    ]);

    const res = await callSelect({ planId: "plan-intro" }, cookie());
    expect(res.status).toBe(200);
    expect(mockSavePurchase).toHaveBeenCalled();
  });

  it("marks the purchase failed when checkout creation fails", async () => {
    mockCreateOneOffCheckout.mockResolvedValue({
      provider: "stripe",
      providerOrderId: null,
      checkoutUrl: null,
      error: "boom",
    });

    const res = await callSelect({ planId: "plan-intro" }, cookie());
    expect(res.status).toBe(502);
    const lastSave = mockSavePurchase.mock.calls.at(-1)![0];
    expect(lastSave.status).toBe("failed");
  });
});

describe("stripeRecurringInterval", () => {
  it("maps app intervals onto Stripe-native recurring settings", async () => {
    const { stripeRecurringInterval } = await vi.importActual<typeof import("@/lib/billing")>(
      "@/lib/billing"
    );
    expect(stripeRecurringInterval("monthly")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringInterval("quarterly")).toEqual({ interval: "month", intervalCount: 3 });
    expect(stripeRecurringInterval("annual")).toEqual({ interval: "year", intervalCount: 1 });
  });
});
