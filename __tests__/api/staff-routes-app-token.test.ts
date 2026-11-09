// The staff APP signs in with a Bearer token (the same signed session token the website keeps in a cookie). Staff routes built on authorizeStaffRequest read
// the cookie only, so the app could not reach the member summary, the class brief or the gym-community reports. Those four routes now opt in with
// { allowAppToken: true }. What this proves, with real routes, a real datastore and real signed sessions (fake ids only):
//   - the app token works on each of the four, and the website cookie still does
//   - the same permission and own-gym rules apply to an app token as to a cookie (a plain member is refused, another gym's data is not found)
//   - a route that did NOT opt in still refuses a Bearer-only request
//   - an archived account's token is refused, and no credential at all is still a 401
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

const cookie = (id: string) => ({ Cookie: fx.cookie(id) });
const bearer = (id: string) => ({ Authorization: `Bearer ${fx.cookie(id).slice("session=".length)}` });

type MemberHandler = (req: NextRequest, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>;
async function member(kind: "summary" | "brief", headers: Record<string, string>, userId: string) {
  const mod = (await import(`@/app/api/staff/members/[userId]/${kind}/route`)) as { GET: MemberHandler };
  return mod.GET(new NextRequest(`http://localhost/api/staff/members/${userId}/${kind}`, { headers }), { params: Promise.resolve({ userId }) });
}

async function reports(headers: Record<string, string>) {
  const mod = (await import("@/app/api/staff/community/gym-reports/route")) as { GET: (req: NextRequest) => Promise<Response> };
  return mod.GET(new NextRequest("http://localhost/api/staff/community/gym-reports?status=open", { headers }));
}

async function resolveReport(headers: Record<string, string>, id: string) {
  const mod = (await import("@/app/api/staff/community/gym-reports/[id]/resolve/route")) as {
    POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return mod.POST(
    new NextRequest(`http://localhost/api/staff/community/gym-reports/${id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ action: "dismiss" }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function gymMember() {
  const user = fx.db.createUserWithRole("tok-member@example.test", "x", "member", null);
  fx.db.saveProfile({ userId: user.id, fullName: "Token Member", email: user.email, primaryGoal: "General Health", createdAt: T, updatedAt: T } as never);
  fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, status: "active" });
  return user;
}

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("the four staff routes the app uses accept the app token", () => {
  it("member summary and class brief: a coach's Bearer token and cookie both get the data", async () => {
    const coach = fx.db.createUserWithRole("tok-coach@example.test", "x", "coach", null);
    const m = gymMember();
    for (const kind of ["summary", "brief"] as const) {
      for (const how of [bearer, cookie]) {
        const res = await member(kind, how(coach.id), m.id);
        expect(res.status).toBe(200);
        expect((await res.json()).data).toMatchObject({ walled: false, name: "Token Member" });
      }
    }
  });

  it("gym reports: list and resolve work with the app token", async () => {
    const coach = fx.db.createUserWithRole("tok-coach@example.test", "x", "coach", null);
    const list = await reports(bearer(coach.id));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ success: true, data: [] });
    // No such report: it gets past sign-in and permission and fails on the report itself (not a 401/403).
    const res = await resolveReport(bearer(coach.id), "no-such-report");
    expect(res.status).toBe(404);
  });
});

describe("the same rules apply to an app token as to a cookie", () => {
  it("a plain member's token is refused (403), signed out is 401, and another gym's member is not found", async () => {
    const coach = fx.db.createUserWithRole("tok-coach@example.test", "x", "coach", null);
    const m = gymMember();
    expect((await member("summary", bearer(m.id), m.id)).status).toBe(403);
    expect((await member("summary", {}, m.id)).status).toBe(401);
    expect((await reports(bearer(m.id))).status).toBe(403);
    expect((await reports({})).status).toBe(401);
    expect((await member("summary", bearer(coach.id), fx.memberB.id)).status).toBe(404);
  });

  it("an archived account's token is refused", async () => {
    const coach = fx.db.createUserWithRole("tok-coach@example.test", "x", "coach", null);
    const m = gymMember();
    const headers = bearer(coach.id);
    expect((await member("brief", headers, m.id)).status).toBe(200);
    expect(fx.db.setUserArchived(coach.id, true)).toBe(true);
    const after = await member("brief", headers, m.id);
    expect([401, 403]).toContain(after.status);
  });
});

describe("a staff route that did not opt in still refuses a Bearer-only request", () => {
  it("bug-report deletion needs the website cookie", async () => {
    const admin = fx.adminA;
    const mod = (await import("@/app/api/staff/bug-reports/delete/route")) as { POST: (req: NextRequest) => Promise<Response> };
    const res = await mod.POST(
      new NextRequest("http://localhost/api/staff/bug-reports/delete", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(admin.id) },
        body: JSON.stringify({ id: "x" }),
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in." });
  });
});
