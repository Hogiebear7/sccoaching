// Cross-gym isolation test for
// app/api/mobile/community/comments/[id]/report/route.ts. A report against
// a cross-gym comment (author in another gym) is folded into the existing
// not-found response used for a genuinely missing comment.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommentById: vi.fn(),
  createCommentReport: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_AUTHOR = { id: "author-a", email: "authora@x.test", role: "member" as const, gymId: null };
const GYM_B_AUTHOR = { id: "author-b", email: "authorb@x.test", role: "member" as const, gymId: "gym-b" };

function comment(userId: string) {
  return {
    id: "comment-1",
    workoutSessionId: "session-1",
    userId,
    body: "Some comment",
    mentionedUserIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function post(id: string, body: unknown = { reason: "Spam" }, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/comments/[id]/report/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/comments/${id}/report`, {
    method: "POST",
    headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_AUTHOR, GYM_B_AUTHOR].find((u) => u.id === id)
  );
});

describe("POST /api/mobile/community/comments/[id]/report", () => {
  it("succeeds for a same-gym comment", async () => {
    h.findCommentById.mockReturnValue(comment(GYM_A_AUTHOR.id));

    const res = await post("comment-1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.createCommentReport).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-1", reporterId: GYM_A_CALLER.id })
    );
  });

  it("rejects a cross-gym comment using the existing not-found response", async () => {
    h.findCommentById.mockReturnValue(comment(GYM_B_AUTHOR.id));
    const crossGymRes = await post("comment-1");
    const crossGymData = await crossGymRes.json();

    h.findCommentById.mockReturnValue(undefined);
    const missingRes = await post("does-not-exist");
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("Comment not found.");
  });

  it("does not create a CommentReportRecord for a cross-gym comment", async () => {
    h.findCommentById.mockReturnValue(comment(GYM_B_AUTHOR.id));
    await post("comment-1");
    expect(h.createCommentReport).not.toHaveBeenCalled();
  });

  it("preserves existing duplicate-report behavior (no dedupe, still succeeds)", async () => {
    h.findCommentById.mockReturnValue(comment(GYM_A_AUTHOR.id));

    await post("comment-1");
    const res = await post("comment-1");

    expect(res.status).toBe(200);
    expect(h.createCommentReport).toHaveBeenCalledTimes(2);
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/comments/[id]/report/route");
    const req = new NextRequest("http://localhost/api/mobile/community/comments/comment-1/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Spam" }),
    });
    const res = await mod.POST(req, { params: Promise.resolve({ id: "comment-1" }) });
    expect(res.status).toBe(401);
  });
});
