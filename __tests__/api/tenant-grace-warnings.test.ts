// Who is warned while a gym is in its grace period: admins for the whole grace, coaches only in the second half, members never. A locked gym is shown to everyone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
let fx: IapFixture;

// Paid through `daysAgo` days ago with a 14-day grace: day 1 of grace is daysAgo = 1.
function gymPaidThrough(daysAgo: number) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
    platformBilling: { paidThrough: day(-daysAgo) },
  });
}

async function statusFor(role: string) {
  const { tenantStatusFor } = await import("@/lib/tenant-lockout");
  return tenantStatusFor({ role, gymId: GYM_B } as never).state;
}

beforeEach(async () => {
  fx = await createFixture();
  vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("grace warnings", () => {
  it("first week of grace: admins are warned, coaches and members are not", async () => {
    gymPaidThrough(3);
    expect(await statusFor("admin_manager")).toBe("grace");
    expect(await statusFor("admin")).toBe("grace");
    expect(await statusFor("coach")).toBe("active");
    expect(await statusFor("member")).toBe("active");
  });

  it("the last day of the first week still warns only admins", async () => {
    gymPaidThrough(7);
    expect(await statusFor("coach")).toBe("active");
  });

  it("second week: admins and coaches are warned, members are not", async () => {
    gymPaidThrough(8);
    expect(await statusFor("admin_manager")).toBe("grace");
    expect(await statusFor("coach")).toBe("grace");
    expect(await statusFor("member")).toBe("active");
  });

  it("a locked gym shows as locked to everyone", async () => {
    gymPaidThrough(40);
    for (const role of ["admin_manager", "coach", "member"]) expect(await statusFor(role)).toBe("locked");
  });
});
