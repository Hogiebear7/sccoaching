// Cross-gym and private-session isolation test for
// app/api/mobile/community/workouts/[id]/comments/route.ts (GET + POST).
// GET now mirrors POST's exact not-found/private/cross-gym fold — a
// same-gym non-owner can no longer read a private session's comments by id.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findWorkoutSessionById: vi.fn(),
  findCommentsByWorkoutSessionId: vi.fn(),
  createComment: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/push", () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_OWNER = { id: "owner-a", email: "ownera@x.test", role: "member" as const, gymId: null };
const GYM_B_OWNER = { id: "owner-b", email: "ownerb@x.test", role: "member" as const, gymId: "gym-b" };

function session(userId: string, overrides: Partial<{ isPrivate: boolean }> = {}) {
  return {
    id: "session-1",
    userId,
    date: "2026-01-01",
    title: "Full Body",
    exercises: [{ name: "Back Squat" }],
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function get(id: string, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/workouts/[id]/comments/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/workouts/${id}/comments`, {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req, { params: Promise.resolve({ id }) });
}

async function post(id: string, body: unknown, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/workouts/[id]/comments/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/workouts/${id}/comments`, {
    method: "POST",
    headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_OWNER, GYM_B_OWNER].find((u) => u.id === id)
  );
  h.findCommentsByWorkoutSessionId.mockReturnValue([]);
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
});

describe("GET /api/mobile/community/workouts/[id]/comments", () => {
  it("returns comments for a same-gym session", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id));
    h.findCommentsByWorkoutSessionId.mockReturnValue([
      { id: "c1", userId: GYM_A_OWNER.id, body: "Nice work", mentionedUserIds: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const res = await get("session-1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.comments).toHaveLength(1);
  });

  it("rejects a cross-gym session using the existing not-found response", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    const crossGymRes = await get("session-1");
    const crossGymData = await crossGymRes.json();

    h.findWorkoutSessionById.mockReturnValue(undefined);
    const missingRes = await get("does-not-exist");
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
  });

  it("rejects an unauthenticated GET request", async () => {
    const mod = await import("@/app/api/mobile/community/workouts/[id]/comments/route");
    const req = new NextRequest("http://localhost/api/mobile/community/workouts/session-1/comments");
    const res = await mod.GET(req, { params: Promise.resolve({ id: "session-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a same-gym non-owner reading a private session's comments, using the existing not-found response", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id, { isPrivate: true }));
    h.findCommentsByWorkoutSessionId.mockReturnValue([
      { id: "c1", userId: GYM_A_OWNER.id, body: "Private note", mentionedUserIds: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const res = await get("session-1");
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("Workout not found.");
    expect(data.data).toBeUndefined();
  });

  it("lets the private session's owner read their own comments", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id, { isPrivate: true }));
    h.findCommentsByWorkoutSessionId.mockReturnValue([
      { id: "c1", userId: GYM_A_OWNER.id, body: "Private note", mentionedUserIds: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const res = await get("session-1", GYM_A_OWNER.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.comments).toHaveLength(1);
    expect(data.data.comments[0].body).toBe("Private note");
  });
});

describe("POST /api/mobile/community/workouts/[id]/comments", () => {
  it("creates a comment on a same-gym session", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id));

    const res = await post("session-1", { body: "Great session!" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.comment.body).toBe("Great session!");
    expect(h.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ workoutSessionId: "session-1", userId: GYM_A_CALLER.id, body: "Great session!" })
    );
  });

  it("rejects posting to a cross-gym session using the existing not-found response", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    const crossGymRes = await post("session-1", { body: "hi" });
    const crossGymData = await crossGymRes.json();

    h.findWorkoutSessionById.mockReturnValue(undefined);
    const missingRes = await post("does-not-exist", { body: "hi" });
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
  });

  it("does not create a CommentRecord for a cross-gym session", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    await post("session-1", { body: "hi" });
    expect(h.createComment).not.toHaveBeenCalled();
  });

  it("preserves existing private-session behavior for a same-gym non-owner", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id, { isPrivate: true }));
    const res = await post("session-1", { body: "hi" });
    expect(res.status).toBe(404);
    expect(h.createComment).not.toHaveBeenCalled();
  });

  it("preserves existing body-length and empty-body validation", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id));

    const emptyRes = await post("session-1", { body: "   " });
    expect(emptyRes.status).toBe(400);

    const longRes = await post("session-1", { body: "x".repeat(600) });
    const longData = await longRes.json();
    expect(longRes.status).toBe(200);
    expect(longData.data.comment.body.length).toBe(500);
  });

  it("rejects an unauthenticated POST request", async () => {
    const mod = await import("@/app/api/mobile/community/workouts/[id]/comments/route");
    const req = new NextRequest("http://localhost/api/mobile/community/workouts/session-1/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hi" }),
    });
    const res = await mod.POST(req, { params: Promise.resolve({ id: "session-1" }) });
    expect(res.status).toBe(401);
  });
});
