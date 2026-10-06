// Unit tests for the verified tenant context (lib/tenant-context.ts).
import { describe, expect, it } from "vitest";

import { buildTenantContext, cacheKey, inTenant, platformScopeAllowed, selectorMatchesTenant, tenantKey } from "@/lib/tenant-context";

const primaryMember = { id: "u-primary", role: "member", gymId: null };
const gymBCoach = { id: "u-b", role: "coach", gymId: "gym-b" };
const operator = { id: "u-op", role: "platform_operator", gymId: null };

describe("buildTenantContext", () => {
  it("derives the tenant from the account and defaults a missing gym to the primary gym", () => {
    expect(buildTenantContext({ id: "x", role: "coach" })).toMatchObject({ userId: "x", gymId: null, role: "coach" });
    expect(buildTenantContext(gymBCoach).gymId).toBe("gym-b");
  });

  it("is frozen, so a downstream helper cannot replace the tenant", () => {
    const ctx = buildTenantContext(gymBCoach);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => {
      (ctx as { gymId: string | null }).gymId = "gym-a";
    }).toThrow(TypeError);
    expect(ctx.gymId).toBe("gym-b");
  });

  it("does not follow later changes made to the source account object", () => {
    const account = { id: "x", role: "coach", gymId: "gym-b" as string | null };
    const ctx = buildTenantContext(account);
    account.gymId = "gym-a";
    expect(ctx.gymId).toBe("gym-b");
  });

  it("marks only the exact platform_operator role, never rank or a null gym", () => {
    expect(buildTenantContext(operator).isPlatformOperator).toBe(true);
    expect(buildTenantContext({ id: "m", role: "admin_manager", gymId: null }).isPlatformOperator).toBe(false);
    expect(buildTenantContext({ id: "m", role: "staff", gymId: null }).isPlatformOperator).toBe(false);
    expect(platformScopeAllowed(buildTenantContext(primaryMember))).toBe(false);
  });
});

describe("inTenant", () => {
  it("treats the primary gym as a tenant: null matches null, undefined matches null", () => {
    const ctx = buildTenantContext(primaryMember);
    expect(inTenant(ctx, { gymId: null })).toBe(true);
    expect(inTenant(ctx, {})).toBe(true);
    expect(inTenant(ctx, { gymId: "gym-b" })).toBe(false);
  });

  it("never lets a platform operator cross tenants", () => {
    const ctx = buildTenantContext(operator);
    expect(inTenant(ctx, { gymId: "gym-b" })).toBe(false);
    expect(inTenant(ctx, { gymId: null })).toBe(true);
  });

  it("denies a different gym in both directions", () => {
    expect(inTenant(buildTenantContext(gymBCoach), { gymId: null })).toBe(false);
    expect(inTenant(buildTenantContext(gymBCoach), { gymId: "gym-c" })).toBe(false);
  });
});

describe("selectorMatchesTenant: a client-supplied gym id can confirm but never switch the tenant", () => {
  const b = buildTenantContext(gymBCoach);
  const primary = buildTenantContext(primaryMember);

  it.each([undefined, null, ""])("accepts an absent selector (%j)", (s) => {
    expect(selectorMatchesTenant(b, s)).toBe(true);
    expect(selectorMatchesTenant(primary, s)).toBe(true);
  });

  it("accepts the verified tenant's own id", () => {
    expect(selectorMatchesTenant(b, "gym-b")).toBe(true);
  });

  it("rejects another gym's id for a gym account and for the primary gym", () => {
    expect(selectorMatchesTenant(b, "gym-a")).toBe(false);
    expect(selectorMatchesTenant(primary, "gym-b")).toBe(false);
  });

  it("rejects a selector for an operator naming another gym", () => {
    expect(selectorMatchesTenant(buildTenantContext(operator), "gym-b")).toBe(false);
  });
});

describe("tenantKey and cacheKey", () => {
  it("keys the primary gym and a gym differently", () => {
    expect(tenantKey({ gymId: null })).toBe("gym:primary");
    expect(tenantKey({ gymId: "gym-b" })).toBe("gym:gym-b");
  });

  it("never reuses a key across tenants or users for tenant and user classes", () => {
    const a = buildTenantContext({ id: "u1", role: "coach", gymId: null });
    const b = buildTenantContext({ id: "u2", role: "coach", gymId: "gym-b" });
    const a2 = buildTenantContext({ id: "u3", role: "coach", gymId: null });
    expect(cacheKey(a, "tenant", "classes")).not.toBe(cacheKey(b, "tenant", "classes"));
    expect(cacheKey(a, "tenant", "classes")).toBe(cacheKey(a2, "tenant", "classes"));
    expect(cacheKey(a, "user", "profile")).not.toBe(cacheKey(a2, "user", "profile"));
    expect(cacheKey(a, "global", "exercises")).toBe(cacheKey(b, "global", "exercises"));
  });

  it("rejects empty or separator-bearing parts that could collapse two keys together", () => {
    const a = buildTenantContext(primaryMember);
    expect(() => cacheKey(a, "tenant", "")).toThrow();
    expect(() => cacheKey(a, "tenant", "x|user:other")).toThrow();
  });
});
