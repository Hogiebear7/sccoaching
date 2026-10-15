// Community safety controls (Apple 1.2 / Play UGC): block, report a workout post, staff removal, comment filter. REAL routes and a REAL temporary datastore with
// fake accounts, so a hidden member really is hidden on every surface that lists or opens another member's content.
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

vi.mock("@/lib/push", () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));

let fx: IapFixture;
const T = "2026-10-01T00:00:00.000Z";

const call = (method: string, url: string, cookie: string | undefined, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });

type Who = { id: string; cookie: string };
function member(email: string, name: string, gym: string | null = null): Who {
  const u = fx.db.createUserWithRole(email, "x", "member", gym);
  fx.db.saveProfile({ userId: u.id, fullName: name, createdAt: T, updatedAt: T } as never);
  return { id: u.id, cookie: fx.cookie(u.id) };
}
function workout(userId: string, id: string, extra: Record<string, unknown> = {}) {
  fx.db.saveWorkoutSession({ id, userId, date: "2026-10-02", title: `Session ${id}`, exercises: [], runs: [], createdAt: T, updatedAt: T, ...extra } as never);
}

const api = {
  block: async (w: Who, userId: string) => (await import("@/app/api/mobile/community/block/route")).POST(call("POST", "/x", w.cookie, { userId })),
  unblock: async (w: Who, userId: string) => (await import("@/app/api/mobile/community/unblock/route")).POST(call("POST", "/x", w.cookie, { userId })),
  blocked: async (w: Who) => (await import("@/app/api/mobile/community/blocked/route")).GET(call("GET", "/x", w.cookie)),
  follow: async (w: Who, userId: string) => (await import("@/app/api/mobile/community/follow/route")).POST(call("POST", "/x", w.cookie, { userId })),
  feed: async (w: Who) => (await import("@/app/api/mobile/community/feed/route")).GET(call("GET", "/api/mobile/community/feed", w.cookie)),
  search: async (w: Who, q: string) => (await import("@/app/api/mobile/community/search/route")).GET(call("GET", `/api/mobile/community/search?q=${q}`, w.cookie)),
  leaderboard: async (w: Who) => (await import("@/app/api/mobile/community/leaderboard/route")).GET(call("GET", "/api/mobile/community/leaderboard", w.cookie)),
  detail: async (w: Who, id: string) => (await import("@/app/api/mobile/community/workouts/[id]/route")).GET(call("GET", "/x", w.cookie), idp(id)),
  like: async (w: Who, id: string) => (await import("@/app/api/mobile/community/workouts/[id]/like/route")).POST(call("POST", "/x", w.cookie), idp(id)),
  comments: async (w: Who, id: string) => (await import("@/app/api/mobile/community/workouts/[id]/comments/route")).GET(call("GET", "/x", w.cookie), idp(id)),
  comment: async (w: Who, id: string, body: unknown) => (await import("@/app/api/mobile/community/workouts/[id]/comments/route")).POST(call("POST", "/x", w.cookie, body), idp(id)),
  reportWorkout: async (w: Who, id: string, reason = "abusive") => (await import("@/app/api/mobile/community/workouts/[id]/report/route")).POST(call("POST", "/x", w.cookie, { reason }), idp(id)),
  resolve: async (staffCookie: string, id: string, action: string) => (await import("@/app/api/staff/community/reports/[id]/resolve/route")).POST(call("POST", "/x", staffCookie, { action }), idp(id)),
  visibility: async (w: Who, id: string, isPrivate: boolean) => (await import("@/app/api/mobile/workouts/[id]/visibility/route")).POST(call("POST", "/x", w.cookie, { isPrivate }), idp(id)),
};

beforeEach(async () => { fx = await createFixture(); });
afterEach(() => fx.cleanup());

