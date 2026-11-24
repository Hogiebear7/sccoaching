// Route-level authorization/behavior tests for
// app/api/mobile/community/privacy/route.ts (GET + POST). This route is
// strictly self-scoped — GET and POST only ever read/write the
// authenticated caller's own CommunityPrivacyRecord via session.userId; no
// query param, route param, or request-body field ever names a target
// user. There is no cross-user surface here, so a gym-scope check would be
// meaningless — self-scope (never trusting any caller-supplied id) is the
// entire authorization boundary for this route, and that's what these
// tests assert.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  saveCommunityPrivacy: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const CALLER = { id: "caller-1", email: "caller@x.test", role: "member" as const, gymId: null };

async function get(sessionUserId?: string) {
  const mod = await import("@/app/api/mobile/community/privacy/route");
  const req = new NextRequest("http://localhost/api/mobile/community/privacy", {
    headers: sessionUserId
      ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
      : {},
  });
  return mod.GET(req);
}

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const mod = await import("@/app/api/mobile/community/privacy/route");
  const req = new NextRequest("http://localhost/api/mobile/community/privacy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return mod.POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => (id === CALLER.id ? CALLER : undefined));
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
});

describe("GET /api/mobile/community/privacy", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await get();
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.message).toBe("Not signed in.");
  });

  it("returns visible/real-name defaults when no record exists yet", async () => {
    const res = await get(CALLER.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        discoverable: true,
        leaderboardVisible: true,
        showRealName: true,
        communityOptIn: false,
        adultConfirmed: false,
        profileVisibility: "followers",
        whoCanFollow: "anyone",
        leaderboardMode: "named",
        leaderboardAlias: "Hidden user",
        leaderboardAliases: expect.any(Array),
      },
    });
  });

  it("returns the caller's own stored preferences", async () => {
    h.findCommunityPrivacyByUserId.mockReturnValue({
      userId: CALLER.id,
      discoverable: false,
      leaderboardVisible: false,
      showRealName: false,
      communityOptIn: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await get(CALLER.id);
    const data = await res.json();

    expect(data.data).toEqual({
      discoverable: false,
      leaderboardVisible: false,
      showRealName: false,
      communityOptIn: true,
      adultConfirmed: false,
      profileVisibility: "followers",
      whoCanFollow: "anyone",
      // The stored record has leaderboardVisible false and no mode, so it reads as the old "off": hidden.
      leaderboardMode: "hidden",
      leaderboardAlias: "Hidden user",
      leaderboardAliases: expect.any(Array),
    });
  });

  it("returns the stored profile settings", async () => {
    h.findCommunityPrivacyByUserId.mockReturnValue({
      userId: CALLER.id,
      discoverable: true,
      leaderboardVisible: true,
      showRealName: true,
      profileVisibility: "everyone",
      whoCanFollow: "gym",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const data = await (await get(CALLER.id)).json();
    expect(data.data).toMatchObject({ profileVisibility: "everyone", whoCanFollow: "gym" });
  });

  it("only ever reads the caller's own record, regardless of what the session resolves to", async () => {
    await get(CALLER.id);
    expect(h.findCommunityPrivacyByUserId).toHaveBeenCalledWith(CALLER.id);
    expect(h.findCommunityPrivacyByUserId).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/mobile/community/privacy", () => {
  const VALID_BODY = { discoverable: true, leaderboardVisible: false, showRealName: true };

  it("saves the two profile settings, and keeps what was stored when an older app omits them", async () => {
    await post({ ...VALID_BODY, profileVisibility: "everyone", whoCanFollow: "gym" }, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ profileVisibility: "everyone", whoCanFollow: "gym" }));

    h.findCommunityPrivacyByUserId.mockReturnValue({ userId: CALLER.id, discoverable: true, leaderboardVisible: true, showRealName: true, profileVisibility: "followers_gym", whoCanFollow: "nobody", createdAt: "x", updatedAt: "x" });
    await post(VALID_BODY, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ profileVisibility: "followers_gym", whoCanFollow: "nobody" }));
  });

  it("saves an alias choice and keeps the old switch in step (alias still counts as shown)", async () => {
    await post({ ...VALID_BODY, leaderboardVisible: true, leaderboardMode: "alias", leaderboardAlias: "Shadow user" }, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ leaderboardMode: "alias", leaderboardAlias: "Shadow user", leaderboardVisible: true }));
    await post({ ...VALID_BODY, leaderboardVisible: true, leaderboardMode: "hidden" }, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ leaderboardMode: "hidden", leaderboardVisible: false }));
  });

  it("an older app that only flips the switch changes the mode; one that does not touch it keeps an alias", async () => {
    h.findCommunityPrivacyByUserId.mockReturnValue({ userId: CALLER.id, discoverable: true, leaderboardVisible: true, showRealName: true, leaderboardMode: "alias", leaderboardAlias: "Shadow user", createdAt: "x", updatedAt: "x" });
    await post({ ...VALID_BODY, leaderboardVisible: true }, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ leaderboardMode: "alias", leaderboardAlias: "Shadow user" }));
    await post({ ...VALID_BODY, leaderboardVisible: false }, CALLER.id);
    expect(h.saveCommunityPrivacy).toHaveBeenLastCalledWith(expect.objectContaining({ leaderboardMode: "hidden", leaderboardVisible: false }));
  });

  it("refuses a bad leaderboard mode or an alias that is not on the list", async () => {
    expect((await post({ ...VALID_BODY, leaderboardMode: "ghost" }, CALLER.id)).status).toBe(400);
    expect((await post({ ...VALID_BODY, leaderboardAlias: "Definitely Someone Else" }, CALLER.id)).status).toBe(400);
  });

  it("refuses an invalid profile setting", async () => {
    const a = await post({ ...VALID_BODY, profileVisibility: "public" }, CALLER.id);
    const b = await post({ ...VALID_BODY, whoCanFollow: "friends" }, CALLER.id);
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request and does not save", async () => {
    const res = await post(VALID_BODY);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.message).toBe("Not signed in.");
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalled();
  });

  it("saves valid preferences for the authenticated caller", async () => {
    const res = await post(VALID_BODY, CALLER.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, message: "Saved." });
    expect(h.saveCommunityPrivacy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CALLER.id,
        discoverable: true,
        leaderboardVisible: false,
        showRealName: true,
        communityOptIn: false,
      })
    );
  });

  it("rejects a malformed (non-JSON) body and does not save", async () => {
    const res = await post(undefined, CALLER.id, "{not json");
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Invalid JSON body.");
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalled();
  });

  it("rejects a missing request body and does not save", async () => {
    const res = await post(undefined, CALLER.id, "");
    expect(res.status).toBe(400);
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalled();
  });

  it("rejects non-boolean required fields and does not save", async () => {
    const res = await post({ discoverable: "yes", leaderboardVisible: false, showRealName: true }, CALLER.id);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("discoverable, leaderboardVisible and showRealName must be booleans.");
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalled();
  });

  it("preserves an existing communityOptIn value when the field is omitted", async () => {
    h.findCommunityPrivacyByUserId.mockReturnValue({
      userId: CALLER.id,
      discoverable: true,
      leaderboardVisible: true,
      showRealName: true,
      communityOptIn: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await post(VALID_BODY, CALLER.id);

    expect(h.saveCommunityPrivacy).toHaveBeenCalledWith(expect.objectContaining({ communityOptIn: true }));
  });

  it("does not let a caller-supplied userId in the body target another user's record", async () => {
    await post({ ...VALID_BODY, userId: "someone-else" }, CALLER.id);

    expect(h.saveCommunityPrivacy).toHaveBeenCalledWith(expect.objectContaining({ userId: CALLER.id }));
    expect(h.saveCommunityPrivacy).not.toHaveBeenCalledWith(expect.objectContaining({ userId: "someone-else" }));
  });
});
