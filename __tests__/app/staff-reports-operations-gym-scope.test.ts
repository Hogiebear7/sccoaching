// Entry-point coverage for the gym-scoped reporting/operations builders (the
// builders themselves are covered in __tests__/lib/reports-operations-gym-scope):
//   /staff/reports        (app/(staff)/staff/reports/page.tsx)
//   /staff/operations     (app/(staff)/staff/operations/page.tsx)
//   GET /api/mobile/staff/business (membership + class sections)
// Pages are plain async Server Components, so calling one returns an UNrendered
// element whose props can be inspected. The acting staff member comes from the
// real requireStaffPage() / signed-session flow — never a client value. The
// mobile Business revenue section is deliberately NOT asserted as scoped: gym
// ownership of revenue is a pending Finance decision (see the audit report).
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
  findAllSubscriptions: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findClassCategories: vi.fn(),
  findClasses: vi.fn(),
  findDeletedCategoryLabels: vi.fn(),
  findMembers: vi.fn(),
  findMessagesByMemberId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
  countClassesByCategorySlug: vi.fn(),
  countPackagesByEligibleClassType: vi.fn(),
  findRecentJobRuns: vi.fn(),
  getReadinessAlertSettings: vi.fn(),
  getTransactionalEmailSettings: vi.fn(),
  getFinanceSettings: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => null }));
vi.mock("@/lib/billing", () => ({ isPendingCheckoutStale: () => false }));
vi.mock("@/lib/finance", () => ({ buildFinanceLedgerLines: () => [] }));
vi.mock("@/app/(staff)/staff/reports/ReportsView", () => ({ ReportsView: () => null }));
vi.mock("@/app/(staff)/staff/operations/OperationsView", () => ({ OperationsView: () => null }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null; createdAt: string };
const user = (id: string, role: string, gymId: string | null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt: null,
  createdAt: new Date().toISOString(), // "this month" for the business snapshot
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const ADMIN_A = user("admin-a", "admin", null);
const ADMIN_B = user("admin-b", "admin", "gym-b");
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const EVERYONE = [ADMIN_A, ADMIN_B, COACH_A, COACH_B, MEMBER_A, MEMBER_B];

const thisMonth = new Date().toISOString().slice(0, 10);
const cls = (id: string, coachUserId: string) => ({
  id,
  title: id,
  category: "strength",
  date: thisMonth,
  startTime: "23:59",
  capacity: 10,
  coachUserId,
});
const CLASSES = [cls("class-a", COACH_A.id), cls("class-b", COACH_B.id)];
const sub = (userId: string) => ({ userId, status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentPeriodEnd: "2099-01-01T00:00:00.000Z" });

const asUser = (u: U) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS) } : undefined),
  });

async function reportsPage() {
  const { default: Page } = await import("@/app/(staff)/staff/reports/page");
  return (Page as () => Promise<{ props: { members: { userId: string }[]; subscriptions: { userId: string }[]; classes: { classId: string }[] } }>)();
}
async function operationsPage() {
  const { default: Page } = await import("@/app/(staff)/staff/operations/page");
  return (Page as () => Promise<{ props: { members: { userId: string }[]; classes: { classId: string }[] } }>)();
}
async function business(sessionUserId?: string) {
  const { GET } = await import("@/app/api/mobile/staff/business/route");
  return GET(
    new NextRequest("http://localhost/api/mobile/staff/business", {
      headers: sessionUserId ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` } : {},
    })
  );
}
const redirectedTo = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findMembers.mockImplementation(() => [MEMBER_A, MEMBER_B]);
  h.findAllSubscriptions.mockImplementation(() => [sub(MEMBER_A.id), sub(MEMBER_B.id)]);
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name of ${id}` }));
  h.findClasses.mockImplementation(() => CLASSES);
  h.findClassCategories.mockReturnValue([]);
  h.findDeletedCategoryLabels.mockReturnValue({});
  h.findBookingsByClassId.mockReturnValue([]);
  h.findWaitlistEntriesByClassId.mockReturnValue([]);
  h.findSubscriptionByUserId.mockImplementation((id: string) => [sub(MEMBER_A.id), sub(MEMBER_B.id)].find((s) => s.userId === id));
  h.findRecoveryLogsByUserId.mockReturnValue([]);
  h.findMessagesByMemberId.mockReturnValue([]);
  h.countClassesByCategorySlug.mockReturnValue(0);
  h.countPackagesByEligibleClassType.mockReturnValue(0);
  h.findRecentJobRuns.mockReturnValue([]);
  h.getReadinessAlertSettings.mockReturnValue({});
  h.getTransactionalEmailSettings.mockReturnValue({});
  h.getFinanceSettings.mockReturnValue({ taxRatePercent: null });
  asUser(ADMIN_A);
});

