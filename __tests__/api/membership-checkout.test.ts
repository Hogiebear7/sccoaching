import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindOption,
  mockFindPackage,
  mockFindCategory,
  mockFindPurchaseByKey,
  mockFindSubByUser,
  mockSavePurchase,
  mockSaveSubscription,
  mockCreateCatalogCheckout,
  mockActiveProvider,
} = vi.hoisted(() => ({
  mockActiveProvider: vi.fn(() => "stripe" as string),
  mockFindUserById: vi.fn(),
  mockFindOption: vi.fn(),
  mockFindPackage: vi.fn(),
  mockFindCategory: vi.fn(),
  mockFindPurchaseByKey: vi.fn(),
  mockFindSubByUser: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockCreateCatalogCheckout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembershipBillingOptionById: mockFindOption,
  findMembershipCategoryById: mockFindCategory,
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
    activeBillingProvider: mockActiveProvider,
    isPendingCheckoutStale: () => false,
    createCatalogCheckout: mockCreateCatalogCheckout,
  };
});

vi.mock("@/lib/payments", () => ({ isPurchaseCheckoutReusable: () => false }));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const MEMBER = { id: "u1", email: "a@b.c", role: "member" as const, gymId: null };
const GYM_A_CATEGORY = { id: "c1", gymId: null, name: "Cat", slug: "cat" };
const GYM_B_CATEGORY = { id: "c1", gymId: "gym-b", name: "Cat", slug: "cat" };

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

const cookie = () => signSession({ userId: MEMBER.id }, MEMBER_SESSION_LIFETIME_MS);

