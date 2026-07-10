import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindPurchaseByIdempotencyKey,
  mockSavePurchase,
  mockFindClassPassProductById,
  mockIsConfigured,
  mockIsStale,
  mockActiveProvider,
  mockCreatePassPackCheckout,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindPurchaseByIdempotencyKey: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockFindClassPassProductById: vi.fn(),
  mockIsConfigured: vi.fn(),
  mockIsStale: vi.fn(),
  mockActiveProvider: vi.fn(),
  mockCreatePassPackCheckout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findPurchaseByIdempotencyKey: mockFindPurchaseByIdempotencyKey,
  savePurchase: mockSavePurchase,
  findClassPassProductById: mockFindClassPassProductById,
  // payments.ts pulls these; unused in this route's paths
  appendPassLedgerEntry: vi.fn(),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findPassLedgerByUserId: vi.fn(() => []),
}));

vi.mock("@/lib/billing", () => ({
  isBillingProviderConfigured: mockIsConfigured,
  isPendingCheckoutStale: mockIsStale,
  activeBillingProvider: mockActiveProvider,
  createPassPackCheckout: mockCreatePassPackCheckout,
}));

const MEMBER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const PRODUCT = {
  id: "pack-10",
  name: "10 Pass Pack",
  description: null,
  passCount: 10,
  priceCents: 12000,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callCheckout(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/passes/checkout/route");
  const request = new NextRequest("http://localhost/api/passes/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const cookie = () => signSession({ userId: MEMBER.id });

describe("POST /api/passes/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(MEMBER);
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    mockFindPurchaseByIdempotencyKey.mockReturnValue(undefined);
    mockIsConfigured.mockReturnValue(true);
    mockIsStale.mockReturnValue(false);
    mockActiveProvider.mockReturnValue("stripe");
    mockCreatePassPackCheckout.mockResolvedValue({
      provider: "stripe",
      providerOrderId: "cs_test_1",
      checkoutUrl: "https://checkout.stripe.example/x",
      error: null,
    });
  });

  it("rejects unauthenticated requests", async () => {
    const res = await callCheckout({ productId: "pack-10" });
    expect(res.status).toBe(401);
    expect(mockCreatePassPackCheckout).not.toHaveBeenCalled();
  });

  it("requires a product id", async () => {
    const res = await callCheckout({}, cookie());
    expect(res.status).toBe(400);
  });

  it("rejects unknown or inactive products", async () => {
    mockFindClassPassProductById.mockReturnValue({ ...PRODUCT, isActive: false });
    expect((await callCheckout({ productId: "pack-10" }, cookie())).status).toBe(404);

    mockFindClassPassProductById.mockReturnValue(undefined);
    expect((await callCheckout({ productId: "nope" }, cookie())).status).toBe(404);
  });

  it("returns 503 and creates nothing when billing is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await callCheckout({ productId: "pack-10" }, cookie());
    expect(res.status).toBe(503);
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockCreatePassPackCheckout).not.toHaveBeenCalled();
  });

  it("duplicate submit re-uses the fresh pending checkout — no second provider order", async () => {
    mockFindPurchaseByIdempotencyKey.mockReturnValue({
      id: "pur-existing",
      userId: MEMBER.id,
      status: "pending",
      checkoutUrl: "https://checkout.stripe.example/existing",
      updatedAt: new Date().toISOString(),
    });

    const res = await callCheckout({ productId: "pack-10", idempotencyKey: "abc" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reused).toBe(true);
    expect(data.purchaseId).toBe("pur-existing");
    expect(data.checkoutUrl).toBe("https://checkout.stripe.example/existing");
    expect(mockCreatePassPackCheckout).not.toHaveBeenCalled();
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });

  it("creates a pending purchase, then attaches the provider order", async () => {
    const res = await callCheckout({ productId: "pack-10", idempotencyKey: "abc" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reused).toBe(false);
    expect(data.checkoutUrl).toBe("https://checkout.stripe.example/x");

    // First save: pending, no provider linkage yet
    const first = mockSavePurchase.mock.calls[0][0];
    expect(first).toMatchObject({
      userId: MEMBER.id,
      kind: "pass_pack",
      status: "pending",
      providerOrderId: null,
      idempotencyKey: "user-1:abc",
    });
    // Provider order carries OUR purchase id as the reconciliation ref
    expect(mockCreatePassPackCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseId: first.id,
        member: expect.objectContaining({ id: MEMBER.id }),
      })
    );
    // Second save: provider ids attached
    const second = mockSavePurchase.mock.calls[1][0];
    expect(second).toMatchObject({
      id: first.id,
      providerOrderId: "cs_test_1",
      checkoutUrl: "https://checkout.stripe.example/x",
    });
  });

  it("marks the purchase failed when the provider call fails", async () => {
    mockCreatePassPackCheckout.mockResolvedValue({
      provider: "stripe",
      providerOrderId: null,
      checkoutUrl: null,
      error: "boom",
    });

    const res = await callCheckout({ productId: "pack-10" }, cookie());

    expect(res.status).toBe(502);
    const last = mockSavePurchase.mock.calls.at(-1)?.[0];
    expect(last.status).toBe("failed");
  });

  it("a stale pending purchase does not block a fresh checkout", async () => {
    mockIsStale.mockReturnValue(true);
    mockFindPurchaseByIdempotencyKey.mockReturnValue({
      id: "pur-old",
      userId: MEMBER.id,
      status: "pending",
      checkoutUrl: "https://old.example",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await callCheckout({ productId: "pack-10", idempotencyKey: "abc" }, cookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reused).toBe(false);
    expect(mockCreatePassPackCheckout).toHaveBeenCalledTimes(1);
    // New purchase got a retired (suffixed) key so the old row keeps its own
    const first = mockSavePurchase.mock.calls[0][0];
    expect(first.idempotencyKey.startsWith("user-1:abc:")).toBe(true);
  });
});
