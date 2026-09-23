// Route-level authorization tests for
// app/api/staff/community/reports/[id]/resolve/route.ts.
//
// Deliberately NOT a gym-scope test file like the sibling
// staff-invites-gym-scope.test.ts / staff-classes-gym-scope.test.ts: this
// route is not given a cross-gym denial check in this slice. Community
// content (WorkoutSessionRecord/CommentRecord) has no gymId of its own and
// no product decision yet on whether moderation should scope by the
// reporter's gym, the commenter's gym, or stay platform-wide (the feed
// itself is platform-wide by explicit design — see lib/db.ts's comment on
// FollowRecord). Adding a sameGym() check here would mean choosing one of
// those readings and baking it in as the de facto community-visibility
// model — exactly what docs/white-label-platform-master-plan.md says not
// to do outside its own approved slice. See
// docs/tenant-boundary-audit-2026-09.md §6 and the tenant-boundary decision
// record this slice was scoped from. These tests instead lock in the
// existing (unchanged) capability-gated behavior.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommentReportById: vi.fn(),
  deleteComment: vi.fn(),
  saveCommentReport: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const COACH_USER = { id: "coach-1", email: "coach@x.test", role: "coach" as const, archivedAt: null };
const MEMBER_USER = { id: "member-1", email: "member@x.test", role: "member" as const, archivedAt: null };

const PENDING_REPORT = {
  id: "report-1",
  commentId: "comment-1",
  reporterId: "member-2",
  reason: "spam",
  status: "pending" as const,
  resolvedByStaffId: null,
  resolvedAt: null,
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
    id === COACH_USER.id ? COACH_USER : id === MEMBER_USER.id ? MEMBER_USER : undefined
  );
  h.findCommentReportById.mockReturnValue(PENDING_REPORT);
});

describe("POST /api/staff/community/reports/[id]/resolve (baseline — NOT gym-scoped; see file header)", () => {
  it("resolves a report for an authorized staff user, from any gym — moderation is platform-wide today, not yet gym-scoped", async () => {
    const res = await post("report-1", { action: "resolve" }, COACH_USER.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "Comment removed." });
    expect(h.deleteComment).toHaveBeenCalledWith("comment-1");
    expect(h.saveCommentReport).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved", resolvedByStaffId: COACH_USER.id })
    );
  });

  it("dismisses a report without deleting the comment", async () => {
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
