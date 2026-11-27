// Tenant branding against the real routes: a gym sets its own logo and accent, nobody can set another gym's, unreadable colours and unsafe logo links are refused,
// and the app's session check reports the gym's look (the S&C default when nothing is set).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contrastRatio, DEFAULT_ACCENT, resolveBranding, validateBranding } from "@/lib/gym-branding";
import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

function gymB() {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
  });
}
async function call(method: "GET" | "PUT", userId: string, body?: unknown) {
  const mod = await import("@/app/api/staff/gym/branding/route");
  const req = new NextRequest("http://localhost/api/staff/gym/branding", { method, headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

beforeEach(async () => {
  fx = await createFixture();
  gymB();
});
afterEach(() => fx.cleanup());

describe("the rules", () => {
  it("accepts a readable colour, refuses a dark one, and the default gold is itself readable", () => {
    expect(contrastRatio(DEFAULT_ACCENT, "#0A1526")).toBeGreaterThanOrEqual(4.5);
    expect(validateBranding({ accentColor: "#4DA3FF" }, undefined)).toMatchObject({ ok: true });
    expect(validateBranding({ accentColor: "#101820" }, undefined)).toMatchObject({ ok: false });
    for (const bad of ["red", "#FFF", "#GGGGGG", "javascript:1", 5]) expect(validateBranding({ accentColor: bad }, undefined)).toMatchObject({ ok: false });
  });

  it("only takes a plain https image link as a logo", () => {
    expect(validateBranding({ logoUrl: "https://cdn.example.test/logo.png" }, undefined)).toMatchObject({ ok: true });
    for (const bad of ["http://cdn.example.test/logo.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://u:p@cdn.example.test/logo.png", "https://cdn.example.test/logo.html", "not a url"]) {
      expect(validateBranding({ logoUrl: bad }, undefined)).toMatchObject({ ok: false });
    }
  });

  it("keeps what is not sent, clears with null, and falls back to the S&C look when nothing is set", () => {
    const first = validateBranding({ accentColor: "#4DA3FF", logoUrl: "https://cdn.example.test/l.svg" }, undefined);
    if (!first.ok) throw new Error("expected ok");
    const second = validateBranding({ accentColor: null }, first.branding);
    expect(second).toMatchObject({ ok: true, branding: { accentColor: null, logoUrl: "https://cdn.example.test/l.svg" } });
    expect(resolveBranding({ name: "X" })).toMatchObject({ accentColor: DEFAULT_ACCENT, custom: false, logoUrl: null });
    expect(validateBranding({}, undefined)).toMatchObject({ ok: false });
  });
});

describe("the route", () => {
  it("a gym's admin sets its own branding, and it is stored on that gym only", async () => {
    const res = await call("PUT", fx.adminB.id, { accentColor: "#4da3ff", logoUrl: "https://cdn.example.test/b.png" });
    expect(res.status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.branding).toEqual({ accentColor: "#4DA3FF", logoUrl: "https://cdn.example.test/b.png", logoBackground: null });
    expect((await (await call("GET", fx.adminB.id)).json()).data.resolved).toMatchObject({ accentColor: "#4DA3FF", custom: true });
  });

  it("refuses a dark colour and an unsafe logo with a 400, and changes nothing", async () => {
    expect((await call("PUT", fx.adminB.id, { accentColor: "#101820" })).status).toBe(400);
    expect((await call("PUT", fx.adminB.id, { logoUrl: "http://x.test/a.png" })).status).toBe(400);
    expect(fx.db.findGymById(GYM_B)?.branding).toBeUndefined();
  });

  it("a coach cannot set branding, a member cannot, and S&C's own brand cannot be changed here", async () => {
    expect((await call("PUT", fx.memberB.id, { accentColor: "#4DA3FF" })).status).toBe(403);
    expect((await call("PUT", fx.adminA.id, { accentColor: "#4DA3FF" })).status).toBe(403);
    expect(fx.db.findGymById(GYM_B)?.branding).toBeUndefined();
  });

  it("there is no way to name another gym: the target is always the caller's own", async () => {
    expect((await call("PUT", fx.adminB.id, { gymId: "someone-else", accentColor: "#4DA3FF" })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.branding?.accentColor).toBe("#4DA3FF");
  });
});

describe("what the app is told", () => {
  it("the session check carries the gym's look, and the S&C default for a gym that set nothing", async () => {
    const me = await import("@/app/api/mobile/auth/me/route");
    const ask = (userId: string) => me.GET(new NextRequest("http://localhost/api/mobile/auth/me", { headers: { Cookie: fx.cookie(userId) } }));
    expect((await (await ask(fx.memberB.id)).json()).branding).toMatchObject({ accentColor: DEFAULT_ACCENT, custom: false });
    await call("PUT", fx.adminB.id, { accentColor: "#4DA3FF" });
    expect((await (await ask(fx.memberB.id)).json()).branding).toMatchObject({ name: "Gym B", accentColor: "#4DA3FF", custom: true });
  });
});
