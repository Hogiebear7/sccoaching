// Gym isolation for GET /api/mobile/staff/class-categories. This feeds the
// mobile class-CREATE category picker, so it must return exactly the
// categories app/api/staff/classes/route.ts would actually accept from this
// staff member — never another gym's.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockFindUserById, mockFindClassCategories } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassCategories: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassCategories: mockFindClassCategories,
}));

const STAFF_A = { id: "staff-a", email: "a@x.test", role: "coach" as const, archivedAt: null, gymId: "gym-a" };
const STAFF_PRIMARY = { id: "staff-primary", email: "p@x.test", role: "coach" as const, archivedAt: null, gymId: null };
const MEMBER = { id: "member-1", email: "m@x.test", role: "member" as const, archivedAt: null, gymId: "gym-a" };

const CATEGORIES = [
  { id: "cat-a", slug: "gym-a-only", name: "Gym A Only", gymId: "gym-a" },
  { id: "cat-b", slug: "gym-b-only", name: "Gym B Only", gymId: "gym-b" },
  { id: "cat-legacy", slug: "legacy", name: "Legacy" }, // no gymId — primary gym
];

async function call(actorId: string | null) {
  const { GET } = await import("@/app/api/mobile/staff/class-categories/route");
  const req = new NextRequest("http://localhost/api/mobile/staff/class-categories", {
    headers: actorId ? { Cookie: `session=${signSession({ userId: actorId }, MEMBER_SESSION_LIFETIME_MS)}` } : {},
  });
  return GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUserById.mockImplementation((id: string) => [STAFF_A, STAFF_PRIMARY, MEMBER].find((u) => u.id === id));
  mockFindClassCategories.mockReturnValue(CATEGORIES);
});

describe("GET /api/mobile/staff/class-categories — gym scope", () => {
  it("returns only the acting staff member's own gym's categories", async () => {
    const res = await call(STAFF_A.id);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ slug: "gym-a-only", name: "Gym A Only" }]);
  });

  it("a primary-gym staff member sees primary-gym and legacy (no-gymId) categories, not other gyms'", async () => {
    const res = await call(STAFF_PRIMARY.id);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ slug: "legacy", name: "Legacy" }]);
  });

  it("requires a signed-in user", async () => {
    const res = await call(null);
    expect(res.status).toBe(401);
  });

  it("requires classes.manage — a plain member is rejected", async () => {
    const res = await call(MEMBER.id);
    expect(res.status).toBe(403);
  });
});
