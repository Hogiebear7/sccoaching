// The pure rule set in lib/iap/entitlement-conflict.ts, exercised without a datastore. Fake
// package scopes only; no provider, no real token.
import { describe, expect, it } from "vitest";

import {
  ENTITLEMENT_CONFLICT_MEMBER_MESSAGE,
  ENTITLEMENT_CONFLICT_MESSAGE,
  evaluateEntitlementConflict,
  evaluateProviderTransition,
  evaluateReferenceMismatch,
  isCurrentPlayToken,
  isProviderEntitled,
  liveEntitlement,
  scopeOfPackage,
  type EntitlementScope,
  type EntitlementWriteIntent,
} from "@/lib/iap/entitlement-conflict";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const FUTURE = "2026-11-07T12:00:00.000Z";
const PAST = "2026-09-01T12:00:00.000Z";

const scopeOf = (id: string): EntitlementScope | null =>
  id === "pkg-membership" ? "membership" : id === "pkg-app" ? "app_subscription" : null;

type Row = Parameters<typeof evaluateEntitlementConflict>[0];
const row = (over: Partial<NonNullable<Row>>): NonNullable<Row> => ({
  packageId: "pkg-membership",
  status: "active",
  currentPeriodEnd: FUTURE,
  provider: "none",
  ...over,
});

const MEMBERSHIP_GRANT: EntitlementWriteIntent = { kind: "staff_write", scope: "membership", entitling: true };
const APP_GRANT: EntitlementWriteIntent = { kind: "staff_write", scope: "app_subscription", entitling: true };
const FREE_WRITE: EntitlementWriteIntent = { kind: "staff_write", scope: null, entitling: false };
const PLAY_CLAIM: EntitlementWriteIntent = { kind: "play_claim" };

const check = (existing: Row, intent: EntitlementWriteIntent) => evaluateEntitlementConflict(existing, intent, scopeOf, NOW)?.code ?? null;

describe("scopeOfPackage", () => {
  it("uses deliveryChannel app_only as the one App Subscription marker", () => {
    expect(scopeOfPackage({ deliveryChannel: "app_only" })).toBe("app_subscription");
    expect(scopeOfPackage({ deliveryChannel: "in_person" })).toBe("membership");
    expect(scopeOfPackage({ deliveryChannel: "hybrid" } as never)).toBe("membership");
    expect(scopeOfPackage(undefined)).toBeNull();
  });
});

describe("liveEntitlement: what counts as an active entitlement (interpretation I3)", () => {
  it.each([
    ["active, period ahead", row({ status: "active" }), "membership"],
    ["active, no period end recorded", row({ status: "active", currentPeriodEnd: null }), "membership"],
    ["past_due (grace)", row({ status: "past_due", currentPeriodEnd: PAST }), "membership"],
    ["paused", row({ status: "paused", currentPeriodEnd: PAST }), "membership"],
  ])("treats %s as live", (_label, r, scope) => {
    expect(liveEntitlement(r, scopeOf, NOW)?.scope).toBe(scope);
  });

  it.each([
    ["pending", row({ status: "pending" })],
    ["inactive", row({ status: "inactive" })],
    ["canceled", row({ status: "canceled" })],
    ["active but lapsed", row({ status: "active", currentPeriodEnd: PAST })],
    ["no package", row({ packageId: null })],
    ["a package that no longer resolves", row({ packageId: "deleted-package" })],
  ])("treats %s as not live", (_label, r) => {
    expect(liveEntitlement(r, scopeOf, NOW)).toBeNull();
  });

  it("treats no subscription at all as not live", () => {
    expect(liveEntitlement(undefined, scopeOf, NOW)).toBeNull();
    expect(liveEntitlement(null, scopeOf, NOW)).toBeNull();
  });
});

