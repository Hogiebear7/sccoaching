// The go-live gate: off by default; when on, a new unpaid gym can be set up by its staff but its members, invites, AI and member emails are held until it pays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ gyms: new Map<string, unknown>() }));
vi.mock("@/lib/db", () => ({ findGymById: (id: string) => h.gyms.get(id) }));

import { dueGoLiveReminder, gymIsLive, gymNotLive, GO_LIVE_REMINDER_DAYS, paymentGateEnabled, refundWindowDays } from "@/lib/tenant-live";
import { lockoutResponse } from "@/lib/tenant-lockout";
import type { TenantContext } from "@/lib/tenant-context";

const ctx = (over: Partial<TenantContext>): TenantContext => ({ gymId: "g1", isPlatformOperator: false, role: "member", userId: "u1", ...over }) as TenantContext;

beforeEach(() => {
  h.gyms.clear();
  h.gyms.set("g1", { id: "g1", platformBilling: undefined });
  h.gyms.set("paid", { id: "paid", platformBilling: { paidThrough: "2099-01-01" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("the rule", () => {
  it("is off unless the switch is exactly true", () => {
    expect(paymentGateEnabled()).toBe(false);
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "yes");
    expect(paymentGateEnabled()).toBe(false);
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
    expect(paymentGateEnabled()).toBe(true);
  });
  it("a gym is live once it has a paid-through date; no gym record (S&C) is live", () => {
    expect(gymIsLive(undefined)).toBe(true);
    expect(gymIsLive({ platformBilling: undefined })).toBe(false);
    expect(gymIsLive({ platformBilling: { paidThrough: "2026-12-01" } })).toBe(true);
  });
  it("only gates when the switch is on", () => {
    expect(gymNotLive({ platformBilling: undefined })).toBe(false);
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
    expect(gymNotLive({ platformBilling: undefined })).toBe(true);
    expect(gymNotLive({ platformBilling: { paidThrough: "2026-12-01" } })).toBe(false);
  });
});

describe("what a not-live gym's people can do", () => {
  it("nothing changes with the switch off", () => {
    expect(lockoutResponse(ctx({ role: "member" }))).toBeNull();
    expect(lockoutResponse(ctx({ role: "admin_manager" }), { requiresLive: true })).toBeNull();
  });
  it("members are held, staff can set up, staff cannot use the member-facing parts", async () => {
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
    const member = lockoutResponse(ctx({ role: "member" }));
    expect(member?.status).toBe(423);
    expect((await member!.json()).code).toBe("tenant_not_live");

    expect(lockoutResponse(ctx({ role: "admin_manager" }))).toBeNull(); // setting up is allowed
    const invites = lockoutResponse(ctx({ role: "admin_manager" }), { requiresLive: true });
    expect(invites?.status).toBe(423);
    expect((await invites!.json()).message).toMatch(/go live/i);
  });
  it("a paid gym, S&C and a platform operator are never held", () => {
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
    expect(lockoutResponse(ctx({ gymId: "paid", role: "member" }))).toBeNull();
    expect(lockoutResponse(ctx({ gymId: null, role: "member" }))).toBeNull();
    expect(lockoutResponse(ctx({ isPlatformOperator: true, role: "platform_operator" }), { requiresLive: true })).toBeNull();
  });
});

describe("money-back window by gym size", () => {
  it("14 days to 150 members, 7 to 300, 3 above", () => {
    expect([0, 50, 150].map(refundWindowDays)).toEqual([14, 14, 14]);
    expect([151, 300].map(refundWindowDays)).toEqual([7, 7]);
    expect([301, 501, 5000].map(refundWindowDays)).toEqual([3, 3, 3]);
  });
});

describe("reminder days", () => {
  const created = "2026-11-01T10:00:00Z";
  const at = (days: number) => new Date(Date.parse(created) + days * 86_400_000 + 3_600_000);
  it("none before day 3, then 3, 7 and 14", () => {
    expect(GO_LIVE_REMINDER_DAYS).toEqual([3, 7, 14]);
    expect(dueGoLiveReminder(created, at(1))).toBeNull();
    expect(dueGoLiveReminder(created, at(3))).toBe(3);
    expect(dueGoLiveReminder(created, at(6))).toBe(3);
    expect(dueGoLiveReminder(created, at(7))).toBe(7);
    expect(dueGoLiveReminder(created, at(40))).toBe(14);
    expect(dueGoLiveReminder("nonsense", at(5))).toBeNull();
  });
});
