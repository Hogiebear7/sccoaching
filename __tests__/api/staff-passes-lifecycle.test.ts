import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassPassProductById,
  mockSaveClassPassProduct,
  mockCountPurchasesByProductId,
  mockDeleteClassPassProduct,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassPassProductById: vi.fn(),
  mockSaveClassPassProduct: vi.fn(),
  mockCountPurchasesByProductId: vi.fn(),
  mockDeleteClassPassProduct: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassPassProductById: mockFindClassPassProductById,
  saveClassPassProduct: mockSaveClassPassProduct,
  countPurchasesByProductId: mockCountPurchasesByProductId,
  deleteClassPassProduct: mockDeleteClassPassProduct,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

const PRODUCT = {
  id: "pack-10",
  name: "10 Pass Pack",
  description: null,
  passCount: 10,
  priceCents: 12000,
  validityDays: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callRoute(path: "" | "archive" | "delete", body: unknown, cookie?: string) {
  const mod = path
    ? await import(`@/app/api/staff/passes/${path}/route`)
    : await import("@/app/api/staff/passes/route");
  const request = new NextRequest(`http://localhost/api/staff/passes/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return mod.POST(request);
}

const staffCookie = () => signSession({ userId: STAFF_USER.id });

describe("pass-pack product CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassPassProductById.mockReturnValue(undefined);
    mockCountPurchasesByProductId.mockReturnValue(0);
  });

  it("rejects non-staff on every route", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const cookie = signSession({ userId: MEMBER_USER.id });

    for (const [path, body] of [
      ["", { name: "X", passCount: "5", priceEur: "50" }],
      ["archive", { id: "pack-10", isActive: false }],
      ["delete", { id: "pack-10" }],
    ] as const) {
      const res = await callRoute(path, body, cookie);
      expect(res.status).toBe(403);
    }
    expect(mockSaveClassPassProduct).not.toHaveBeenCalled();
    expect(mockDeleteClassPassProduct).not.toHaveBeenCalled();
  });

  it("creates a pack with validity and defaults isActive to true", async () => {
    const res = await callRoute(
      "",
      { name: " 5 Pass Pack ", passCount: "5", priceEur: "65.00", validityDays: "90" },
      staffCookie()
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Pass pack created.");
    const saved = mockSaveClassPassProduct.mock.calls[0][0];
    expect(saved).toMatchObject({
      name: "5 Pass Pack",
      passCount: 5,
      priceCents: 6500,
      validityDays: 90,
      isActive: true,
    });
    expect(saved.id).toBeTruthy();
  });

  it("blank validity means no expiry", async () => {
    const res = await callRoute(
      "",
      { name: "Pack", passCount: "5", priceEur: "65", validityDays: "" },
      staffCookie()
    );
    expect(res.status).toBe(200);
    expect(mockSaveClassPassProduct.mock.calls[0][0].validityDays).toBeNull();
  });

  it("rejects invalid passCount, price, and validity values", async () => {
    const bads = [
      { name: "P", passCount: "0", priceEur: "65" },
      { name: "P", passCount: "2.5", priceEur: "65" },
      { name: "P", passCount: "101", priceEur: "65" },
      { name: "P", passCount: "5", priceEur: "0" },
      { name: "P", passCount: "5", priceEur: "abc" },
      { name: "P", passCount: "5", priceEur: "65", validityDays: "0" },
      { name: "P", passCount: "5", priceEur: "65", validityDays: "1826" },
      { name: "P", passCount: "5", priceEur: "65", validityDays: "12.5" },
    ];
    for (const body of bads) {
      const res = await callRoute("", body, staffCookie());
      expect(res.status).toBe(400);
    }
    expect(mockSaveClassPassProduct).not.toHaveBeenCalled();
  });

  it("edits preserve id and createdAt; unknown id is 404", async () => {
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    const res = await callRoute(
      "",
      { id: "pack-10", name: "10 Pack", passCount: "10", priceEur: "110", validityDays: "180" },
      staffCookie()
    );
    expect(res.status).toBe(200);
    const saved = mockSaveClassPassProduct.mock.calls[0][0];
    expect(saved.id).toBe("pack-10");
    expect(saved.createdAt).toBe(PRODUCT.createdAt);
    expect(saved.priceCents).toBe(11000);
    expect(saved.validityDays).toBe(180);

    mockFindClassPassProductById.mockReturnValue(undefined);
    const missing = await callRoute(
      "",
      { id: "ghost", name: "X", passCount: "5", priceEur: "50" },
      staffCookie()
    );
    expect(missing.status).toBe(404);
  });

  it("archive toggles isActive only", async () => {
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    const res = await callRoute("archive", { id: "pack-10", isActive: false }, staffCookie());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("archived");
    const saved = mockSaveClassPassProduct.mock.calls[0][0];
    expect(saved.isActive).toBe(false);
    expect(saved.passCount).toBe(PRODUCT.passCount);
    expect(saved.priceCents).toBe(PRODUCT.priceCents);
  });

  it("delete refuses while purchases reference the product", async () => {
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    mockCountPurchasesByProductId.mockReturnValue(4);

    const res = await callRoute("delete", { id: "pack-10" }, staffCookie());
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toContain("4 purchases");
    expect(data.message).toContain("Archive");
    expect(mockDeleteClassPassProduct).not.toHaveBeenCalled();
  });

  it("delete removes a never-purchased product", async () => {
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    const res = await callRoute("delete", { id: "pack-10" }, staffCookie());

    expect(res.status).toBe(200);
    expect(mockDeleteClassPassProduct).toHaveBeenCalledWith("pack-10");
  });
});
