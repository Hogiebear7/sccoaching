// Cross-gym isolation test for app/(staff)/staff/catalog/page.tsx
// (StaffCatalogPage). Same harness convention as
// staff-pages-authorization.test.ts / staff-community-reports-listing-gym-
// scope.test.ts: the page is a plain async Server Component, so calling it
// directly returns an UNrendered React element whose props (passed to
// CatalogView) can be inspected without @testing-library/react.
//
// This slice filters CATEGORIES only. Packages and billing options are
// intentionally passed through unfiltered — see CatalogView's own source:
// it never renders a package/option independently, only ever via
// packages.filter(p => p.categoryId === cat.id) nested inside the
// (now-filtered) categories.map(...) loop. A cross-gym package's
// categoryId can never match a rendered (same-gym) category, so it's
// structurally unreachable in the rendered output even though the raw
// `packages`/`billingOptions` props still contain it. Dedicated
// package/billing-option CRUD and listing isolation remain a deferred,
// separate slice — this file does not claim to cover them.
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
  h.findMembershipPackages.mockReturnValue([]);
  h.findMembershipBillingOptions.mockReturnValue([]);
  h.findClassCategories.mockReturnValue([]);
});

describe("StaffCatalogPage (app/(staff)/staff/catalog/page.tsx)", () => {
  it("passes only same-gym categories through to CatalogView, excluding a cross-gym category", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findMembershipCategories.mockReturnValue([
      category("cat-a", null, "Same Gym"),
      category("cat-b", "gym-b", "Other Gym"),
    ]);

    const element = (await callPage()) as { props: { categories: Array<{ id: string; name: string }> } };
    const { CatalogView } = await import("@/app/(staff)/staff/catalog/CatalogView");

    expect((element as unknown as { type: unknown }).type).toBe(CatalogView);
    const ids = element.props.categories.map((c) => c.id);
    expect(ids).toContain("cat-a");
    expect(ids).not.toContain("cat-b");
  });

  it("treats a category with an unresolvable/missing gym association safely (null = primary gym, matches the caller)", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    // A pre-existing category with no gymId at all (as it would read via the
    // readDb() backfill) — null-coalesces to the same primary gym as
    // GYM_A_STAFF (gymId: null), so it must still be shown.
    const legacyCategory = category("cat-legacy", null, "Legacy");
    delete (legacyCategory as { gymId?: string | null }).gymId;
    h.findMembershipCategories.mockReturnValue([legacyCategory]);

    const element = (await callPage()) as { props: { categories: Array<{ id: string }> } };

    expect(element.props.categories.map((c) => c.id)).toContain("cat-legacy");
  });

  it("does not leak cross-gym category content into any returned row", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findMembershipCategories.mockReturnValue([
      category("cat-a", null, "Same Gym"),
      category("cat-b", "gym-b", "Cross Gym Secret Category"),
    ]);

    const element = (await callPage()) as { props: { categories: unknown[] } };

    expect(JSON.stringify(element.props.categories)).not.toContain("Cross Gym Secret Category");
    expect(JSON.stringify(element.props.categories)).not.toContain("gym-b");
  });

  it("shows an empty category list when no same-gym categories exist", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findMembershipCategories.mockReturnValue([category("cat-b", "gym-b", "Only Other Gym")]);

    const element = (await callPage()) as { props: { categories: unknown[] } };

    expect(element.props.categories).toEqual([]);
  });

  it("passes packages and billing options through unfiltered (deferred to a separate slice)", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findMembershipCategories.mockReturnValue([category("cat-a", null, "Same Gym")]);
    const crossGymPackage = { id: "pkg-cross-gym", categoryId: "cat-b" };
    h.findMembershipPackages.mockReturnValue([crossGymPackage]);

    const element = (await callPage()) as { props: { packages: unknown[] } };

    // Confirms this slice's documented, deliberate limitation — packages are
    // NOT filtered here; CatalogView's own categoryId-nesting is what keeps
    // a cross-gym package like this one out of the rendered page.
    expect(element.props.packages).toEqual([crossGymPackage]);
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