describe("Membership active -> an App Subscription cannot be added (D1)", () => {
  it.each(["active", "past_due", "paused"] as const)("rejects a manual App Subscription grant over a %s Membership", (status) => {
    expect(check(row({ status }), APP_GRANT)).toBe("membership_active");
  });

  it("rejects a Google Play claim over an active Membership", () => {
    expect(check(row({ status: "active" }), PLAY_CLAIM)).toBe("membership_active");
    expect(check(row({ status: "paused" }), PLAY_CLAIM)).toBe("membership_active");
  });

  it.each([
    ["pending", row({ status: "pending" })],
    ["inactive", row({ status: "inactive" })],
    ["canceled", row({ status: "canceled" })],
    ["expired (lapsed active)", row({ status: "active", currentPeriodEnd: PAST })],
    ["absent", undefined],
  ] as const)("allows a claim once the Membership is %s (only after it is no longer active)", (_label, existing) => {
    expect(check(existing, PLAY_CLAIM)).toBeNull();
    expect(check(existing, APP_GRANT)).toBeNull();
  });

  it("a Membership that is cancelled but still inside its paid period still blocks, because the row is still active", () => {
    expect(check(row({ status: "active", currentPeriodEnd: FUTURE }), PLAY_CLAIM)).toBe("membership_active");
  });
});

describe("App Subscription live -> a Membership cannot be added (I1)", () => {
  const app = (over: Partial<NonNullable<Row>> = {}) => row({ packageId: "pkg-app", ...over });

  it.each(["active", "past_due", "paused"] as const)("rejects a Membership grant over a %s manual App Subscription", (status) => {
    expect(check(app({ status }), MEMBERSHIP_GRANT)).toBe("app_subscription_active");
  });

  it("allows a Membership once the App Subscription has ended or lapsed", () => {
    expect(check(app({ status: "canceled" }), MEMBERSHIP_GRANT)).toBeNull();
    expect(check(app({ status: "active", currentPeriodEnd: PAST }), MEMBERSHIP_GRANT)).toBeNull();
    expect(check(app({ status: "pending" }), MEMBERSHIP_GRANT)).toBeNull();
  });

  it("does not block a non-entitling Membership write (pending/inactive) over a manual App Subscription", () => {
    expect(check(app(), { kind: "staff_write", scope: "membership", entitling: false })).toBeNull();
  });
});

describe("a live Google Play subscription is never overwritten by staff (I2)", () => {
  const play = (over: Partial<NonNullable<Row>> = {}) => row({ packageId: "pkg-app", provider: "google_play", ...over });

  it.each(["active", "past_due", "paused"] as const)("rejects every kind of write over a %s Play subscription", (status) => {
    for (const intent of [MEMBERSHIP_GRANT, APP_GRANT, FREE_WRITE]) {
      expect(check(play({ status }), intent)).toBe("play_billing_active");
    }
  });

  it("allows a write once the Play subscription is no longer live", () => {
    expect(check(play({ status: "canceled" }), MEMBERSHIP_GRANT)).toBeNull();
    expect(check(play({ status: "active", currentPeriodEnd: PAST }), FREE_WRITE)).toBeNull();
  });

  it("a Play claim over a live Play subscription is not a conflict here (token chains are handled by the Play service)", () => {
    expect(check(play(), PLAY_CLAIM)).toBeNull();
  });
});

describe("writes that do not conflict", () => {
  it("allows the same-kind refresh and a downgrade to Free of a manual entitlement", () => {
    expect(check(row({ status: "active" }), MEMBERSHIP_GRANT)).toBeNull();
    expect(check(row({ status: "active" }), FREE_WRITE)).toBeNull();
    expect(check(row({ packageId: "pkg-app", status: "active" }), APP_GRANT)).toBeNull();
    expect(check(row({ packageId: "pkg-app", status: "active" }), FREE_WRITE)).toBeNull();
  });
});

describe("messages", () => {
  it("are stable, non-empty and free of identifiers or dates, for staff and for members", () => {
    for (const table of [ENTITLEMENT_CONFLICT_MESSAGE, ENTITLEMENT_CONFLICT_MEMBER_MESSAGE]) {
      expect(Object.keys(table).sort()).toEqual(["app_subscription_active", "membership_active", "other_provider_active", "play_billing_active"]);
      for (const message of Object.values(table)) {
        expect(message.length).toBeGreaterThan(20);
        expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}|GPA\.|@/i);
      }
    }
  });
});

