// The pure rule set in lib/iap/entitlement-conflict.ts, exercised without a datastore. Fake package scopes only; no provider,
// no real token.
//
// Since owner decision D1 (2026-10-15) a gym Membership and the App-only digital plan are separate products. This module no
// longer decides whether they overlap (they cannot): it only refuses to write the app-only package into a Membership row, and
// keeps the cross-provider rules between the paid providers of a Membership.
import { describe, expect, it } from "vitest";

import {
  ENTITLEMENT_CONFLICT_MEMBER_MESSAGE,
  ENTITLEMENT_CONFLICT_MESSAGE,
  evaluateEntitlementConflict,
  evaluateProviderTransition,
  evaluateReferenceMismatch,
  isProviderEntitled,
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

const check = (existing: Row, intent: EntitlementWriteIntent) => evaluateEntitlementConflict(existing, intent, scopeOf, NOW)?.code ?? null;

describe("scopeOfPackage", () => {
  it("uses deliveryChannel app_only as the one digital-plan marker", () => {
    expect(scopeOfPackage({ deliveryChannel: "app_only" })).toBe("app_subscription");
    expect(scopeOfPackage({ deliveryChannel: "in_person" })).toBe("membership");
    expect(scopeOfPackage({ deliveryChannel: "hybrid" } as never)).toBe("membership");
    expect(scopeOfPackage(undefined)).toBeNull();
  });
});

describe("the app-only package is never written into a Membership row", () => {
  it.each([
    ["nothing", undefined],
    ["a live Membership", row({})],
    ["a lapsed Membership", row({ currentPeriodEnd: PAST })],
    ["a legacy digital row", row({ packageId: "pkg-app" })],
    ["a live Stripe Membership", row({ provider: "stripe" })],
  ] as const)("refuses an app-only write over %s", (_label, existing) => {
    expect(check(existing as Row, APP_GRANT)).toBe("app_plan_not_assignable");
  });

  it("refuses it whether or not the write would be entitling", () => {
    expect(check(undefined, { kind: "staff_write", scope: "app_subscription", entitling: false })).toBe("app_plan_not_assignable");
  });
});

describe("a gym Membership write is never blocked by what else the member holds", () => {
  it.each(["active", "past_due", "paused", "canceled", "pending", "inactive"] as const)("allows a Membership grant over a %s row", (status) => {
    expect(check(row({ status }), MEMBERSHIP_GRANT)).toBeNull();
  });

  it("allows a Membership grant over a legacy digital row, and a downgrade to Free", () => {
    expect(check(row({ packageId: "pkg-app" }), MEMBERSHIP_GRANT)).toBeNull();
    expect(check(row({}), FREE_WRITE)).toBeNull();
  });
});

describe("messages", () => {
  it("are stable, non-empty and free of identifiers or dates, for staff and for members", () => {
    for (const table of [ENTITLEMENT_CONFLICT_MESSAGE, ENTITLEMENT_CONFLICT_MEMBER_MESSAGE]) {
      for (const message of Object.values(table)) {
        expect(message.length).toBeGreaterThan(20);
        expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}|token|sub_|cs_/i);
      }
    }
  });

  it("tell a member the digital plan is bought in the store apps, not on the website", () => {
    expect(ENTITLEMENT_CONFLICT_MEMBER_MESSAGE.app_plan_not_assignable).toMatch(/Google Play or App Store/);
  });
});

describe("cross-provider rules (pure)", () => {
  type P = "none" | "stripe" | "revolut" | "google_play";
  const r = (provider: P, status: NonNullable<Row>["status"], currentPeriodEnd: string | null = FUTURE) => ({ provider, status, currentPeriodEnd });
  const code = (existing: ReturnType<typeof r> | undefined, incoming: P) => evaluateProviderTransition(existing, incoming, NOW)?.code ?? null;

  it.each(["stripe", "revolut"] as const)("a live %s row refuses a completion from the other paid provider", (held) => {
    for (const status of ["active", "past_due", "paused"] as const) {
      for (const incoming of (["stripe", "revolut"] as const).filter((p) => p !== held)) {
        expect(code(r(held, status), incoming)).toBe("other_provider_active");
      }
    }
  });

  it("the same provider is always allowed, live or not", () => {
    for (const p of ["stripe", "revolut"] as const) {
      expect(code(r(p, "active"), p)).toBeNull();
      expect(code(r(p, "canceled"), p)).toBeNull();
    }
  });

  it("a cancelled-but-still-paid row (active, future paid-through) is live, and stops being live once the period has passed", () => {
    expect(code(r("stripe", "active", FUTURE), "revolut")).toBe("other_provider_active");
    expect(code(r("stripe", "active", PAST), "revolut")).toBeNull();
    expect(isProviderEntitled({ status: "active", currentPeriodEnd: PAST }, NOW)).toBe(false);
    expect(isProviderEntitled({ status: "past_due", currentPeriodEnd: PAST }, NOW)).toBe(true); // grace
  });

  it.each(["pending", "inactive", "canceled"] as const)("a %s row of another provider does not block", (status) => {
    expect(code(r("stripe", status), "revolut")).toBeNull();
  });

  it("manual rows and absent rows never conflict, and a manual incoming provider is not a paid provider", () => {
    expect(code(r("none", "active"), "stripe")).toBeNull();
    expect(code(undefined, "stripe")).toBeNull();
    expect(code(r("stripe", "active"), "none")).toBeNull();
  });

  it("a reference found on another paid provider's row is refused whether or not that row is live", () => {
    expect(evaluateReferenceMismatch({ provider: "revolut" }, "stripe")?.code).toBe("other_provider_active");
    expect(evaluateReferenceMismatch({ provider: "stripe" }, "stripe")).toBeNull();
    expect(evaluateReferenceMismatch({ provider: "none" }, "stripe")).toBeNull();
  });
});