describe("blocking", () => {
  it("needs a session, rejects blocking yourself, and treats another gym's member as not found", async () => {
    const a = member("a@example.test", "Alice");
    const outsider = member("o@example.test", "Olly", "gym-b");
    const { POST } = await import("@/app/api/mobile/community/block/route");
    expect((await POST(call("POST", "/x", undefined, { userId: a.id }))).status).toBe(401);
    expect((await api.block(a, a.id)).status).toBe(400);
    expect((await api.block(a, outsider.id)).status).toBe(404);
    expect((await api.block(a, "no-such-user")).status).toBe(404);
    expect((await api.block(a, "")).status).toBe(400);
    expect((await api.blocked(a).then((r) => r.json())).data.blocked).toEqual([]);
  });

  it("blocks, lists the member by name, is idempotent, and removes follows in both directions", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    fx.db.followUser(a.id, b.id);
    fx.db.followUser(b.id, a.id);

    expect((await api.block(a, b.id)).status).toBe(200);
    expect((await api.block(a, b.id)).status).toBe(200);
    expect(fx.db.findProfileByUserId(a.id)!.blockedUserIds).toEqual([b.id]);
    expect(fx.db.isFollowing(a.id, b.id)).toBe(false);
    expect(fx.db.isFollowing(b.id, a.id)).toBe(false);
    expect((await api.blocked(a).then((r) => r.json())).data.blocked).toEqual([{ userId: b.id, name: expect.any(String) }]);
    // the blocked member's own list does not reveal who blocked them
    expect((await api.blocked(b).then((r) => r.json())).data.blocked).toEqual([]);
  });

  it("hides each party from the other on every Community surface, and unblocking restores them", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    const c = member("c@example.test", "Cara");
    workout(a.id, "wa");
    workout(b.id, "wb");
    workout(c.id, "wc");
    fx.db.followUser(a.id, b.id);
    fx.db.followUser(a.id, c.id);
    fx.db.createComment({ id: "cb", workoutSessionId: "wc", userId: b.id, body: "from bob", mentionedUserIds: [], createdAt: T } as never);
    fx.db.createComment({ id: "ca", workoutSessionId: "wc", userId: a.id, body: "from alice", mentionedUserIds: [], createdAt: T } as never);
    fx.db.createComment({ id: "cc", workoutSessionId: "wc", userId: c.id, body: "from cara", mentionedUserIds: [], createdAt: T } as never);

    // before the block everything is visible
    expect((await api.feed(a).then((r) => r.json())).data.items.map((i: { userId: string }) => i.userId).sort()).toEqual([b.id, c.id].sort());
    expect((await api.detail(b, "wa")).status).toBe(200);

    expect((await api.block(a, b.id)).status).toBe(200);

    // even if a follow somehow survives (a race, or data from before this release), the read paths still hide the blocked member
    fx.db.followUser(a.id, b.id);
    // Alice no longer sees Bob
    expect((await api.feed(a).then((r) => r.json())).data.items.map((i: { userId: string }) => i.userId)).toEqual([c.id]);
    expect((await api.detail(a, "wb")).status).toBe(404);
    expect((await api.like(a, "wb")).status).toBe(404);
    expect((await api.comments(a, "wb")).status).toBe(404);
    expect((await api.comment(a, "wb", { body: "hello" })).status).toBe(404);
    expect((await api.search(a, "bob").then((r) => r.json())).data.results).toEqual([]);
    expect((await api.leaderboard(a).then((r) => r.json())).data.entries.map((e: { userId: string }) => e.userId)).not.toContain(b.id);
    expect((await api.follow(a, b.id)).status).toBe(404);
    // comments by Bob on a third member's workout are hidden from Alice; her own and Cara's stay
    expect((await api.comments(a, "wc").then((r) => r.json())).data.comments.map((x: { id: string }) => x.id).sort()).toEqual(["ca", "cc"]);

    // and Bob no longer sees Alice, without being told why
    expect((await api.detail(b, "wa")).status).toBe(404);
    expect((await api.like(b, "wa")).status).toBe(404);
    expect((await api.comment(b, "wa", { body: "hi" })).status).toBe(404);
    expect((await api.search(b, "alice").then((r) => r.json())).data.results).toEqual([]);
    expect((await api.follow(b, a.id)).status).toBe(404);
    expect((await api.comments(b, "wc").then((r) => r.json())).data.comments.map((x: { id: string }) => x.id).sort()).toEqual(["cb", "cc"]);

    // an unrelated member is unaffected
    expect((await api.detail(c, "wa")).status).toBe(200);
    expect((await api.detail(c, "wb")).status).toBe(200);

    // unblocking restores visibility (it never re-creates a follow: drop the injected one first, then check none comes back)
    fx.db.unfollowUser(a.id, b.id);
    expect((await api.unblock(a, b.id)).status).toBe(200);
    expect((await api.detail(a, "wb")).status).toBe(200);
    expect((await api.detail(b, "wa")).status).toBe(200);
    expect(fx.db.isFollowing(a.id, b.id)).toBe(false);
  });

  it("drops a blocked or blocking member from mentions", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    const c = member("c@example.test", "Cara");
    workout(c.id, "wc");
    await api.block(a, b.id);
    const res = await api.comment(a, "wc", { body: "look @Bob and @Cara", mentionedUserIds: [b.id, c.id] });
    expect(res.status).toBe(200);
    const stored = fx.db.findCommentsByWorkoutSessionId("wc");
    expect(stored[0].mentionedUserIds).toEqual([c.id]);
    expect(fx.db.findNotificationsByUserId?.(b.id) ?? []).toEqual([]);
  });

  it("a block list is private to its owner: unblock only ever touches the caller's own list", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    const c = member("c@example.test", "Cara");
    await api.block(a, c.id);
    // Bob tries to unblock Cara for Alice: nothing changes for Alice
    await api.unblock(b, c.id);
    expect(fx.db.findProfileByUserId(a.id)!.blockedUserIds).toEqual([c.id]);
  });
});

