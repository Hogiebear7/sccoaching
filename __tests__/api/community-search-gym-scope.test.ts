// Route-level cross-gym read-isolation test for
// app/api/mobile/community/search/route.ts. Covers both the "suggested"
// branch (blank query) and the query-match branch, plus the
// non-deduplication requirement: two distinct userIds sharing the same
// display name must both remain in results when both are same-gym.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommunityEligibleUsers: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  isFollowing: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_MEMBER_2 = { id: "member-a2", email: "membera2@x.test", role: "member" as const, gymId: null, archivedAt: null };

async function get(query: string) {
  const mod = await import("@/app/api/mobile/community/search/route");
  const token = signSession({ userId: GYM_A_CALLER.id }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/search${query}`, {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_MEMBER, GYM_B_MEMBER, GYM_A_MEMBER_2].find((u) => u.id === id)
  );
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name-${id}` }));
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.isFollowing.mockReturnValue(false);
});

describe("GET /api/mobile/community/search — suggested branch (blank query)", () => {
  it("includes same-gym members", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER]);

    const res = await get("?suggested=1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.results.map((r: { userId: string }) => r.userId)).toContain(GYM_A_MEMBER.id);
  });

  it("excludes cross-gym members", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER, GYM_B_MEMBER]);

    const res = await get("?suggested=1");
    const data = await res.json();

    expect(data.data.results.map((r: { userId: string }) => r.userId)).not.toContain(GYM_B_MEMBER.id);
  });
});

describe("GET /api/mobile/community/search — query branch", () => {
  it("includes same-gym matches", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER]);
    h.findProfileByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id ? { fullName: "Alex Runner" } : { fullName: `Name-${id}` }
    );

    const res = await get("?q=alex");
    const data = await res.json();

    expect(data.data.results.map((r: { userId: string }) => r.userId)).toContain(GYM_A_MEMBER.id);
  });

  it("excludes cross-gym matches even when the name matches", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER, GYM_B_MEMBER]);
    h.findProfileByUserId.mockReturnValue({ fullName: "Alex Runner" });

    const res = await get("?q=alex");
    const data = await res.json();

    expect(data.data.results.map((r: { userId: string }) => r.userId)).not.toContain(GYM_B_MEMBER.id);
  });

  it("keeps two same-gym members with the same display name as separate distinct results", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER, GYM_A_MEMBER_2]);
    h.findProfileByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id || id === GYM_A_MEMBER_2.id ? { fullName: "Same Name" } : { fullName: `Name-${id}` }
    );

    const res = await get("?q=same");
    const data = await res.json();

    expect(data.data.results).toHaveLength(2);
    const ids = data.data.results.map((r: { userId: string }) => r.userId).sort();
    expect(ids).toEqual([GYM_A_MEMBER.id, GYM_A_MEMBER_2.id].sort());
  });

  it("trims the query and preserves the result limit / response shape", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER]);
    h.findProfileByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id ? { fullName: "Alex Runner" } : { fullName: `Name-${id}` }
    );

    const res = await get("?q=%20alex%20");
    const data = await res.json();

    expect(data).toMatchObject({ success: true, data: { results: expect.any(Array) } });
    expect(data.data.results.map((r: { userId: string }) => r.userId)).toContain(GYM_A_MEMBER.id);
  });

  it("returns an empty result set for a blank, non-suggested query", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_MEMBER]);

    const res = await get("");
    const data = await res.json();

    expect(data.data.results).toEqual([]);
  });
});

it("rejects an unauthenticated request", async () => {
  const mod = await import("@/app/api/mobile/community/search/route");
  const req = new NextRequest("http://localhost/api/mobile/community/search?q=alex");
  const res = await mod.GET(req);
  expect(res.status).toBe(401);
});
