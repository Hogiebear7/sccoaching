// Cross-gym isolation test for
// app/api/staff/community/reports/[id]/resolve/route.ts. Report ownership
// is resolved through the underlying content, never the reporter:
// commentId -> workoutSessionId -> the session owner's verified gymId. A
// cross-gym report, and a report whose ownership chain can't be resolved
// (comment or session missing), both fail closed into the exact same
// "Report not found." response used for a genuinely missing report.
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

const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_B_COACH = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_OWNER = { id: "owner-a", email: "ownera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_OWNER = { id: "owner-b", email: "ownerb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const REPORT = {
  id: "report-1",
  commentId: "comment-1",
  reporterId: "reporter-1",
  reason: "spam",
  status: "open" as const,
  resolvedByStaffId: null,
  resolvedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function commentOn(sessionId: string) {
  return {
    id: "comment-1",
    workoutSessionId: sessionId,
    userId: "commenter-1",
    body: "some comment",
    mentionedUserIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function sessionOwnedBy(userId: string) {
  return {
    id: "session-1",
    userId,
    date: "2026-01-01",
    title: "Full Body",
    exercises: [],
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

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
    [GYM_A_COACH, GYM_B_COACH, GYM_A_OWNER, GYM_B_OWNER].find((u) => u.id === id)
  );
  h.findCommentReportById.mockReturnValue(REPORT);
});

describe("POST /api/staff/community/reports/[id]/resolve — gym scope", () => {
  it("allows a same-gym staff member to resolve", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy(GYM_A_OWNER.id));

    const res = await post("report-1", { action: "resolve" }, GYM_A_COACH.id);

    expect(res.status).toBe(200);
    expect(h.deleteComment).toHaveBeenCalledWith("comment-1");
    expect(h.saveCommentReport).toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" }));
  });

  it("denies a cross-gym staff member using the same not-found response as a missing report", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy(GYM_B_OWNER.id));

    const crossGymRes = await post("report-1", { action: "resolve" }, GYM_A_COACH.id);
    const crossGymData = await crossGymRes.json();

    h.findCommentReportById.mockReturnValue(undefined);
    const missingRes = await post("does-not-exist", { action: "resolve" }, GYM_A_COACH.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("Report not found.");
  });

  it("does not mutate report status or delete the comment on cross-gym denial", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy(GYM_B_OWNER.id));

    await post("report-1", { action: "resolve" }, GYM_A_COACH.id);

    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("fails closed and does not mutate when the comment no longer exists (unresolvable ownership)", async () => {
    h.findCommentById.mockReturnValue(undefined);

    const res = await post("report-1", { action: "resolve" }, GYM_A_COACH.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("Report not found.");
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("fails closed and does not mutate when the underlying workout session no longer exists", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(undefined);

    const res = await post("report-1", { action: "resolve" }, GYM_A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).not.toHaveBeenCalled();
  });

  it("preserves normal same-gym dismiss behavior (no comment deletion, status updated)", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy(GYM_A_OWNER.id));

    const res = await post("report-1", { action: "dismiss" }, GYM_A_COACH.id);

    expect(res.status).toBe(200);
    expect(h.deleteComment).not.toHaveBeenCalled();
    expect(h.saveCommentReport).toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed" }));
  });

  it("preserves missing/invalid session behavior (401) regardless of gym", async () => {
    h.findCommentById.mockReturnValue(commentOn("session-1"));
    h.findWorkoutSessionById.mockReturnValue(sessionOwnedBy(GYM_A_OWNER.id));

    const res = await post("report-1", { action: "resolve" });

    expect(res.status).toBe(401);
    expect(h.deleteComment).not.toHaveBeenCalled();
  });
});
