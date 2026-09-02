import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClassCategories: vi.fn(),
  findMembershipCategoryById: vi.fn(),
  saveMembershipCategory: vi.fn(),
  countPackagesByCategoryId: vi.fn(),
  deleteMembershipCategory: vi.fn(),
  findMembershipPackageById: vi.fn(),
  saveMembershipPackage: vi.fn(),
  countBillingOptionsByPackageId: vi.fn(),
  countSubscriptionsByPackageId: vi.fn(),
  deleteMembershipPackage: vi.fn(),
  findMembershipBillingOptionById: vi.fn(),
  saveMembershipBillingOption: vi.fn(),
}));

vi.mock("@/lib/db", () => h);

const STAFF = { id: "s1", email: "c@x.c", role: "staff" as const };
const MEMBER = { id: "m1", email: "m@x.c", role: "member" as const };
const staff = () => signSession({ userId: STAFF.id });

async function call(path: string, body: unknown, cookie?: string) {
  const mod = await import(`@/app/api/staff/catalog/${path}/route`);
  const req = new NextRequest(`http://localhost/api/staff/catalog/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

describe("staff catalog CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findUserById.mockReturnValue(STAFF);
    h.findClassCategories.mockReturnValue([{ slug: "semi_private_pt", name: "Semi-Private" }]);
    h.findMembershipCategoryById.mockReturnValue({ id: "c1", name: "Cat", slug: "cat", visible: true, sortOrder: 0 });
    h.findMembershipPackageById.mockReturnValue(undefined);
    h.findMembershipBillingOptionById.mockReturnValue(undefined);
    h.countPackagesByCategoryId.mockReturnValue(0);
    h.countBillingOptionsByPackageId.mockReturnValue(0);
    h.countSubscriptionsByPackageId.mockReturnValue(0);
  });

  it("rejects non-staff everywhere", async () => {
    h.findUserById.mockReturnValue(MEMBER);
    const c = signSession({ userId: MEMBER.id });
    expect((await call("categories", { name: "X" }, c)).status).toBe(403);
    expect((await call("packages", { categoryId: "c1", name: "X", packageType: "membership", sessionAllowanceType: "unlimited" }, c)).status).toBe(403);
    expect((await call("billing-options", { packageId: "p1", name: "X", billingType: "recurring", priceEur: "10" }, c)).status).toBe(403);
  });

  it("creates a category with a slug and defaults", async () => {
    const res = await call("categories", { name: "Semi-Private PT" }, staff());
    expect(res.status).toBe(200);
    const saved = h.saveMembershipCategory.mock.calls[0][0];
    expect(saved).toMatchObject({ name: "Semi-Private PT", slug: "semi_private_pt", visible: true, imageUrl: null, imageAlt: null });
  });

  it("accepts a valid category cover image and rejects an invalid one", async () => {
    const ok = await call(
      "categories",
      { name: "Over 50s", imageUrl: "data:image/png;base64,iVBORw0KGgo=", imageAlt: "An older athlete training with a coach" },
      staff()
    );
    expect(ok.status).toBe(200);
    expect(h.saveMembershipCategory.mock.calls[0][0]).toMatchObject({
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      imageAlt: "An older athlete training with a coach",
    });

    const bad = await call("categories", { name: "Over 50s", imageUrl: "https://example.com/photo.jpg" }, staff());
    expect(bad.status).toBe(400);
  });

  it("omitting imageUrl on an edit leaves the existing category cover untouched", async () => {
    h.findMembershipCategoryById.mockReturnValue({
      id: "c1",
      name: "Cat",
      slug: "cat",
      visible: true,
      sortOrder: 0,
      imageUrl: "data:image/png;base64,existing=",
      imageAlt: "Existing alt",
    });
    const res = await call("categories", { id: "c1", name: "Cat", visible: true, sortOrder: 0 }, staff());
    expect(res.status).toBe(200);
    expect(h.saveMembershipCategory.mock.calls[0][0]).toMatchObject({
      imageUrl: "data:image/png;base64,existing=",
      imageAlt: "Existing alt",
    });
  });

  it("packages require a valid allowance count for fixed_count", async () => {
    const bad = await call("packages", { categoryId: "c1", name: "P", packageType: "membership", sessionAllowanceType: "fixed_count", sessionAllowanceCount: 0 }, staff());
    expect(bad.status).toBe(400);

    const ok = await call("packages", { categoryId: "c1", name: "P", packageType: "membership", sessionAllowanceType: "fixed_count", sessionAllowanceCount: 12, eligibleClassTypes: ["semi_private_pt", "bogus"] }, staff());
    expect(ok.status).toBe(200);
    const saved = h.saveMembershipPackage.mock.calls[0][0];
    expect(saved.sessionAllowanceCount).toBe(12);
    // Unknown class slugs are dropped.
    expect(saved.eligibleClassTypes).toEqual(["semi_private_pt"]);
  });

  it("single_use packages default the count to 1", async () => {
    await call("packages", { categoryId: "c1", name: "Pass", packageType: "pass", sessionAllowanceType: "single_use" }, staff());
    expect(h.saveMembershipPackage.mock.calls[0][0].sessionAllowanceCount).toBe(1);
  });

  it("recurring billing options need an interval; one-time carry none", async () => {
    h.findMembershipPackageById.mockReturnValue({ id: "p1" });

    const noInterval = await call("billing-options", { packageId: "p1", name: "Monthly", billingType: "recurring", priceEur: "250" }, staff());
    expect(noInterval.status).toBe(400);

    const rec = await call("billing-options", { packageId: "p1", name: "Quarterly", billingType: "recurring", intervalUnit: "month", intervalCount: 3, priceEur: "720" }, staff());
    expect(rec.status).toBe(200);
    expect(h.saveMembershipBillingOption.mock.calls[0][0]).toMatchObject({ amountCents: 72000, intervalUnit: "month", intervalCount: 3 });

    const one = await call("billing-options", { packageId: "p1", name: "One-off", billingType: "one_time", priceEur: "35" }, staff());
    expect(one.status).toBe(200);
    expect(h.saveMembershipBillingOption.mock.calls[1][0]).toMatchObject({ amountCents: 3500, intervalUnit: null, intervalCount: null });
  });

  it("category delete is blocked while it has packages", async () => {
    h.countPackagesByCategoryId.mockReturnValue(3);
    const res = await call("categories/delete", { id: "c1" }, staff());
    expect(res.status).toBe(409);
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
  });

  it("package delete is blocked by options or subscriptions, else deletes", async () => {
    h.findMembershipPackageById.mockReturnValue({ id: "p1", name: "P" });
    h.countBillingOptionsByPackageId.mockReturnValue(2);
    expect((await call("packages/delete", { id: "p1" }, staff())).status).toBe(409);

    h.countBillingOptionsByPackageId.mockReturnValue(0);
    h.countSubscriptionsByPackageId.mockReturnValue(1);
    expect((await call("packages/delete", { id: "p1" }, staff())).status).toBe(409);

    h.countSubscriptionsByPackageId.mockReturnValue(0);
    expect((await call("packages/delete", { id: "p1" }, staff())).status).toBe(200);
    expect(h.deleteMembershipPackage).toHaveBeenCalledWith("p1");
  });
});
