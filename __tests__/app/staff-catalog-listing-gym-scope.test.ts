// Cross-gym isolation test for app/(staff)/staff/catalog/page.tsx
// (StaffCatalogPage). Same harness convention as
// staff-pages-authorization.test.ts / staff-community-reports-listing-gym-
// scope.test.ts: the page is a plain async Server Component, so calling it
// directly returns an UNrendered React element whose props (passed to
// CatalogView) can be inspected without @testing-library/react.
//
// Categories, packages, and billing options are ALL filtered here now
// (packages/billing-options isolation landed in this same slice). The
// filter order matters: packages are filtered first (same-gym via their
// category, OR the global deliveryChannel === "app_only" exception), and
// the visible category set is the union of "the staff member's own gym"
// and "any category that owns a surviving package" — this is how an
// app-only package's category can render for every gym's staff without
// ever reintroducing that category's ordinary sibling packages, since
// those were already excluded from the packages filter before the
// category union is computed. See app/(staff)/staff/catalog/page.tsx's own
// comment for the full reasoning.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies, mockRedirect } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMembershipCategories: vi.fn(),
  findMembershipPackages: vi.fn(),
  findMembershipBillingOptions: vi.fn(),
  findClassCategories: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const PLAIN_MEMBER = { id: "plain-member", email: "plain@x.test", role: "member" as const, gymId: null, archivedAt: null };