describe("POST /api/membership/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
    mockFindPackage.mockReturnValue(PKG);
    mockFindCategory.mockReturnValue(GYM_A_CATEGORY);
    mockActiveProvider.mockReturnValue("stripe");
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
    expect(first).toMatchObject({ packageId: "pkg1", billingOptionId: "opt_rec", status: "pending" });
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

  it("switch stages the change in pending* fields WITHOUT clobbering the active membership", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const active = {
      userId: MEMBER.id, packageId: "pkg_old", billingOptionId: "opt_other",
      status: "active", provider: "stripe", providerSubscriptionId: "sub_old",
      providerSetupOrderId: "cs_old", currentPeriodEnd: future,
      sessionsUsedThisPeriod: 4, extraSessionGrants: [{ id: "g" }],
    };
    mockFindSubByUser.mockReturnValue(active);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(res.status).toBe(200);

    // Both saves keep the ACTIVE fields exactly as they were — access preserved.
    for (const [saved] of mockSaveSubscription.mock.calls) {
      expect(saved.status).toBe("active");
      expect(saved.billingOptionId).toBe("opt_other");
      expect(saved.packageId).toBe("pkg_old");
      expect(saved.providerSubscriptionId).toBe("sub_old");
      expect(saved.currentPeriodEnd).toBe(future);
      expect(saved.sessionsUsedThisPeriod).toBe(4);
      // The change lives ONLY in the pending fields.
      expect(saved.pendingPackageId).toBe("pkg1");
      expect(saved.pendingBillingOptionId).toBe("opt_rec");
    }
    // Second save attaches the switch session id for the webhook to find.
    expect(mockSaveSubscription.mock.calls[1][0].pendingSetupOrderId).toBe("cs_1");
  });

  it("duplicate switch to the same option already in flight → 409, no second checkout", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    mockFindSubByUser.mockReturnValue({
      status: "active", billingOptionId: "opt_other", currentPeriodEnd: future,
      pendingBillingOptionId: "opt_rec", pendingSetupOrderId: "cs_inflight",
      pendingStartedAt: new Date().toISOString(),
    });

    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(res.status).toBe(409);
    expect(mockCreateCatalogCheckout).not.toHaveBeenCalled();
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("rolls the staged switch back to clean if checkout creation fails", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    mockFindSubByUser.mockReturnValue({
      userId: MEMBER.id, status: "active", packageId: "pkg_old", billingOptionId: "opt_other",
      providerSubscriptionId: "sub_old", currentPeriodEnd: future,
    });
    mockCreateCatalogCheckout.mockResolvedValue({ provider: "stripe", mode: "subscription", sessionId: null, checkoutUrl: null, error: "boom" });

    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(res.status).toBe(502);
    // Last save clears the pending fields — member left cleanly on their old plan.
    const last = mockSaveSubscription.mock.calls.at(-1)![0];
    expect(last.pendingPackageId).toBeNull();
    expect(last.pendingBillingOptionId).toBeNull();
    expect(last.pendingSetupOrderId).toBeNull();
    expect(last.pendingStartedAt).toBeNull();
    // Active fields intact.
    expect(last.status).toBe("active");
    expect(last.billingOptionId).toBe("opt_other");
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

// Cross-gym isolation: option -> package -> category -> gymId. The existing
// happy-path tests above already run with a same-gym category (the default
// mockFindCategory fixture) and prove the same-gym flow is unchanged; these
// cases prove the ownership chain itself is resolved and enforced before any
// subscription/purchase is saved.
describe("POST /api/membership/checkout — gym ownership", () => {
  const APP_ONLY_PKG = { ...PKG, id: "pkg_app", categoryId: "c1", deliveryChannel: "app_only" as const, billingChannel: "google_play" as const };

  function expectNoMutation() {
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockCreateCatalogCheckout).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
    mockFindPackage.mockReturnValue(PKG);
    mockFindCategory.mockReturnValue(GYM_A_CATEGORY);
    mockActiveProvider.mockReturnValue("stripe");
    mockFindPurchaseByKey.mockReturnValue(undefined);
    mockFindSubByUser.mockReturnValue(undefined);
    mockCreateCatalogCheckout.mockResolvedValue({
      provider: "stripe", mode: "subscription", sessionId: "cs_1", checkoutUrl: "https://x/1", error: null,
    });
  });

  it("resolves the ownership chain through the package's category (same-gym allowed, mutation as before)", async () => {
    mockFindOption.mockReturnValue(RECURRING);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: true, checkoutUrl: "https://x/1" });
    expect(mockFindPackage).toHaveBeenCalledWith(RECURRING.packageId);
    expect(mockFindCategory).toHaveBeenCalledWith(PKG.categoryId);
    expect(mockSaveSubscription).toHaveBeenCalled();
  });

  it("denies a cross-gym ordinary billing option with the existing not-found response, mutating nothing", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockFindCategory.mockReturnValue(GYM_B_CATEGORY);
    const crossGym = await call({ billingOptionId: "opt_rec" }, cookie());
    const crossGymBody = await crossGym.json();
    expectNoMutation();

    mockFindOption.mockReturnValue(undefined);
    const missing = await call({ billingOptionId: "opt_missing" }, cookie());
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGym.status).toBe(missing.status);
    expect(crossGymBody).toEqual(missingBody);
    expect(crossGymBody.message).toBe("This option is not available.");
  });

  it("denies a cross-gym one-time option too, without saving a purchase", async () => {
    mockFindOption.mockReturnValue(ONE_TIME);
    mockFindCategory.mockReturnValue(GYM_B_CATEGORY);

    const res = await call({ billingOptionId: "opt_one" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("returns the existing failure for a missing billing option, mutating nothing", async () => {
    mockFindOption.mockReturnValue(undefined);

    const res = await call({ billingOptionId: "opt_missing" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("fails closed when the option's package is missing", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockFindPackage.mockReturnValue(undefined);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("fails closed when the package's category is missing", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockFindCategory.mockReturnValue(undefined);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("keeps the global exception: a visible app_only package is reachable by a member of another gym", async () => {
    mockFindOption.mockReturnValue({ ...RECURRING, packageId: "pkg_app" });
    mockFindPackage.mockReturnValue(APP_ONLY_PKG);
    mockFindCategory.mockReturnValue(GYM_B_CATEGORY);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalled();
  });

  it("still applies the existing visibility rule to app_only packages (the seeded App Subscription is visible: false, so checkout cannot reach it)", async () => {
    mockFindOption.mockReturnValue({ ...RECURRING, packageId: "pkg_app" });
    mockFindPackage.mockReturnValue({ ...APP_ONLY_PKG, visible: false });
    mockFindCategory.mockReturnValue(GYM_A_CATEGORY);

    const res = await call({ billingOptionId: "opt_rec" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("does not treat billingChannel, package slug, or a null-gym category as the global exception", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockFindCategory.mockReturnValue(GYM_B_CATEGORY);

    for (const overrides of [
      { billingChannel: "manual" as const },
      { billingChannel: "google_play" as const },
      { slug: "app-subscription-tier-2" },
      { deliveryChannel: "hybrid" as const },
    ]) {
      mockFindPackage.mockReturnValue({ ...PKG, ...overrides });
      const res = await call({ billingOptionId: "opt_rec" }, cookie());
      expect(res.status).toBe(404);
    }
    expectNoMutation();

    // A member with a real gym id is not treated as global via a null-gym category either.
    mockFindUserById.mockReturnValue({ ...MEMBER, gymId: "gym-b" });
    mockFindPackage.mockReturnValue(PKG);
    mockFindCategory.mockReturnValue(GYM_A_CATEGORY);
    const nullCategory = await call({ billingOptionId: "opt_rec" }, cookie());
    expect(nullCategory.status).toBe(404);
    expectNoMutation();
  });

  it("rejects an unauthenticated request without resolving or mutating anything", async () => {
    mockFindOption.mockReturnValue(RECURRING);

    const res = await call({ billingOptionId: "opt_rec" });

    expect(res.status).toBe(401);
    expect(mockFindOption).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("preserves the existing billing-provider rejection for a same-gym option, mutating nothing", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockActiveProvider.mockReturnValue("none");

    const res = await call({ billingOptionId: "opt_rec" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.message).toBe("Online payment isn't set up yet. Ask staff about joining at the club.");
    expectNoMutation();
  });

  it("gives a cross-gym option the same 404 even when the provider is unavailable (no existence signal via 503)", async () => {
    mockFindOption.mockReturnValue(RECURRING);
    mockFindCategory.mockReturnValue(GYM_B_CATEGORY);
    mockActiveProvider.mockReturnValue("none");

    const res = await call({ billingOptionId: "opt_rec" }, cookie());

    expect(res.status).toBe(404);
    expectNoMutation();
  });
});
