// GET/POST /api/mobile/app-preferences — the phone app's chosen tabs, stored
// on the member's own profile. Real signed sessions; datastore mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const MEMBER = { id: "member-a", email: "a@x.test", role: "member", gymId: null, archivedAt: null };
const OTHER = { id: "member-b", email: "b@x.test", role: "member", gymId: null, archivedAt: null };

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const headers = (as?: string) => ({ "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) });
const post = (body: unknown, as?: string) =>
  new NextRequest("http://localhost/api/mobile/app-preferences", { method: "POST", headers: headers(as), body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [MEMBER, OTHER].find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ userId: id, tabChoice: null }));
});

describe("/api/mobile/app-preferences", () => {
  it("requires a session", async () => {
    const { POST } = await import("@/app/api/mobile/app-preferences/route");
    expect((await POST(post({ tabChoice: ["schedule", "nutrition"] }))).status).toBe(401);
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("saves two tabs on the session user's own profile, ignoring a userId in the body", async () => {
    const { POST } = await import("@/app/api/mobile/app-preferences/route");
    const res = await POST(post({ tabChoice: ["schedule", "nutrition"], userId: OTHER.id }, MEMBER.id));
    expect(res.status).toBe(200);
    expect(h.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: MEMBER.id, tabChoice: ["schedule", "nutrition"] }));
  });

  it("accepts null to go back to the default", async () => {
    const { POST } = await import("@/app/api/mobile/app-preferences/route");
    expect((await POST(post({ tabChoice: null }, MEMBER.id))).status).toBe(200);
  });

  it("rejects anything that isn't two different known tabs", async () => {
    const { POST } = await import("@/app/api/mobile/app-preferences/route");
    for (const bad of [["schedule"], ["schedule", "schedule"], ["schedule", "recovery"], "schedule", ["a", "b", "c"]]) {
      expect((await POST(post({ tabChoice: bad }, MEMBER.id))).status).toBe(400);
    }
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("GET returns the stored choice", async () => {
    h.findProfileByUserId.mockReturnValue({ userId: MEMBER.id, tabChoice: ["workouts", "nutrition"] });
    const { GET } = await import("@/app/api/mobile/app-preferences/route");
    const res = await GET(new NextRequest("http://localhost/api/mobile/app-preferences", { headers: headers(MEMBER.id) }));
    expect((await res.json()).data).toEqual({ tabChoice: ["workouts", "nutrition"] });
  });
});
