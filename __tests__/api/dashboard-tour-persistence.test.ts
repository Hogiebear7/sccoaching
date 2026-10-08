// First-run dashboard walkthrough: persistence model.
//
// Whether a member has seen the walkthrough is one boolean on their own profile (ProfileRecord.dashboardTourCompleted), written by
// POST /api/profile/tour. The dashboard shows the tour when it is not true, and Settings -> Help replays it by writing false. Skip and Finish
// both write true. These tests drive the REAL signup, login, logout and tour routes against a REAL temporary datastore with fake accounts
// only, and prove the flag is per account, survives refresh and logout/login, and never touches tenant, payment or entitlement state.
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;

const SIGNUP_BODY = (email: string) => ({
  email,
  password: "Tester-pass-123!",
  fullName: "Test Member",
  phone: "0830000000",
  dateOfBirth: "1990-01-01",
  gender: "Male",
  primaryGoal: "Build Muscle",
});

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/session=([^;]*)/);
  return m && m[1] ? `session=${m[1]}` : "";
}

async function post(route: string, body: unknown, cookie?: string) {
  const mod = await import(`@/app/api/${route}/route`);
  return mod.POST(
    new NextRequest(`http://localhost/api/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })
  );
}

async function signUp(email: string) {
  const res = await post("auth/signup", SIGNUP_BODY(email));
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const user = fx.db.findUserByEmail(email)!;
  return { user, cookie: cookieFrom(res) || fx.cookie(user.id) };
}

const tour = (cookie: string | undefined, completed: unknown) => post("profile/tour", { completed }, cookie);
const seen = (userId: string) => fx.db.findProfileByUserId(userId)?.dashboardTourCompleted;

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("first visit", () => {
  it("a brand-new web signup has not seen the walkthrough, so the dashboard offers it", async () => {
    const { user } = await signUp("first@example.test");
    expect(seen(user.id)).toBe(false);
  });

  it("a profile with no stored flag (an older account) is treated as not yet seen, and is only ever offered the skippable tour", async () => {
    const { user } = await signUp("legacy@example.test");
    // Remove the field from the stored profile, as for an account created before the flag existed.
    const file = path.join(fx.dir, "db.json");
    const db = JSON.parse(readFileSync(file, "utf8"));
    for (const p of db.profiles) if (p.userId === user.id) delete p.dashboardTourCompleted;
    writeFileSync(file, JSON.stringify(db));
    vi.resetModules();
    const fresh = await import("@/lib/db");
    expect(fresh.findProfileByUserId(user.id)?.dashboardTourCompleted).toBe(false);
  });
});

describe("completion and skip", () => {
  it("Finish and Skip both mark the walkthrough as seen, and repeating it is harmless", async () => {
    const { user, cookie } = await signUp("done@example.test");
    expect((await tour(cookie, true)).status).toBe(200);
    expect(seen(user.id)).toBe(true);
    expect((await tour(cookie, true)).status).toBe(200);
    expect(seen(user.id)).toBe(true);
  });

  it("does not change anything else on the profile, the account, the tenant or any subscription", async () => {
    const { user, cookie } = await signUp("scope@example.test");
    const profileBefore = { ...fx.db.findProfileByUserId(user.id)! };
    const userBefore = { ...fx.db.findUserById(user.id)! };
    const subsBefore = JSON.stringify(fx.db.findAllSubscriptions());

    await tour(cookie, true);

    const withoutFlag = (p: object) => {
      const copy: Record<string, unknown> = { ...p };
      delete copy.dashboardTourCompleted;
      delete copy.updatedAt;
      return copy;
    };
    const profileAfter = withoutFlag(fx.db.findProfileByUserId(user.id)!);
    const profileRest = withoutFlag(profileBefore);
    expect(profileAfter).toEqual(profileRest);
    expect(fx.db.findUserById(user.id)).toEqual(userBefore);
    expect(fx.db.findUserById(user.id)?.gymId ?? null).toBe(userBefore.gymId ?? null);
    expect(JSON.stringify(fx.db.findAllSubscriptions())).toBe(subsBefore);
  });
});

describe("revisit from Settings", () => {
  it("replay writes false so the dashboard shows the walkthrough again, and finishing records it as seen again", async () => {
    const { user, cookie } = await signUp("replay@example.test");
    await tour(cookie, true);
    expect(seen(user.id)).toBe(true);
    expect((await tour(cookie, false)).status).toBe(200);
    expect(seen(user.id)).toBe(false);
    await tour(cookie, true);
    expect(seen(user.id)).toBe(true);
  });
});

describe("refresh, logout and login", () => {
  it("survives a refresh (a fresh process reading the same datastore)", async () => {
    const { user, cookie } = await signUp("refresh@example.test");
    await tour(cookie, true);
    vi.resetModules();
    const fresh = await import("@/lib/db");
    expect(fresh.findProfileByUserId(user.id)?.dashboardTourCompleted).toBe(true);
  });

  it("survives logging out and back in, and is not shown again", async () => {
    const { user, cookie } = await signUp("relogin@example.test");
    await tour(cookie, true);

    const out = await post("auth/logout", {}, cookie);
    expect(out.status).toBeLessThan(400);

    const back = await post("auth/login", { email: "relogin@example.test", password: "Tester-pass-123!" });
    expect(back.status).toBe(200);
    expect(seen(user.id)).toBe(true);
  });
});

describe("multiple accounts on one device or browser", () => {
  it("is per account: one member finishing or replaying never changes another's", async () => {
    const a = await signUp("shared-a@example.test");
    const b = await signUp("shared-b@example.test");
    expect([seen(a.user.id), seen(b.user.id)]).toEqual([false, false]);

    await tour(a.cookie, true);
    expect([seen(a.user.id), seen(b.user.id)]).toEqual([true, false]);

    await tour(b.cookie, true);
    await tour(a.cookie, false);
    expect([seen(a.user.id), seen(b.user.id)]).toEqual([false, true]);
  });

  it("only ever writes the signed-in member's own profile: there is no user id in the request", async () => {
    const a = await signUp("own-a@example.test");
    const b = await signUp("own-b@example.test");
    const res = await post("profile/tour", { completed: true, userId: b.user.id }, a.cookie);
    expect(res.status).toBe(200);
    expect([seen(a.user.id), seen(b.user.id)]).toEqual([true, false]);
  });
});

describe("rejections", () => {
  it("requires a signed-in member", async () => {
    const res = await tour(undefined, true);
    expect(res.status).toBe(401);
  });

  it("rejects a non-boolean value and leaves the flag alone", async () => {
    const { user, cookie } = await signUp("bad@example.test");
    for (const bad of ["true", 1, null, undefined]) expect((await tour(cookie, bad)).status).toBe(400);
    expect(seen(user.id)).toBe(false);
  });

  it("answers 404 for an account with no profile and creates nothing", async () => {
    const noProfile = fx.db.createUserWithRole("noprofile@example.test", "x", "member", null);
    const res = await tour(fx.cookie(noProfile.id), true);
    expect(res.status).toBe(404);
    expect(fx.db.findProfileByUserId(noProfile.id)).toBeUndefined();
  });
});
