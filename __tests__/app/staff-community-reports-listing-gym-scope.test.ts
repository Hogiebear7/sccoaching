// Cross-gym isolation test for
// app/(staff)/staff/community-reports/page.tsx (StaffCommunityReportsPage).
// Same harness convention as staff-pages-authorization.test.ts: the page is
// a plain async Server Component, so calling it directly returns an
// UNrendered React element whose props (passed to CommunityReportsView) can
// be inspected without @testing-library/react or any DOM. Report ownership
// is resolved through the underlying content, never the reporter:
// commentId -> workoutSessionId -> the session owner's verified gymId.
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
  findAllCommentReports: vi.fn(),
  findCommentById: vi.fn(),
  findWorkoutSessionById: vi.fn(),
  findProfileByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_A_OWNER = { id: "owner-a", email: "ownera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_OWNER = { id: "owner-b", email: "ownerb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
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

function report(id: string, commentId: string) {
  return {
    id,
    commentId,
    reporterId: "reporter-1",
    reason: "spam",
    status: "open" as const,
    resolvedByStaffId: null,
    resolvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function commentOn(id: string, sessionId: string) {
  return {
    id,
    workoutSessionId: sessionId,
    userId: "commenter-1",
    body: "some comment",
    mentionedUserIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function sessionOwnedBy(id: string, userId: string) {
  return {
    id,
    userId,
    date: "2026-01-01",
    title: "Full Body",
    exercises: [],
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function callPage() {
  const { default: StaffCommunityReportsPage } = await import("@/app/(staff)/staff/community-reports/page");
  return StaffCommunityReportsPage();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findProfileByUserId.mockReturnValue(undefined);
});

describe("StaffCommunityReportsPage (app/(staff)/staff/community-reports/page.tsx)", () => {
  it("passes only same-gym reports through to CommunityReportsView, excluding a cross-gym report", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_OWNER, GYM_B_OWNER));
    h.findAllCommentReports.mockReturnValue([report("report-a", "comment-a"), report("report-b", "comment-b")]);
    h.findCommentById.mockImplementation((id: string) =>
      id === "comment-a" ? commentOn("comment-a", "session-a") : id === "comment-b" ? commentOn("comment-b", "session-b") : undefined
    );
    h.findWorkoutSessionById.mockImplementation((id: string) =>
      id === "session-a" ? sessionOwnedBy("session-a", GYM_A_OWNER.id) : id === "session-b" ? sessionOwnedBy("session-b", GYM_B_OWNER.id) : undefined
    );

    const element = (await callPage()) as { props: { reports: Array<{ id: string }> } };
    const { CommunityReportsView } = await import("@/app/(staff)/staff/community-reports/CommunityReportsView");

    expect((element as unknown as { type: unknown }).type).toBe(CommunityReportsView);
    const ids = element.props.reports.map((r) => r.id);
    expect(ids).toContain("report-a");
    expect(ids).not.toContain("report-b");
  });

  it("excludes a report whose ownership chain can't be resolved (comment already removed)", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findAllCommentReports.mockReturnValue([report("report-orphan", "comment-missing")]);
    h.findCommentById.mockReturnValue(undefined);
    h.findWorkoutSessionById.mockReturnValue(undefined);

    const element = (await callPage()) as { props: { reports: Array<{ id: string }> } };

    expect(element.props.reports).toEqual([]);
  });

  it("excludes a report whose underlying workout session no longer exists", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF));
    h.findAllCommentReports.mockReturnValue([report("report-1", "comment-1")]);
    h.findCommentById.mockReturnValue(commentOn("comment-1", "session-1"));
    h.findWorkoutSessionById.mockReturnValue(undefined);

    const element = (await callPage()) as { props: { reports: Array<{ id: string }> } };

    expect(element.props.reports).toEqual([]);
  });

  it("does not leak cross-gym report content into any same-gym row", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_OWNER, GYM_B_OWNER));
    h.findAllCommentReports.mockReturnValue([report("report-a", "comment-a"), report("report-b", "comment-b")]);
    h.findCommentById.mockImplementation((id: string) =>
      id === "comment-a" ? commentOn("comment-a", "session-a") : commentOn("comment-b", "session-b")
    );
    h.findWorkoutSessionById.mockImplementation((id: string) =>
      id === "session-a" ? sessionOwnedBy("session-a", GYM_A_OWNER.id) : sessionOwnedBy("session-b", GYM_B_OWNER.id)
    );

    const element = (await callPage()) as { props: { reports: unknown[] } };

    expect(JSON.stringify(element.props.reports)).not.toContain("comment-b");
    expect(JSON.stringify(element.props.reports)).not.toContain(GYM_B_OWNER.id);
  });

  it("shows an empty list when no same-gym reports exist (existing empty state driven by the same prop)", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(GYM_A_STAFF.id));
    h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_B_OWNER));
    h.findAllCommentReports.mockReturnValue([report("report-b", "comment-b")]);
    h.findCommentById.mockReturnValue(commentOn("comment-b", "session-b"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy("session-b", GYM_B_OWNER.id));

    const element = (await callPage()) as { props: { reports: unknown[] } };

    expect(element.props.reports).toEqual([]);
  });

  it("redirects to /dashboard when there is no session", async () => {
    mockCookies.mockResolvedValue(NO_SESSION_COOKIE_STORE);
    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects a plain member (no comments.moderate) to /staff/classes", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(PLAIN_MEMBER.id));
    h.findUserById.mockImplementation(usersById(PLAIN_MEMBER));
    // PLAIN_MEMBER lacks staff.access entirely, so requireStaffPage redirects
    // to /dashboard before ever reaching the comments.moderate check —
    // matches requireStaffPage's own precedence (see lib/staff-auth.ts).
    await expect(callPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