describe("reporting a shared workout and staff removal", () => {
  it("reports a visible workout once, refuses own / cross-gym / blocked posts, and needs a reason", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    const outsider = member("o@example.test", "Olly", "gym-b");
    workout(b.id, "wb");
    workout(a.id, "wa");

    expect((await api.reportWorkout(a, "wb", "")).status).toBe(400);
    expect((await api.reportWorkout(a, "wa")).status).toBe(404); // own post
    expect((await api.reportWorkout(outsider, "wb")).status).toBe(404); // another gym
    expect((await api.reportWorkout(a, "wb")).status).toBe(200);
    expect((await api.reportWorkout(a, "wb")).status).toBe(200); // not duplicated
    const reports = fx.db.findAllCommentReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ targetType: "workout", workoutSessionId: "wb", reporterId: a.id, status: "open" });

    await api.block(a, b.id);
    expect((await api.reportWorkout(a, "wb")).status).toBe(404);
  });

  it("resolving takes the workout out of Community for good; the owner keeps it and cannot re-share it; dismissing changes nothing", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    workout(b.id, "wb");
    workout(b.id, "wb2");
    await api.reportWorkout(a, "wb");
    await api.reportWorkout(a, "wb2");
    const [r1, r2] = fx.db.findAllCommentReports().sort((x, y) => (x.workoutSessionId ?? "").localeCompare(y.workoutSessionId ?? ""));
    const staff = fx.cookie(fx.adminA.id);

    expect((await api.resolve(staff, r2.id, "dismiss")).status).toBe(200);
    expect((await api.detail(a, "wb2")).status).toBe(200);
    expect(fx.db.findWorkoutSessionById("wb2")!.communityRemovedAt ?? null).toBeNull();

    expect((await api.resolve(staff, r1.id, "resolve")).status).toBe(200);
    expect(fx.db.findWorkoutSessionById("wb")!.communityRemovedAt).toBeTruthy();
    expect((await api.detail(a, "wb")).status).toBe(404);
    expect((await api.feed(a).then((r) => r.json())).data.items.map((i: { id: string }) => i.id)).not.toContain("wb");
    expect((await api.detail(b, "wb")).status).toBe(200); // the owner still sees their own workout
    expect((await api.visibility(b, "wb", false)).status).toBe(403); // cannot re-share
    expect((await api.visibility(b, "wb", true)).status).toBe(200); // can keep it private
    expect(fx.db.findAllCommentReports().find((r) => r.id === r1.id)).toMatchObject({ status: "resolved", resolvedByStaffId: fx.adminA.id });
  });

  it("a staff member from another gym cannot see or resolve the report", async () => {
    const a = member("a@example.test", "Alice");
    const b = member("b@example.test", "Bob");
    workout(b.id, "wb");
    await api.reportWorkout(a, "wb");
    const [r] = fx.db.findAllCommentReports();
    expect((await api.resolve(fx.cookie(fx.adminB.id), r.id, "resolve")).status).toBe(404);
    expect(fx.db.findWorkoutSessionById("wb")!.communityRemovedAt ?? null).toBeNull();
  });
});

describe("comment filter", () => {
  it("refuses unmistakable abuse before it is stored, and lets ordinary gym talk through", async () => {
    const a = member("a@example.test", "Alice");
    const c = member("c@example.test", "Cara");
    workout(c.id, "wc");
    const abusive = await api.comment(a, "wc", { body: "kill yourself" });
    expect(abusive.status).toBe(422);
    expect((await abusive.json()).code).toBe("content_refused");
    expect(fx.db.findCommentsByWorkoutSessionId("wc")).toHaveLength(0);
    for (const ok of ["Absolutely killed that session", "Beast mode, that deadlift is nuts", "Class today was brutal"]) {
      expect((await api.comment(a, "wc", { body: ok })).status, ok).toBe(200);
    }
  });
});

// Drift guard: any community route that lists or opens other members' content must go through the moderation helpers, so a future route cannot skip blocking.
describe("community routes apply the moderation helpers", () => {
  const root = path.join(process.cwd(), "app", "api", "mobile", "community");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : n === "route.ts" ? [p] : []; });
  const NO_OTHER_MEMBER_CONTENT = ["privacy", "blocked", "unblock", "block", "unfollow"]; // own settings, own list, or removal of own relationship
  it("every route that reads other members' content calls community-moderation", () => {
    const missing = files(root)
      .filter((f) => !NO_OTHER_MEMBER_CONTENT.includes(path.relative(root, path.dirname(f)).split(path.sep).join("/")))
      .filter((f) => !readFileSync(f, "utf8").includes("@/lib/community-moderation"))
      .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));
    // Deliberately not hidden: reporting a comment (a member must be able to report abuse from someone they have just blocked) and deleting your own comment.
    expect(missing).toEqual(["app/api/mobile/community/comments/[id]/report/route.ts", "app/api/mobile/community/comments/[id]/route.ts"]);
  });
});
