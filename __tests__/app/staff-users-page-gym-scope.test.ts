// Gym isolation for app/(staff)/staff/staff-users/page.tsx (StaffUsersPage).
// Same harness as staff-pages-authorization.test.ts / the other listing tests:
// the page is a plain async Server Component, so calling it returns an
// UNrendered element whose props (handed to StaffUsersView) can be inspected
// without a DOM. The listing must contain only staff in the acting manager's
// own gym — the actor comes from the real requireStaffPage() session flow, and
// no client-supplied gym value can broaden it. Note gymId: null is the
// repo-wide "primary gym" convention (lib/gym-scope.ts), so a null-gym actor
// sees the primary gym's staff — not an empty page and not other gyms'.
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
  findStaffUsers: vi.fn(),
  findProfileByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

type U = { id: string; email: string; role: "member" | "coach" | "admin" | "admin_manager"; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: U["role"], gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const MGR_A = user("mgr-a", "admin_manager", null);
const ADMIN_A = user("admin-a", "admin", null);
const COACH_A = user("coach-a", "coach", null);
const ARCHIVED_A = user("old-a", "coach", null, "2026-01-01T00:00:00.000Z");
const MGR_B = user("mgr-b", "admin_manager", "gym-b");
const COACH_B = user("coach-b", "coach", "gym-b");
const PLAIN_MEMBER = user("member-a", "member", null);

const STAFF = [MGR_A, ADMIN_A, COACH_A, ARCHIVED_A, MGR_B, COACH_B];
const EVERYONE = [...STAFF, PLAIN_MEMBER];
const NAMES: Record<string, string> = {
  "mgr-a": "Alice Manager",
  "coach-a": "Carl Coach",
  "mgr-b": "Bea SecretManager",
  "coach-b": "Ben SecretCoach",
};

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}
const NO_SESSION = { get: () => undefined };

type Row = { id: string; email: string; fullName: string | null; role: string; archivedAt: string | null };
type Props = { rows: Row[]; currentUserId: string };

async function callPage(...args: unknown[]) {
  const { default: StaffUsersPage } = await import("@/app/(staff)/staff/staff-users/page");
  return (StaffUsersPage as (...a: unknown[]) => Promise<{ props: Props; type: unknown }>)(...args);
}

const asManager = (u: U = MGR_A) => mockCookies.mockResolvedValue(sessionCookieStore(u.id));

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findStaffUsers.mockImplementation(() => STAFF);
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  asManager();
});

describe("StaffUsersPage — same-gym listing", () => {
  it("lists only the acting manager's own gym, with the existing row shape and email sort", async () => {
    const element = await callPage();
    const { StaffUsersView } = await import("@/app/(staff)/staff/staff-users/StaffUsersView");

    expect(element.type).toBe(StaffUsersView);
    expect(element.props.rows).toEqual([
      { id: "admin-a", email: "admin-a@x.test", fullName: null, role: "admin", archivedAt: null },
      { id: "coach-a", email: "coach-a@x.test", fullName: "Carl Coach", role: "coach", archivedAt: null },
      { id: "mgr-a", email: "mgr-a@x.test", fullName: "Alice Manager", role: "admin_manager", archivedAt: null },
      { id: "old-a", email: "old-a@x.test", fullName: null, role: "coach", archivedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("excludes every other gym's staff", async () => {
    const ids = (await callPage()).props.rows.map((r) => r.id);

    expect(ids).not.toContain(MGR_B.id);
    expect(ids).not.toContain(COACH_B.id);
  });

  it("handles the acting user's own account exactly as before (listed, and passed as currentUserId)", async () => {
    const element = await callPage();

    expect(element.props.currentUserId).toBe(MGR_A.id);
    expect(element.props.rows.find((r) => r.id === MGR_A.id)).toEqual({
      id: "mgr-a",
      email: "mgr-a@x.test",
      fullName: "Alice Manager",
      role: "admin_manager",
      archivedAt: null,
    });
  });

  it("still lists archived same-gym staff (existing behavior)", async () => {
    const row = (await callPage()).props.rows.find((r) => r.id === ARCHIVED_A.id);

    expect(row?.archivedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("shows a gym-B manager only gym-B staff", async () => {
    asManager(MGR_B);

    const element = await callPage();

    expect(element.props.rows.map((r) => r.id)).toEqual(["coach-b", "mgr-b"]);
    expect(element.props.currentUserId).toBe(MGR_B.id);
  });

  it("shows a lone manager just themself (no peers, still no other gym)", async () => {
    h.findStaffUsers.mockImplementation(() => [MGR_A, MGR_B, COACH_B]);

    const element = await callPage();

    expect(element.props.rows.map((r) => r.id)).toEqual(["mgr-a"]);
  });

  it("puts no cross-gym email or profile data into the page data, and never even reads a cross-gym profile", async () => {
    const element = await callPage();
    const serialized = JSON.stringify(element.props);

    for (const leaked of ["mgr-b@x.test", "coach-b@x.test", "SecretManager", "SecretCoach", "gym-b"]) {
      expect(serialized).not.toContain(leaked);
    }
    const profileLookups = h.findProfileByUserId.mock.calls.map((c) => c[0]);
    expect(profileLookups).not.toContain(MGR_B.id);
    expect(profileLookups).not.toContain(COACH_B.id);
  });

  it("cannot be broadened by client-supplied gym identifiers (query, params, or extra props)", async () => {
    const baseline = (await callPage()).props.rows.map((r) => r.id);
    const withClientInput = await callPage({
      searchParams: Promise.resolve({ gymId: "gym-b", gym: "gym-b", all: "1" }),
      params: Promise.resolve({ gymId: "gym-b" }),
      gymId: "gym-b",
    });

    expect(withClientInput.props.rows.map((r) => r.id)).toEqual(baseline);
    expect(JSON.stringify(withClientInput.props)).not.toContain("gym-b");
  });

  it("does not change the shared findStaffUsers() accessor's call shape (called with no gym argument)", async () => {
    await callPage();

    expect(h.findStaffUsers).toHaveBeenCalledWith();
  });
});

describe("StaffUsersPage — authorization is unchanged", () => {
  const expectNothingRead = () => {
    expect(h.findStaffUsers).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
  };

  it("redirects an unauthenticated request to /dashboard, reading nothing", async () => {
    mockCookies.mockResolvedValue(NO_SESSION);

    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
    expectNothingRead();
  });

  it("fails closed when the session's user no longer exists (actor cannot be resolved)", async () => {
    h.findUserById.mockImplementation(() => undefined);

    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
    expectNothingRead();
  });

  it("redirects a plain member (no staff.access) to /dashboard", async () => {
    asManager(PLAIN_MEMBER);

    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
    expectNothingRead();
  });

  it("redirects staff without staffUsers.manage (plain admin, coach) to /staff/classes", async () => {
    asManager(ADMIN_A);
    await expect(callPage()).rejects.toThrow("REDIRECT:/staff/classes");
    asManager(COACH_A);
    await expect(callPage()).rejects.toThrow("REDIRECT:/staff/classes");
    expectNothingRead();
  });

  it("redirects an archived manager to /dashboard", async () => {
    const archivedManager = user("mgr-archived", "admin_manager", null, "2026-01-01T00:00:00.000Z");
    h.findUserById.mockImplementation((id: string) => [...EVERYONE, archivedManager].find((u) => u.id === id));
    asManager(archivedManager);

    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
    expectNothingRead();
  });
});