describe("/staff/reports — gym-scoped props", () => {
  it("a gym A admin gets only gym A members, subscriptions and classes", async () => {
    const { props } = await reportsPage();

    expect(props.members.map((m) => m.userId)).toEqual(["member-a"]);
    expect(props.subscriptions.map((s) => s.userId)).toEqual(["member-a"]);
    expect(props.classes.map((c) => c.classId)).toEqual(["class-a"]);
    expect(JSON.stringify(props)).not.toMatch(/member-b|class-b|gym-b/);
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).not.toContain("member-b");
  });

  it("a gym B admin gets only gym B data", async () => {
    asUser(ADMIN_B);

    const { props } = await reportsPage();

    expect(props.members.map((m) => m.userId)).toEqual(["member-b"]);
    expect(props.classes.map((c) => c.classId)).toEqual(["class-b"]);
  });

  it("keeps redirects unchanged and loads nothing for a member or anonymous visitor", async () => {
    asUser(MEMBER_A);
    expect(await redirectedTo(reportsPage())).toBe("REDIRECT:/dashboard");

    mockCookies.mockResolvedValue({ get: () => undefined });
    expect(await redirectedTo(reportsPage())).toBe("REDIRECT:/dashboard");

    expect(h.findMembers).not.toHaveBeenCalled();
    expect(h.findClasses).not.toHaveBeenCalled();
  });

  it("keeps the reports.view capability: a coach is redirected to /staff/classes", async () => {
    asUser(COACH_A);

    expect(await redirectedTo(reportsPage())).toBe("REDIRECT:/staff/classes");
    expect(h.findMembers).not.toHaveBeenCalled();
  });
});

describe("/staff/operations — gym-scoped props", () => {
  it("a gym A admin gets only gym A member summaries and class pressure", async () => {
    const { props } = await operationsPage();

    expect(props.members.map((m) => m.userId)).toEqual(["member-a"]);
    expect(props.classes.map((c) => c.classId)).toEqual(["class-a"]);
    expect(JSON.stringify(props.members)).not.toMatch(/member-b/);
    for (const fn of [h.findSubscriptionByUserId, h.findRecoveryLogsByUserId, h.findMessagesByMemberId, h.findProfileByUserId]) {
      expect(fn.mock.calls.map((c) => c[0])).not.toContain("member-b");
    }
    expect(h.findBookingsByClassId.mock.calls.map((c) => c[0])).toEqual(["class-a"]);
  });

  it("a gym B admin gets only gym B data", async () => {
    asUser(ADMIN_B);

    const { props } = await operationsPage();

    expect(props.members.map((m) => m.userId)).toEqual(["member-b"]);
    expect(props.classes.map((c) => c.classId)).toEqual(["class-b"]);
  });

  it("keeps redirects unchanged for a member / anonymous visitor, loading nothing", async () => {
    asUser(MEMBER_A);
    expect(await redirectedTo(operationsPage())).toBe("REDIRECT:/dashboard");

    mockCookies.mockResolvedValue({ get: () => undefined });
    expect(await redirectedTo(operationsPage())).toBe("REDIRECT:/dashboard");

    expect(h.findMembers).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/business — gym-scoped membership and class sections", () => {
  it("counts only the acting gym's members and classes", async () => {
    const body = await (await business(ADMIN_A.id)).json();

    expect(body.success).toBe(true);
    expect(body.data.membership).toEqual({ activeMembers: 1, newSignupsThisMonth: 1 });
    expect(body.data.classes.classesThisMonth).toBe(1);
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).not.toContain("member-b");
    expect(h.findBookingsByClassId.mock.calls.map((c) => c[0])).not.toContain("class-b");
  });

  it("gym B counts only gym B", async () => {
    const body = await (await business(ADMIN_B.id)).json();

    expect(body.data.membership).toEqual({ activeMembers: 1, newSignupsThisMonth: 1 });
    expect(body.data.classes.classesThisMonth).toBe(1);
  });

  it("keeps 401 / 403 unchanged", async () => {
    const anon = await business();
    expect(anon.status).toBe(401);
    expect((await anon.json()).message).toBe("Not signed in.");

    const member = await business(MEMBER_A.id);
    expect(member.status).toBe(403);
    expect((await member.json()).message).toBe("Staff access required.");
    expect(h.findMembers).not.toHaveBeenCalled();
  });
});
