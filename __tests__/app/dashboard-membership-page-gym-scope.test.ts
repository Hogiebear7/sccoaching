// Cross-gym READ isolation for the member catalog page
// app/(dashboard)/dashboard/membership/page.tsx. The page is a plain async
// Server Component, so calling it returns an UNrendered element whose props
// (handed to MembershipView) can be inspected without a DOM — the same harness
// as staff-users-page-gym-scope.test.ts. The member's gym comes from the
// server-side session user; no client value can broaden it. Ownership chain:
// package -> categoryId -> MembershipCategoryRecord.gymId (only categories carry
// a gym); billing option -> package. The sole platform-global exception is an
// app-only package (isGlobalCatalogPackage, lib/gym-scope.ts) — the same rule
// checkout enforces. gymId: null is the primary-gym convention.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mockCookies }));

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findMembershipCategories: vi.fn(),
  findMembershipPackages: vi.fn(),
  findMembershipBillingOptions: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/billing", () => ({ isBillingProviderConfigured: () => true }));
vi.mock("@/lib/payments", () => ({
  purchasedPassBalance: () => 0,
  expiringPassSummary: () => null,
}));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null }));
vi.mock("@/app/(dashboard)/dashboard/membership/MembershipView", () => ({ MembershipView: () => null }));

type Cat = { id: string; name: string; gymId?: string | null; visible: boolean };
type Pkg = { id: string; name: string; categoryId: string; visible: boolean; deliveryChannel: string };
type Opt = { id: string; packageId: string; name: string; amountCents: number; visible: boolean };
type Props = { categories: Cat[]; packages: Pkg[]; billingOptions: Opt[] };

const member = (id: string, gymId: string | null, role = "member") => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });
const MEMBER_A = member("member-a", null);
const MEMBER_B = member("member-b", "gym-b");
const STAFF_A = member("coach-a", null, "coach");

// Gym A = primary gym (gymId null/undefined). Gym B = "gym-b".
const CATEGORIES: Cat[] = [
  { id: "cat-a", name: "Gym A Memberships", gymId: null, visible: true },
  { id: "cat-a-legacy", name: "Gym A Legacy", visible: true }, // gymId absent = primary gym
  { id: "cat-a-hidden", name: "Gym A Hidden", gymId: null, visible: false },
  { id: "cat-b", name: "SecretGymB Memberships", gymId: "gym-b", visible: true },
  { id: "cat-app", name: "App Plans", gymId: "gym-b", visible: true }, // owned by B, holds the global package
];
const PACKAGES: Pkg[] = [
  { id: "pkg-a", name: "Gym A Unlimited", categoryId: "cat-a", visible: true, deliveryChannel: "in_person" },
  { id: "pkg-a-legacy", name: "Gym A Legacy Plan", categoryId: "cat-a-legacy", visible: true, deliveryChannel: "in_person" },
  { id: "pkg-a-hidden", name: "Gym A Hidden Plan", categoryId: "cat-a", visible: false, deliveryChannel: "in_person" },
  { id: "pkg-b", name: "SecretGymB Unlimited", categoryId: "cat-b", visible: true, deliveryChannel: "in_person" },
  { id: "pkg-b-sibling", name: "SecretGymB Sibling", categoryId: "cat-app", visible: true, deliveryChannel: "in_person" },
  { id: "pkg-orphan", name: "Orphan Plan", categoryId: "cat-gone", visible: true, deliveryChannel: "in_person" },
  { id: "pkg-app", name: "App Subscription", categoryId: "cat-app", visible: true, deliveryChannel: "app_only" },
];
const OPTIONS: Opt[] = [
  { id: "opt-a", packageId: "pkg-a", name: "Gym A Monthly", amountCents: 5000, visible: true },
  { id: "opt-a-hidden", packageId: "pkg-a", name: "Gym A Hidden Option", amountCents: 4000, visible: false },
  { id: "opt-a-legacy", packageId: "pkg-a-legacy", name: "Gym A Legacy Monthly", amountCents: 4500, visible: true },
  { id: "opt-b", packageId: "pkg-b", name: "SecretGymB Monthly", amountCents: 9999, visible: true },
  { id: "opt-b-sibling", packageId: "pkg-b-sibling", name: "SecretGymB Sibling Monthly", amountCents: 7777, visible: true },
  { id: "opt-orphan", packageId: "pkg-orphan", name: "Orphan Monthly", amountCents: 1, visible: true },
  { id: "opt-app", packageId: "pkg-app", name: "App Monthly", amountCents: 999, visible: true },
];

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}

async function callPage(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import("@/app/(dashboard)/dashboard/membership/page");
  return (Page as (p: unknown) => Promise<{ props: Props }>)({ searchParams: Promise.resolve(searchParams) });
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [MEMBER_A, MEMBER_B, STAFF_A].find((u) => u.id === id));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.findMembershipCategories.mockImplementation(() => CATEGORIES);
  h.findMembershipPackages.mockImplementation(() => PACKAGES);
  h.findMembershipBillingOptions.mockImplementation(() => OPTIONS);
  mockCookies.mockResolvedValue(sessionCookieStore(MEMBER_A.id));
});

