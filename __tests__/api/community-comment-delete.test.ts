// Route-level authorization tests for
// app/api/mobile/community/comments/[id]/route.ts (DELETE). Author-only:
// the route never performs an independent gym check because it doesn't
// need one — comment.userId !== me.id already rejects anyone but the
// comment's own author, and a cross-gym caller is just one more non-owner
// among many, indistinguishable from a same-gym non-owner. See the file
// header comment on the route itself: staff removal goes through the
// report/resolve flow instead (already gym-scoped — see
// staff-community-reports-resolve-gym-scope.test.ts), not this route.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommentById: vi.fn(),
  deleteComment: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const AUTHOR = { id: "author-1", email: "author@x.test", role: "member" as const, gymId: null };
const SAME_GYM_OTHER = { id: "other-a", email: "othera@x.test", role: "member" as const, gymId: null };
const CROSS_GYM_OTHER = { id: "other-b", email: "otherb@x.test", role: "member" as const, gymId: "gym-b" };

const COMMENT = {
  id: "comment-1",
  workoutSessionId: "session-1",
  userId: AUTHOR.id,
  body: "Nice work",
  mentionedUserIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function del(id: string, sessionUserId?: string) {
  const mod = await import("@/app/api/mobile/community/comments/[id]/route");
  const req = new NextRequest(`http://localhost/api/mobile/community/comments/${id}`, {
    method: "DELETE",
    headers: sessionUserId
      ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
      : {},
  });
  return mod.DELETE(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [AUTHOR, SAME_GYM_OTHER, CROSS_GYM_OTHER].find((u) => u.id === id)
  );
  h.findCommentById.mockReturnValue(COMMENT);
});

describe("DELETE /api/mobile/community/comments/[id]", () => {
  it("rejects an unauthenticated request and does not delete", async () => {
    const res = await del("comment-1");
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.message).toBe("Not signed in.");
    expect(h.deleteComment).not.toHaveBeenCalled();
  });

  it("rejects a same-gym non-owner and does not delete", async () => {
    const res = await del("comment-1", SAME_GYM_OTHER.id);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toBe("You can only delete your own comments.");
    expect(h.deleteComment).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing comment and does not delete", async () => {
    h.findCommentById.mockReturnValue(undefined);

    const res = await del("does-not-exist", AUTHOR.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("Comment not found.");
    expect(h.deleteComment).not.toHaveBeenCalled();
  });

  it("lets the comment's author delete it exactly once", async () => {
    const res = await del("comment-1", AUTHOR.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, message: "Deleted." });
    expect(h.deleteComment).toHaveBeenCalledTimes(1);
    expect(h.deleteComment).toHaveBeenCalledWith("comment-1");
  });

  it("checks authorization before ever calling deleteComment, for every denial path", async () => {
    await del("comment-1"); // unauthenticated
    await del("comment-1", SAME_GYM_OTHER.id); // non-owner
    h.findCommentById.mockReturnValue(undefined);
    await del("comment-1", AUTHOR.id); // missing comment

    expect(h.deleteComment).not.toHaveBeenCalled();
  });

  it("rejects a cross-gym non-owner with the same response as a same-gym non-owner (no independent gym check needed)", async () => {
    const crossGymRes = await del("comment-1", CROSS_GYM_OTHER.id);
    const crossGymData = await crossGymRes.json();

    const sameGymRes = await del("comment-1", SAME_GYM_OTHER.id);
    const sameGymData = await sameGymRes.json();

    expect(crossGymRes.status).toBe(sameGymRes.status);
    expect(crossGymData).toEqual(sameGymData);
    expect(crossGymRes.status).toBe(403);
    expect(h.deleteComment).not.toHaveBeenCalled();
  });
});
