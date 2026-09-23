// Route-level authorization tests for
// app/api/staff/community/reports/[id]/resolve/route.ts.
//
// Previously documented as deliberately NOT gym-scoped, pending a product
// decision on the Community visibility/ownership model — that decision is
// now made and implemented (see the Community read-isolation and
// mutation-isolation slices). This file now locks in both the pre-existing
// capability-gated behavior AND the new gym-scoped resolution: a staff
// member may resolve/dismiss a report only when the report's underlying
// content (via commentId -> workoutSessionId -> session owner's gymId)
// belongs to their own gym. Cross-gym-specific coverage lives in the
// sibling staff-community-reports-resolve-gym-scope.test.ts file.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommentReportById: vi.fn(),
  findCommentById: vi.fn(),
  findWorkoutSessionById: vi.fn(),
  deleteComment: vi.fn(),
  saveCommentReport: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const COACH_USER = { id: "coach-1", email: "coach@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const MEMBER_USER = { id: "member-1", email: "member@x.test", role: "member" as const, gymId: null, archivedAt: null };
const OWNER_USER = { id: "owner-1", email: "owner@x.test", role: "member" as const, gymId: null, archivedAt: null };

const PENDING_REPORT = {
  id: "report-1",
  commentId: "comment-1",
  reporterId: "member-2",
  reason: "spam",
  status: "open" as const,
  resolvedByStaffId: null,
  resolvedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const REPORTED_COMMENT = {
  id: "comment-1",
  workoutSessionId: "session-1",
  userId: "commenter-1",
  body: "some comment",
  mentionedUserIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const REPORTED_SESSION = {
  id: "session-1",
  userId: OWNER_USER.id,
  date: "2026-01-01",
  title: "Full Body",
  exercises: [],
  runs: [],
  isPrivate: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function post(id: string, body: unknown, sessionUserId?: string) {
  const mod = await import("@/app/api/staff/community/reports/[id]/resolve/route");
  const req = new NextRequest(`http://localhost/api/staff/community/reports/${id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return mod.POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [COACH_USER, MEMBER_USER, OWNER_USER].find((u) => u.id === id)
  );
  h.findCommentReportById.mockReturnValue(PENDING_REPORT);
  h.findCommentById.mockReturnValue(REPORTED_COMMENT);
  h.findWorkoutSessionById.mockReturnValue(REPORTED_SESSION);
});

describe("POST /api/staff/community/reports/[id]/resolve", () => {
  it("resolves a same-gym report for an authorized staff user", async () => {
    const res = await post("report-1", { action: "resolve" }, COACH_USER.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "Comment removed." });
    expect(h.deleteComment).toHaveBeenCalledWith("comment-1");
    expect(h.saveCommentReport).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved", resolvedByStaffId: COACH_USER.id })
    );
  });

  it("dismisses a same-gym report without deleting the comment", async () => {
    const res = await post("report-1", { action: "dismiss" }, COACH_USER.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "Dismissed." });
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dismissed", resolvedByStaffId: COACH_USER.id })
    );
  });

  it("denies an unauthenticated request and mutates nothing", async () => {
    const res = await post("report-1", { action: "resolve" });

    expect(res.status).toBe(401);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("denies a plain member (no comments.moderate) and mutates nothing", async () => {
    const res = await post("report-1", { action: "resolve" }, MEMBER_USER.id);

    expect(res.status).toBe(403);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing report and mutates nothing", async () => {
    h.findCommentReportById.mockReturnValue(undefined);

    const res = await post("does-not-exist", { action: "resolve" }, COACH_USER.id);

    expect(res.status).toBe(404);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("rejects an invalid action and mutates nothing", async () => {
    const res = await post("report-1", { action: "delete-everything" }, COACH_USER.id);

    expect(res.status).toBe(400);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });
});