describe("DashboardMembershipPage — same-gym catalog only", () => {
  it("a gym A member gets only gym A visible categories/packages/options plus the global app-only package", async () => {
    const { props } = await callPage();

    expect(ids(props.packages)).toEqual(["pkg-a", "pkg-a-legacy", "pkg-app"]);
    expect(ids(props.billingOptions)).toEqual(["opt-a", "opt-a-legacy", "opt-app"]);
    // Categories: own gym's visible categories, plus the category that holds the
    // surviving global package (so it can render). cat-a-hidden stays hidden.
    expect(ids(props.categories)).toEqual(["cat-a", "cat-a-legacy", "cat-app"]);
  });

  it("a gym B member gets only gym B's catalog (and the same global app-only package)", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(MEMBER_B.id));

    const { props } = await callPage();

    expect(ids(props.packages)).toEqual(["pkg-app", "pkg-b", "pkg-b-sibling"]);
    expect(ids(props.billingOptions)).toEqual(["opt-app", "opt-b", "opt-b-sibling"]);
    expect(ids(props.categories)).toEqual(["cat-app", "cat-b"]);
  });

  it("exposes no other-gym package name, price, billing option, or identifier to a gym A member", async () => {
    const { props } = await callPage();
    const text = JSON.stringify(props);

    for (const leaked of ["SecretGymB", "pkg-b", "opt-b", "cat-b", "9999", "7777"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("does not let a foreign-gym sibling ride along with the global package's category", async () => {
    // cat-app belongs to gym B; only the app-only package in it may reach gym A.
    const { props } = await callPage();

    expect(props.packages.some((p) => p.id === "pkg-b-sibling")).toBe(false);
    expect(props.billingOptions.some((o) => o.id === "opt-b-sibling")).toBe(false);
  });

  it("preserves the app-only exception exactly: keyed on deliveryChannel, not on the category's gym", async () => {
    // Same package, no longer app-only -> it belongs to gym B via its category and must vanish for gym A.
    h.findMembershipPackages.mockImplementation(() =>
      PACKAGES.map((p) => (p.id === "pkg-app" ? { ...p, deliveryChannel: "in_person" } : p))
    );

    const { props } = await callPage();

    expect(ids(props.packages)).toEqual(["pkg-a", "pkg-a-legacy"]);
    expect(ids(props.billingOptions)).toEqual(["opt-a", "opt-a-legacy"]);
    expect(ids(props.categories)).toEqual(["cat-a", "cat-a-legacy"]);
  });

  it("fails closed for a package whose category can't be resolved (and its billing options)", async () => {
    const { props } = await callPage();

    expect(props.packages.some((p) => p.id === "pkg-orphan")).toBe(false);
    expect(props.billingOptions.some((o) => o.id === "opt-orphan")).toBe(false);
  });

  it("still hides non-visible packages, options and categories (existing behavior)", async () => {
    const { props } = await callPage();

    expect(props.packages.some((p) => p.id === "pkg-a-hidden")).toBe(false);
    expect(props.billingOptions.some((o) => o.id === "opt-a-hidden")).toBe(false);
    expect(props.categories.some((c) => c.id === "cat-a-hidden")).toBe(false);
  });

  it("treats a legacy category without a gymId as the primary gym", async () => {
    const { props } = await callPage();

    expect(props.categories.some((c) => c.id === "cat-a-legacy")).toBe(true);
    expect(props.packages.some((p) => p.id === "pkg-a-legacy")).toBe(true);
  });

  it("gives an empty catalog (not an error) when the member's gym has nothing published", async () => {
    h.findMembershipCategories.mockReturnValue(CATEGORIES.filter((c) => c.gymId === "gym-b" && c.id !== "cat-app"));
    h.findMembershipPackages.mockReturnValue(PACKAGES.filter((p) => p.id === "pkg-b"));
    h.findMembershipBillingOptions.mockReturnValue(OPTIONS.filter((o) => o.id === "opt-b"));

    const { props } = await callPage();

    expect(props.categories).toEqual([]);
    expect(props.packages).toEqual([]);
    expect(props.billingOptions).toEqual([]);
  });

  it("ignores client-supplied gymId in the search params", async () => {
    const { props } = await callPage({ gymId: "gym-b" });

    expect(ids(props.packages)).toEqual(["pkg-a", "pkg-a-legacy", "pkg-app"]);
    expect(JSON.stringify(props)).not.toContain("SecretGymB");
  });
});

describe("DashboardMembershipPage — session handling unchanged", () => {
  it("shows the existing 'couldn't load account data' state without loading any catalog when unauthenticated", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });

    const result = (await callPage()) as unknown as { props: Record<string, unknown> };

    expect(JSON.stringify(result.props)).toContain("load account data");
    expect(h.findMembershipCategories).not.toHaveBeenCalled();
    expect(h.findMembershipPackages).not.toHaveBeenCalled();
    expect(h.findMembershipBillingOptions).not.toHaveBeenCalled();
  });

  it("still passes through subscription/pass state and return-from-checkout banner untouched", async () => {
    const { props } = await callPage({ membership: "pending" });
    const p = props as unknown as Record<string, unknown>;

    expect(p.passCheckoutStatus).toBe("pending");
    expect(p.billingConfigured).toBe(true);
    expect(p.currentPackageId).toBeNull();
  });
});
