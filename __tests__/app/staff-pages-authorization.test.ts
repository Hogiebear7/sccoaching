// Tests for the four page-level Server Components the tenant-boundary audit
// (docs/tenant-boundary-audit-2026-09.md §6, risk-register row on the
// invite/class/exercise-library finding) names as "untested (not
// unprotected)": app/(staff)/staff/messages/page.tsx,
// app/(staff)/staff/members/page.tsx,
// app/(staff)/staff/members/[userId]/page.tsx, and
// app/(staff)/staff/attendance/page.tsx. Each calls sameGym() directly
// rather than going through an API route's authorizeStaffRequest()/
// verifyRequestSession(), and none had a dedicated test harness before this
// file.
//
// Server Components are plain async functions — calling them directly
// returns an UNrendered React element tree; a child component referenced in
// JSX (e.g. <MembersActivationView rows={...} />) is never actually invoked
// unless something renders it. So this deliberately does not reach for
// @testing-library/react or any DOM. Assertions target either the props
// handed to a child view component (members, attendance — both delegate
// entirely to one child) or a light structural walk of the returned element
// tree (messages, member-detail — both build JSX inline), never a full
// rendered-markup/HTML comparison.
//
// The smallest harness this needed: real signSession()/verifySession() (the
// same convention as every other gym-scope test this session) plus a
// test-only mock of next/headers's cookies() and next/navigation's
// redirect() so requireStaffPage()'s redirect path is observable without
// Next's request runtime. sameGym(), can(), and staffCanViewMemberData's
// CALLERS are exercised for real; only @/lib/db and
// @/lib/member-tier-wall's staffCanViewMemberData itself are mocked, same
// convention as staff-classes-gym-scope.test.ts and
// mobile-staff-gym-scope.test.ts.
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
  findMessageThreadSummaries: vi.fn(),
  findProfileByUserId: vi.fn(),
  findMembersAndStaff: vi.fn(),
  findMembershipPackages: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findMembers: vi.fn(),
  findAttendanceWatchlist: vi.fn(),
  findAllBookings: vi.fn(),
  // Only reached past the tier wall (walled === false) on the member-detail
  // page — everything else on that page while unwalled is a pure function
  // (computePersonalBests, resolveSubscriptionEntitlement) or gated behind
  // a capability the "coach" test fixture deliberately lacks (billing).
  findProgrammeByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findCoachNoteByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findMessagesByMemberId: vi.fn(),
  markMemberMessagesReadByStaff: vi.fn(),
  findBookingsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

// gymId: null is the established primary-gym convention. "coach" is the
// lowest role with staff.access + members.view (see lib/permissions.ts),
// and deliberately lacks members.billing/members.account — keeps the
// member-detail page's billing-gated block (which calls real
// purchasedPassBalance()/findPassLedgerByUserId, pulling in lib/payments.ts's
// own @/lib/db dependencies) out of scope for these authorization-focused
// tests.
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_A_OTHER_STAFF = { id: "staff-a2", email: "staffa2@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
const PLAIN_MEMBER = { id: "plain-member", email: "plain@x.test", role: "member" as const, gymId: null, archivedAt: null };

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}

const NO_SESSION_COOKIE_STORE = { get: () => undefined };

// Recursively collects string/number leaves from an unrendered React element
// tree — used only where a page builds JSX inline with no isolated
// data-consuming child to intercept (messages, member-detail). Deliberately
// not a markup/HTML comparison: it just answers "does this text appear
// anywhere," immune to class-name/wrapper-element changes.
function flattenText(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return acc;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenText(child, acc);
    return acc;
  }
  if (typeof node === "object" && node !== null && "props" in (node as Record<string, unknown>)) {
    flattenText((node as { props?: { children?: unknown } }).props?.children, acc);
  }
  return acc;
}