describe("isCurrentPlayToken", () => {
  const sub = { provider: "google_play" as const, providerSubscriptionId: "token-current" };
  it("matches only the token the row is billed through", () => {
    expect(isCurrentPlayToken(sub, "token-current")).toBe(true);
    expect(isCurrentPlayToken(sub, "token-old")).toBe(false);
  });
  it("never matches a non-Play row or a missing row", () => {
    expect(isCurrentPlayToken({ provider: "stripe", providerSubscriptionId: "token-current" }, "token-current")).toBe(false);
    expect(isCurrentPlayToken({ provider: "none", providerSubscriptionId: null }, "x")).toBe(false);
    expect(isCurrentPlayToken(undefined, "x")).toBe(false);
  });
});

describe("cross-provider rules (pure)", () => {
  type P = "none" | "stripe" | "revolut" | "google_play";
  const r = (provider: P, status: NonNullable<Row>["status"], currentPeriodEnd: string | null = FUTURE) => ({ provider, status, currentPeriodEnd });
  const code = (existing: ReturnType<typeof r> | undefined, incoming: P) => evaluateProviderTransition(existing, incoming, NOW)?.code ?? null;

  it.each(["stripe", "revolut", "google_play"] as const)("a live %s row refuses a completion from either other paid provider", (held) => {
    for (const status of ["active", "past_due", "paused"] as const) {
      for (const incoming of (["stripe", "revolut", "google_play"] as const).filter((p) => p !== held)) {
        expect(code(r(held, status), incoming)).toBe("other_provider_active");
      }
    }
  });

  it("the same provider is always allowed, live or not", () => {
    for (const p of ["stripe", "revolut", "google_play"] as const) {
      expect(code(r(p, "active"), p)).toBeNull();
      expect(code(r(p, "canceled"), p)).toBeNull();
    }
  });

  it("a cancelled-but-still-paid row (active, future paid-through) is live, and stops being live once the period has passed", () => {
    expect(code(r("google_play", "active", FUTURE), "stripe")).toBe("other_provider_active");
    expect(code(r("google_play", "active", PAST), "stripe")).toBeNull();
    expect(isProviderEntitled({ status: "active", currentPeriodEnd: PAST }, NOW)).toBe(false);
    expect(isProviderEntitled({ status: "past_due", currentPeriodEnd: PAST }, NOW)).toBe(true); // grace
  });

  it.each(["pending", "inactive", "canceled"] as const)("a %s row of another provider does not block", (status) => {
    expect(code(r("google_play", status), "stripe")).toBeNull();
  });

  it("manual rows and absent rows never conflict, and a manual incoming provider is not a paid provider", () => {
    expect(code(r("none", "active"), "stripe")).toBeNull();
    expect(code(undefined, "stripe")).toBeNull();
    expect(code(r("stripe", "active"), "none")).toBeNull();
  });

  it("a reference found on another paid provider's row is refused whether or not that row is live", () => {
    expect(evaluateReferenceMismatch({ provider: "google_play" }, "stripe")?.code).toBe("other_provider_active");
    expect(evaluateReferenceMismatch({ provider: "revolut" }, "stripe")?.code).toBe("other_provider_active");
    expect(evaluateReferenceMismatch({ provider: "stripe" }, "stripe")).toBeNull();
    expect(evaluateReferenceMismatch({ provider: "none" }, "stripe")).toBeNull();
  });

  it("a Play claim over a live Stripe or Revolut App Subscription is other_provider_active, over a Membership it stays membership_active", () => {
    const app = (provider: P) => row({ packageId: "pkg-app", provider });
    expect(check(app("stripe"), PLAY_CLAIM)).toBe("other_provider_active");
    expect(check(app("revolut"), PLAY_CLAIM)).toBe("other_provider_active");
    expect(check(row({ provider: "stripe" }), PLAY_CLAIM)).toBe("membership_active");
  });
});
