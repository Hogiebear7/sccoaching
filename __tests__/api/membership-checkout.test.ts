import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindOption,
  mockFindPackage,
  mockFindPurchaseByKey,
  mockFindSubByUser,
  mockSavePurchase,
  mockSaveSubscription,
  mockCreateCatalogCheckout,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindOption: vi.fn(),
  mockFindPackage: vi.fn(),
  mockFindPurchaseByKey: vi.fn(),
  mockFindSubByUser: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockCreateCatalogCheckout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembershipBillingOptionById: mockFindOption,
  findMembershipPackageById: mockFindPackage,
  findPurchaseByIdempotencyKey: mockFindPurchaseByKey,
  findSubscriptionByUserId: mockFindSubByUser,
  findUserById: mockFindUserById,
  savePurchase: mockSavePurchase,
  saveSubscription: mockSaveSubscription,
}));

vi.mock("@/lib/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
  return {
    ...actual,
    activeBillingProvider: () => "stripe" as const,
    isPendingCheckoutStale: () => false,
    createCatalogCheckout: mockCreateCatalogCheckout,
  };
});

vi.mock("@/lib/payments", () => ({ isPurchaseCheckoutReusable: () => false }));

const MEMBER = { id: "u1", email: "a@b.c", role: "member" as const };

const RECURRING = {
  id: "opt_rec", packageId: "pkg1", name: "Monthly", billingType: "recurring" as const,
  intervalUnit: "month" as const, intervalCount: 1, amountCents: 25000, currency: "eur",
  visible: true, sortOrder: 0, stripePriceId: null, createdAt: "x", updatedAt: "x",
};
const ONE_TIME = { ...RECURRING, id: "opt_one", billingType: "one_time" as const, intervalUnit: null, intervalCount: null, amountCents: 3500 };
const PKG = {
  id: "pkg1", categoryId: "c1", name: "Unlimited", slug: "u", shortDescription: null, fullDescription: null,
  packageType: "membership" as const, sessionAllowanceType: "unlimited" as const, sessionAllowanceCount: null,
  eligibleClassTypes: [], visible: true, sortOrder: 0, stripeProductId: null, createdAt: "x", updatedAt: "x",
};

async function call(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/membership/checkout/route");
  const req = new NextRequest("http://localhost/api/membership/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return POST(req);
}

const cookie = () => signSession({ userId: MEMBER.id });

describe("POST /api/membership/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
    mockFindPackage.mockReturnValue(PKG);
    mockFindPurchaseByKey.mockReturnValue(undefined);
    mockFindSubByUser.mockReturnValue(undefined);
    mockCreateCatalogCheckout.mockResolvedValue({
      provider: "stripe", mode: "subscription", sessionId: "cs_1", checkoutUrl: "https://x/1", error: null,
    });
  });

  it("requires auth", async () => {
    const res = await call({ billingOptionId: "opt_rec" });
    expect(res.status).toBe(401);
  });

  it("404s on a hidden or missing option/package", async () => {
    mockFindOption.mockReturnValue({ ...RECURRING, visible: false });
    expect((await call({ billingOptionId: "opt_rec" }, cookie())).status).toBe(404);

    mockFindOption.mockReturnValue(RECURRING);
    mockFindPackage.mockReturnValue({ ...PKG, visible: false });
    expect((await call({ billingOptionId: "opt_rec" }, cookie())).status).toBe(404);
  });

  it("recurring → pending subscription carrying packageId + billingOptionId + setup order id", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBe("https://x/1");
    // First save = pending (no order id yet); second = with the session id.
    const first = mockSaveSubscription.mock.calls[0][0];
    expect(first).toMatchObject({ packageId: "pkg1", billingOptionId: "opt_rec", status: "pending", planId: null });
    const second = mockSaveSubscription.mock.calls[1][0];
    expect(second.providerSetupOrderId).toBe("cs_1");
  });

  it("blocks re-buying the exact active recurring option, but allows switching", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();

    // Already active on this exact option → 409, no new subscription.
    mockFindSubByUser.mockReturnValue({ status: "active", billingOptionId: "opt_rec", currentPeriodEnd: future });
    const same = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(same.status).toBe(409);
    expect(mockSaveSubscription).not.toHaveBeenCalled();

    // Active on a DIFFERENT option → switching is allowed.
    mockFindSubByUser.mockReturnValue({ status: "active", billingOptionId: "opt_other", currentPeriodEnd: future });
    const switched = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(switched.status).toBe(200);
  });

  it("one-time → pass_pack purchase keyed to the package", async () => {
    mockFindOption.mockReturnValue(ONE_TIME);
    mockCreateCatalogCheckout.mockResolvedValue({
      provider: "stripe", mode: "payment", sessionId: "cs_2", checkoutUrl: "https://x/2", error: null,
    });

    const res = await call({ billingOptionId: "opt_one" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checkoutUrl).toBe("https://x/2");
    const created = mockSavePurchase.mock.calls[0][0];
    expect(created).toMatchObject({ kind: "pass_pack", productId: "pkg1", amountCents: 3500, status: "pending" });
    // Second save attaches the session id as the provider order id.
    expect(mockSavePurchase.mock.calls[1][0].providerOrderId).toBe("cs_2");
    // A one-time buy must never create a subscription.
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("marks the purchase failed if checkout creation fails", async () => {
    mockFindOption.mockReturnValue(ONE_TIME);
    mockCreateCatalogCheckout.mockResolvedValue({ provider: "stripe", mode: "payment", sessionId: null, checkoutUrl: null, error: "boom" });
    const res = await call({ billingOptionId: "opt_one" }, cookie());
    expect(res.status).toBe(502);
    expect(mockSavePurchase.mock.calls.at(-1)![0].status).toBe("failed");
  });
});