// Collects every `href` prop anywhere in the tree — used only by the
// messages page, whose per-thread <Link href="/staff/members/{id}#messages">
// is the one stable, semantically-meaningful signal for "which member
// thread is shown," independent of display name/timestamp wording.
function flattenHrefs(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const child of node) flattenHrefs(child, acc);
    return acc;
  }
  const el = node as { props?: { href?: string; children?: unknown } };
  if (typeof el.props?.href === "string") acc.push(el.props.href);
  if (el.props?.children !== undefined) flattenHrefs(el.props.children, acc);
  return acc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StaffMessagesPage (app/(staff)/staff/messages/page.tsx)", () => {
  async function callPage() {
    const { default: StaffMessagesPage } = await import("@/app/(staff)/staff/messages/page");
    return StaffMessagesPage();
  }

  const gymAThread = {
    memberId: GYM_A_MEMBER.id,
    lastMessage: {
      id: "msg-a",
      memberId: GYM_A_MEMBER.id,
      senderId: GYM_A_MEMBER.id,
      senderRole: "member" as const,
      body: "Hi coach",
      readAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    unreadFromMemberCount: 1,
  };
  const gymBThread = {
    memberId: GYM_B_MEMBER.id,
    lastMessage: {
      id: "msg-b",
      memberId: GYM_B_MEMBER.id,
      senderId: GYM_B_MEMBER.id,
      senderRole: "member" as const,
      body: "Hi from gym B",
      readAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    unreadFromMemberCount: 1,
  };

  it("shows a same-gym member's thread and excludes a cross-gym thread", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER, GYM_B_MEMBER));
    h.findMessageThreadSummaries.mockReturnValue([gymAThread, gymBThread]);
    h.findProfileByUserId.mockReturnValue(undefined);
    mockStaffCanViewMemberData.mockReturnValue(true);

    const element = await callPage();
    const hrefs = flattenHrefs(element);

    expect(hrefs).toContain(`/staff/members/${GYM_A_MEMBER.id}#messages`);
    expect(hrefs).not.toContain(`/staff/members/${GYM_B_MEMBER.id}#messages`);
  });

  it("excludes a same-gym thread whose member is behind the tier wall", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER));
    h.findMessageThreadSummaries.mockReturnValue([gymAThread]);
    h.findProfileByUserId.mockReturnValue(undefined);
    mockStaffCanViewMemberData.mockReturnValue(false);

    const element = await callPage();
    const hrefs = flattenHrefs(element);

    expect(hrefs).not.toContain(`/staff/members/${GYM_A_MEMBER.id}#messages`);
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

