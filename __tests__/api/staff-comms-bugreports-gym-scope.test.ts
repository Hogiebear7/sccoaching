// PR 1 — direct cross-gym target access: the staff bug-report triage surfaces
// (TRIAL-ONLY feature).
//   /staff/bug-reports page + POST /api/staff/bug-reports/{status,delete}
// Ownership: report -> reporter (userId) -> gym. A cross-gym report is absent
// from the page and gets the same 404 as a missing report from both mutations,
// before any write. (The recovery-alert and unread-badge tests that used to
// share this file live in staff-comms-notifications-gym-scope.test.ts.)
//
// gymId: null is the primary gym (lib/gym-scope.ts). Auth uses the real
// signed-session mechanism; sameGym / can are deliberately not mocked.
import { NextRequest } from "next/server";
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
  findProfileByUserId: vi.fn(),
  findAllBugReports: vi.fn(),
  findBugReportById: vi.fn(),
  saveBugReport: vi.fn(),
  deleteBugReport: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findProfileByUserId: h.findProfileByUserId,
  findAllBugReports: h.findAllBugReports,
  findBugReportById: h.findBugReportById,
  saveBugReport: h.saveBugReport,
  deleteBugReport: h.deleteBugReport,
}));
vi.mock("@/app/(staff)/staff/bug-reports/BugReportsView", () => ({ BugReportsView: () => null }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const EVERYONE = [COACH_A, COACH_B, MEMBER_A, MEMBER_B];

const sessionFor = (u: U) => ({ Cookie: `session=${signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS)}` });
const asStaff = (u: U) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS) } : undefined),
  });
const post = (url: string, body: unknown, u?: U) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(u ? sessionFor(u) : {}) },
    body: JSON.stringify(body),
  });

const report = (id: string, userId: string) => ({
  id,
  userId,
  description: `Report ${id}`,
  screenshots: [],
  status: "open",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});
const REPORTS = [report("bug-a", MEMBER_A.id), report("bug-b", MEMBER_B.id), report("bug-ghost", "member-gone")];

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name of ${id}`, email: `${id}@x.test` }));
  h.findAllBugReports.mockImplementation(() => REPORTS);
  h.findBugReportById.mockImplementation((id: string) => REPORTS.find((r) => r.id === id));
  asStaff(COACH_A);
});

describe("/staff/bug-reports page — gym-scoped list", () => {
  const page = async () => {
    const { default: Page } = await import("@/app/(staff)/staff/bug-reports/page");
    return (Page as () => Promise<{ props: { reports: { id: string; reporterEmail: string }[] } }>)();
  };

  it("lists only the acting gym's reporters' reports, never reading another reporter's profile", async () => {
    const { props } = await page();

    expect(props.reports.map((r) => r.id)).toEqual(["bug-a"]);
    expect(props.reports[0].reporterEmail).toBe(MEMBER_A.email);
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).toEqual([MEMBER_A.id]);
    expect(JSON.stringify(props)).not.toMatch(/member-b|bug-b|bug-ghost/);
  });

  it("gym B staff see only gym B's reports; an unresolvable reporter is excluded (fail closed)", async () => {
    asStaff(COACH_B);

    const { props } = await page();

    expect(props.reports.map((r) => r.id)).toEqual(["bug-b"]);
  });

  it("keeps the redirect for a member", async () => {
    asStaff(MEMBER_A);

    expect(await page().then(() => null, (e: Error) => e.message)).toBe("REDIRECT:/dashboard");
    expect(h.findAllBugReports).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/bug-reports/{status,delete} — gym-scoped mutations", () => {
  const status = async (id: string, u?: U) => {
    const { POST } = await import("@/app/api/staff/bug-reports/status/route");
    return POST(post("/api/staff/bug-reports/status", { id, status: "resolved" }, u));
  };
  const remove = async (id: string, u?: U) => {
    const { POST } = await import("@/app/api/staff/bug-reports/delete/route");
    return POST(post("/api/staff/bug-reports/delete", { id }, u));
  };
  const NOT_FOUND = { success: false, message: "Report not found." };

  it("lets staff resolve and delete a same-gym report (existing behavior)", async () => {
    const resolved = await status("bug-a", COACH_A);
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({ success: true, message: "Marked resolved." });
    expect(h.saveBugReport).toHaveBeenCalledWith(expect.objectContaining({ id: "bug-a", status: "resolved" }));

    const deleted = await remove("bug-a", COACH_A);
    expect(deleted.status).toBe(200);
    expect(h.deleteBugReport).toHaveBeenCalledWith("bug-a");
  });

  it("denies a cross-gym report with the missing-report 404, changing nothing (both directions)", async () => {
    const crossStatus = await status("bug-b", COACH_A);
    const crossDelete = await remove("bug-b", COACH_A);
    const reverse = await status("bug-a", COACH_B);
    const missing = await status("bug-missing", COACH_A);

    for (const res of [crossStatus, crossDelete, reverse]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(missing.status).toBe(404);
    expect(h.saveBugReport).not.toHaveBeenCalled();
    expect(h.deleteBugReport).not.toHaveBeenCalled();
  });

  it("fails closed when the reporter can't be resolved", async () => {
    expect((await status("bug-ghost", COACH_A)).status).toBe(404);
    expect((await remove("bug-ghost", COACH_A)).status).toBe(404);
    expect(h.saveBugReport).not.toHaveBeenCalled();
    expect(h.deleteBugReport).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId", async () => {
    const { POST } = await import("@/app/api/staff/bug-reports/delete/route");

    const res = await POST(post("/api/staff/bug-reports/delete", { id: "bug-b", gymId: null }, COACH_A));

    expect(res.status).toBe(404);
    expect(h.deleteBugReport).not.toHaveBeenCalled();
  });

  it("keeps 401 / 403 unchanged, before any lookup", async () => {
    expect((await status("bug-a")).status).toBe(401);
    expect((await remove("bug-a", MEMBER_A)).status).toBe(403);
    expect(h.findBugReportById).not.toHaveBeenCalled();
    expect(h.saveBugReport).not.toHaveBeenCalled();
    expect(h.deleteBugReport).not.toHaveBeenCalled();
  });
});