function category(id: string, gymId: string | null, name: string) {
  return {
    id,
    gymId,
    name,
    slug: id,
    description: null,
    sortOrder: 0,
    visible: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function pkg(id: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    categoryId,
    name: `Package ${id}`,
    slug: id,
    shortDescription: null,
    fullDescription: null,
    packageType: "membership",
    sessionAllowanceType: "unlimited",
    sessionAllowanceCount: null,
    eligibleClassTypes: [],
    visible: true,
    sortOrder: 0,
    stripeProductId: null,
    imageUrl: null,
    imageAlt: null,
    deliveryChannel: "in_person",
    billingChannel: "stripe_web",
    accessType: "membership",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function billingOption(id: string, packageId: string) {
  return {
    id,
    packageId,
    name: "Monthly",
    billingType: "recurring",
    intervalUnit: "month",
    intervalCount: 1,
    amountCents: 5000,
    currency: "eur",
    visible: true,
    sortOrder: 0,
    stripePriceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}

const NO_SESSION_COOKIE_STORE = { get: () => undefined };

async function callPage() {
  const { default: StaffCatalogPage } = await import("@/app/(staff)/staff/catalog/page");
  return StaffCatalogPage();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findClassCategories.mockReturnValue([]);
  mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
  h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
});

describe("StaffCatalogPage (app/(staff)/staff/catalog/page.tsx)", () => {
  it("passes only same-gym categories through to CatalogView, excluding a cross-gym category", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-a", null, "Same Gym"), category("cat-b", "gym-b", "Other Gym")]);
    h.findMembershipPackages.mockReturnValue([]);
    h.findMembershipBillingOptions.mockReturnValue([]);

    const element = (await callPage()) as { props: { categories: Array<{ id: string }> } };
    const { CatalogView } = await import("@/app/(staff)/staff/catalog/CatalogView");

    expect((element as unknown as { type: unknown }).type).toBe(CatalogView);
    const ids = element.props.categories.map((c) => c.id);
    expect(ids).toContain("cat-a");
    expect(ids).not.toContain("cat-b");
  });

  it("shows a same-gym ordinary package and excludes a cross-gym ordinary package", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-a", null, "Same Gym"), category("cat-b", "gym-b", "Other Gym")]);
    h.findMembershipPackages.mockReturnValue([pkg("pkg-a", "cat-a"), pkg("pkg-b", "cat-b")]);
    h.findMembershipBillingOptions.mockReturnValue([]);

    const element = (await callPage()) as { props: { packages: Array<{ id: string }> } };

    const ids = element.props.packages.map((p) => p.id);
    expect(ids).toContain("pkg-a");
    expect(ids).not.toContain("pkg-b");
  });

  it("shows the global app-only package and its category even when owned by another gym", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
    h.findMembershipPackages.mockReturnValue([pkg("app-pkg", "cat-b", { deliveryChannel: "app_only", billingChannel: "google_play" })]);
    h.findMembershipBillingOptions.mockReturnValue([billingOption("opt-1", "app-pkg")]);

    const element = (await callPage()) as {
      props: { categories: Array<{ id: string }>; packages: Array<{ id: string }>; billingOptions: Array<{ id: string }> };
    };

    expect(element.props.categories.map((c) => c.id)).toContain("cat-b");
    expect(element.props.packages.map((p) => p.id)).toContain("app-pkg");
    expect(element.props.billingOptions.map((o) => o.id)).toContain("opt-1");
  });

  it("does not reintroduce an ordinary cross-gym sibling package just because its category also holds an app-only package", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
    h.findMembershipPackages.mockReturnValue([
      pkg("app-pkg", "cat-b", { deliveryChannel: "app_only", billingChannel: "google_play" }),
      pkg("ordinary-sibling", "cat-b"), // same category, but ordinary — must NOT leak
    ]);
    h.findMembershipBillingOptions.mockReturnValue([]);

    const element = (await callPage()) as { props: { packages: Array<{ id: string }> } };

    const ids = element.props.packages.map((p) => p.id);
    expect(ids).toContain("app-pkg");
    expect(ids).not.toContain("ordinary-sibling");
  });

  it("excludes an ordinary package whose category no longer exists (missing-parent fails closed)", async () => {
    h.findMembershipCategories.mockReturnValue([]);
    h.findMembershipPackages.mockReturnValue([pkg("orphan-pkg", "does-not-exist")]);
    h.findMembershipBillingOptions.mockReturnValue([]);

    const element = (await callPage()) as { props: { packages: unknown[] } };

    expect(element.props.packages).toEqual([]);
  });

  it("excludes billing options whose package is not visible to this staff member", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
    h.findMembershipPackages.mockReturnValue([pkg("pkg-b", "cat-b")]);
    h.findMembershipBillingOptions.mockReturnValue([billingOption("opt-cross-gym", "pkg-b")]);

    const element = (await callPage()) as { props: { billingOptions: unknown[] } };

    expect(element.props.billingOptions).toEqual([]);
  });

  it("does not leak cross-gym ordinary category/package content into any returned prop", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Cross Gym Secret Category")]);
    h.findMembershipPackages.mockReturnValue([pkg("pkg-b", "cat-b", { name: "Cross Gym Secret Package" })]);
    h.findMembershipBillingOptions.mockReturnValue([billingOption("opt-b", "pkg-b")]);

    const element = (await callPage()) as { props: { categories: unknown[]; packages: unknown[]; billingOptions: unknown[] } };

    const serialized = JSON.stringify(element.props);
    expect(serialized).not.toContain("Cross Gym Secret Category");
    expect(serialized).not.toContain("Cross Gym Secret Package");
    expect(serialized).not.toContain("gym-b");
  });

  it("shows an empty category/package list when no same-gym or app-only records exist", async () => {
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Only Other Gym")]);
    h.findMembershipPackages.mockReturnValue([pkg("pkg-b", "cat-b")]);
    h.findMembershipBillingOptions.mockReturnValue([]);

    const element = (await callPage()) as { props: { categories: unknown[]; packages: unknown[] } };

    expect(element.props.categories).toEqual([]);
    expect(element.props.packages).toEqual([]);
  });

  describe("global-exception regression: keyed strictly on deliveryChannel === 'app_only'", () => {
    it("does NOT treat a manual billingChannel package as global", async () => {
      h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
      h.findMembershipPackages.mockReturnValue([pkg("pkg-manual", "cat-b", { billingChannel: "manual", deliveryChannel: "in_person" })]);
      h.findMembershipBillingOptions.mockReturnValue([]);

      const element = (await callPage()) as { props: { packages: unknown[] } };
      expect(element.props.packages).toEqual([]);
    });

    it("does NOT treat the app-subscription-tier-2 slug alone as global if deliveryChannel is ordinary", async () => {
      h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
      h.findMembershipPackages.mockReturnValue([pkg("pkg-slug", "cat-b", { slug: "app-subscription-tier-2", deliveryChannel: "in_person" })]);
      h.findMembershipBillingOptions.mockReturnValue([]);

      const element = (await callPage()) as { props: { packages: unknown[] } };
      expect(element.props.packages).toEqual([]);
    });

    it("does NOT treat gymId === null on the category as a global marker for an ordinary package under a DIFFERENT staff member's gym", async () => {
      // Staff here is GYM_A_STAFF (gymId: null). A package under a
      // gym-b category is still excluded even though app-only packages
      // (which ARE global) happen to also often sit under a null-gym
      // category in practice — the exception must not accidentally read
      // as "null gym is global."
      h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
      h.findMembershipPackages.mockReturnValue([pkg("pkg-ordinary", "cat-b", { deliveryChannel: "in_person" })]);
      h.findMembershipBillingOptions.mockReturnValue([]);

      const element = (await callPage()) as { props: { packages: unknown[] } };
      expect(element.props.packages).toEqual([]);
    });

    it("DOES treat deliveryChannel === 'app_only' as global regardless of billingChannel or slug", async () => {
      h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Other Gym")]);
      h.findMembershipPackages.mockReturnValue([
        pkg("pkg-app-only", "cat-b", { deliveryChannel: "app_only", billingChannel: "manual", slug: "some-other-slug" }),
      ]);
      h.findMembershipBillingOptions.mockReturnValue([]);

      const element = (await callPage()) as { props: { packages: unknown[] } };
      expect(element.props.packages.map((p) => (p as { id: string }).id)).toContain("pkg-app-only");
    });
  });

  it("redirects to /dashboard when there is no session", async () => {
    mockCookies.mockResolvedValue(NO_SESSION_COOKIE_STORE);
    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects a plain member (no staff.access) to /dashboard", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(PLAIN_MEMBER.id));
    h.findUserById.mockImplementation(usersById(PLAIN_MEMBER));
    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