describe("StaffMembersPage (app/(staff)/staff/members/page.tsx)", () => {
  async function callPage() {
    const { default: StaffMembersPage } = await import("@/app/(staff)/staff/members/page");
    return StaffMembersPage();
  }

  it("passes only same-gym members/staff rows through to MembersActivationView", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER, GYM_B_MEMBER, GYM_A_OTHER_STAFF));
    h.findMembersAndStaff.mockReturnValue([GYM_A_STAFF, GYM_A_OTHER_STAFF, GYM_A_MEMBER, GYM_B_MEMBER]);
    h.findMembershipPackages.mockReturnValue([]);
    h.findProfileByUserId.mockReturnValue(undefined);
    h.findSubscriptionByUserId.mockReturnValue(undefined);

    const element = (await callPage()) as { props: { rows: Array<{ userId: string }> } };
    const { MembersActivationView } = await import("@/app/(staff)/staff/members/MembersActivationView");

    expect((element as unknown as { type: unknown }).type).toBe(MembersActivationView);
    const ids = element.props.rows.map((r) => r.userId);
    expect(ids).toContain(GYM_A_MEMBER.id);
    expect(ids).toContain(GYM_A_OTHER_STAFF.id);
    expect(ids).not.toContain(GYM_B_MEMBER.id);
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

describe("StaffMemberDetailPage (app/(staff)/staff/members/[userId]/page.tsx)", () => {
  async function callPage(userId: string, sessionUserId = GYM_A_STAFF.id) {
    mockCookies.mockResolvedValue(sessionCookieStore(sessionUserId));
    const { default: StaffMemberDetailPage } = await import("@/app/(staff)/staff/members/[userId]/page");
    return StaffMemberDetailPage({ params: Promise.resolve({ userId }) });
  }

  it("reads a cross-gym member as not-found, without fetching any of their data", async () => {
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_B_MEMBER));

    const element = await callPage(GYM_B_MEMBER.id);

    expect(flattenText(element).join(" ")).toContain("Member not found");
    expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
    expect(mockStaffCanViewMemberData).not.toHaveBeenCalled();
  });

  it("reads a missing user id as not-found", async () => {
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));

    const element = await callPage("does-not-exist");

    expect(flattenText(element).join(" ")).toContain("Member not found");
  });

  it("renders the minimal staff-account branch for a same-gym staff row", async () => {
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_OTHER_STAFF));
    h.findProfileByUserId.mockReturnValue(undefined);

    const element = await callPage(GYM_A_OTHER_STAFF.id);
    const text = flattenText(element).join(" ");

    expect(text).toContain(GYM_A_OTHER_STAFF.email);
    expect(text).toContain("Staff account");
    // The member-only data path (subscription, tier wall) never runs for a
    // staff row — this branch returns before any of it.
    expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
    expect(mockStaffCanViewMemberData).not.toHaveBeenCalled();
  });

  it("keeps a same-gym walled member behind the tier wall and skips their deep data", async () => {
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER));
    h.findSubscriptionByUserId.mockReturnValue(undefined);
    h.findProfileByUserId.mockReturnValue(undefined);
    h.findMembershipPackages.mockReturnValue([]);
    mockStaffCanViewMemberData.mockReturnValue(false);

    const element = await callPage(GYM_A_MEMBER.id);
    const text = flattenText(element).join(" ");

    expect(text).toContain("Free / App Subscription tier");
    expect(mockStaffCanViewMemberData).toHaveBeenCalledWith(GYM_A_MEMBER.id);
  });

  it("reaches past the tier wall for a same-gym unwalled member (authorized access)", async () => {
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER));
    h.findSubscriptionByUserId.mockReturnValue(undefined);
    h.findProfileByUserId.mockReturnValue(undefined);
    h.findMembershipPackages.mockReturnValue([]);
    h.findProgrammeByUserId.mockReturnValue(undefined);
    h.findWorkoutSessionsByUserId.mockReturnValue([]);
    h.findCoachNoteByUserId.mockReturnValue(undefined);
    h.findRecoveryLogsByUserId.mockReturnValue([]);
    h.findMessagesByMemberId.mockReturnValue([]);
    h.findBookingsByUserId.mockReturnValue([]);
    mockStaffCanViewMemberData.mockReturnValue(true);

    const element = await callPage(GYM_A_MEMBER.id);
    const text = flattenText(element).join(" ");

    // Past both the gym gate and the tier wall — the walled empty-state
    // copy must NOT appear, confirming authorized access actually reaches
    // real content rather than the walled placeholder.
    expect(text).not.toContain("Free / App Subscription tier");
    expect(text).not.toContain("Member not found");
    // Opening the page is the staff "seen it" signal — mirrors the member
    // side. Only fires on the unwalled path.
    expect(h.markMemberMessagesReadByStaff).toHaveBeenCalledWith(GYM_A_MEMBER.id);
  });

  it("redirects to /dashboard when there is no session", async () => {
    mockCookies.mockResolvedValue(NO_SESSION_COOKIE_STORE);
    const { default: StaffMemberDetailPage } = await import("@/app/(staff)/staff/members/[userId]/page");
    await expect(
      StaffMemberDetailPage({ params: Promise.resolve({ userId: GYM_A_MEMBER.id }) })
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects a plain member (no staff.access) to /dashboard", async () => {
    h.findUserById.mockImplementation(usersById(PLAIN_MEMBER));
    await expect(callPage(GYM_A_MEMBER.id, PLAIN_MEMBER.id)).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("StaffAttendancePage (app/(staff)/staff/attendance/page.tsx)", () => {
  async function callPage() {
    const { default: StaffAttendancePage } = await import("@/app/(staff)/staff/attendance/page");
    return StaffAttendancePage();
  }

  it("scopes the leaderboard and watchlist to the caller's own gym", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER, GYM_B_MEMBER));
    h.findMembers.mockReturnValue([GYM_A_MEMBER, GYM_B_MEMBER]);
    h.findAllBookings.mockReturnValue([
      { id: "b1", classId: "c1", userId: GYM_A_MEMBER.id, attendedAt: "2026-01-01T00:00:00.000Z", noShowProcessedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b2", classId: "c2", userId: GYM_B_MEMBER.id, attendedAt: "2026-01-01T00:00:00.000Z", noShowProcessedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    h.findAttendanceWatchlist.mockReturnValue([
      { id: "w1", userId: GYM_A_MEMBER.id, monthKey: "2026-01", missCount: 2, addedAt: "2026-01-01T00:00:00.000Z" },
      { id: "w2", userId: GYM_B_MEMBER.id, monthKey: "2026-01", missCount: 2, addedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    h.findProfileByUserId.mockReturnValue(undefined);
    mockStaffCanViewMemberData.mockReturnValue(true);

    const element = (await callPage()) as {
      props: { leaderboard: Array<{ userId: string }>; watchlist: Array<{ userId: string }> };
    };
    const { AttendanceView } = await import("@/app/(staff)/staff/attendance/AttendanceView");

    expect((element as unknown as { type: unknown }).type).toBe(AttendanceView);
    expect(element.props.leaderboard.map((r) => r.userId)).toEqual([GYM_A_MEMBER.id]);
    expect(element.props.watchlist.map((w) => w.userId)).toEqual([GYM_A_MEMBER.id]);
  });

  it("excludes a same-gym member behind the tier wall from the leaderboard", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER));
    h.findMembers.mockReturnValue([GYM_A_MEMBER]);
    h.findAllBookings.mockReturnValue([]);
    h.findAttendanceWatchlist.mockReturnValue([]);
    h.findProfileByUserId.mockReturnValue(undefined);
    mockStaffCanViewMemberData.mockReturnValue(false);

    const element = (await callPage()) as { props: { leaderboard: Array<{ userId: string }> } };

    expect(element.props.leaderboard).toEqual([]);
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
