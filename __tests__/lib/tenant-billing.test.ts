// The tenant billing rule: active until the paid-through date, then a grace period, then locked. Pure, no datastore.
import { describe, expect, it } from "vitest";

import { DEFAULT_TENANT_GRACE_DAYS, MAX_TENANT_GRACE_DAYS, addDays, isIsoDay, tenantAccess } from "@/lib/tenant-billing";

const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const gym = (paidThrough: string, graceDays?: number) => ({ platformBilling: { paidThrough, ...(graceDays !== undefined ? { graceDays } : {}) } });

describe("tenantAccess", () => {
  it("a gym with no billing is always active (the primary gym, a gym not yet on a plan)", () => {
    expect(tenantAccess(undefined, at("2030-01-01")).state).toBe("active");
    expect(tenantAccess({}, at("2030-01-01")).state).toBe("active");
    expect(tenantAccess({ platformBilling: { paidThrough: "not a date" } }, at("2030-01-01")).state).toBe("active");
  });

  it("is active through the paid-through day itself, then in grace from the next day", () => {
    expect(tenantAccess(gym("2026-12-31"), at("2026-12-31")).state).toBe("active");
    const grace = tenantAccess(gym("2026-12-31"), at("2027-01-01"));
    expect(grace.state).toBe("grace");
    expect(grace.graceEndsOn).toBe(addDays("2026-12-31", DEFAULT_TENANT_GRACE_DAYS));
    expect(grace.graceDaysLeft).toBe(DEFAULT_TENANT_GRACE_DAYS);
  });

  it("counts the grace days down, includes the last grace day, and locks the day after", () => {
    const last = addDays("2026-12-31", DEFAULT_TENANT_GRACE_DAYS);
    const onLast = tenantAccess(gym("2026-12-31"), at(last));
    expect(onLast.state).toBe("grace");
    expect(onLast.graceDaysLeft).toBe(1);
    expect(tenantAccess(gym("2026-12-31"), at(addDays(last, 1))).state).toBe("locked");
  });

  it("a gym's own grace length wins, 0 means locked the day after, and the number is capped", () => {
    expect(tenantAccess(gym("2026-12-31", 0), at("2027-01-01")).state).toBe("locked");
    expect(tenantAccess(gym("2026-12-31", 3), at("2027-01-03")).state).toBe("grace");
    expect(tenantAccess(gym("2026-12-31", 3), at("2027-01-05")).state).toBe("locked");
    expect(tenantAccess(gym("2026-12-31", 9999), at(addDays("2026-12-31", MAX_TENANT_GRACE_DAYS))).state).toBe("grace");
    expect(tenantAccess(gym("2026-12-31", 9999), at(addDays("2026-12-31", MAX_TENANT_GRACE_DAYS + 1))).state).toBe("locked");
  });

  it("paying again restores access straight away (a later paid-through date)", () => {
    expect(tenantAccess(gym("2026-12-31"), at("2027-03-01")).state).toBe("locked");
    expect(tenantAccess(gym("2027-03-31"), at("2027-03-01")).state).toBe("active");
  });

  it("validates dates strictly", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-2-3")).toBe(false);
    expect(isIsoDay(20261231)).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
