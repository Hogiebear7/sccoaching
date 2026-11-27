// The staff routes for a gym's webhooks: the secret is shown once, only the gym's own admin can manage them, bad addresses are refused with plain words.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;

function gymB() {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  } as never);
}

const req = (path: string, method: string, userId: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  fx = await createFixture();
  gymB();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("staff webhook routes", () => {
  it("adds a connection, shows the secret once, and never again", async () => {
    const { POST, GET } = await import("@/app/api/staff/integrations/webhooks/route");
    const created = await POST(req("/api/staff/integrations/webhooks", "POST", fx.adminB.id, { url: "https://8.8.8.8/hook", events: ["booking.created", "member.joined"] }));
    expect(created.status).toBe(201);
    const json = await created.json();
    expect(json.data.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(json.data.webhook.secretHint).toBe(`…${json.data.secret.slice(-4)}`);
    expect(JSON.stringify(json.data.webhook)).not.toContain(json.data.secret);

    const list = await (await GET(req("/api/staff/integrations/webhooks", "GET", fx.adminB.id))).json();
    expect(list.data.webhooks).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("whsec_");
  });

  it("refuses bad addresses, no events, duplicates and a sixth connection", async () => {
    const { POST } = await import("@/app/api/staff/integrations/webhooks/route");
    const add = (body: unknown) => POST(req("/api/staff/integrations/webhooks", "POST", fx.adminB.id, body));
    expect((await add({ url: "http://8.8.8.8/x", events: ["booking.created"] })).status).toBe(400);
    expect((await add({ url: "https://10.0.0.1/x", events: ["booking.created"] })).status).toBe(400);
    expect((await add({ url: "https://8.8.8.8/x", events: [] })).status).toBe(400);
    expect((await add({ url: "https://8.8.8.8/x", events: ["nope"] })).status).toBe(400);
    expect((await add({ url: "https://8.8.8.8/x", events: ["booking.created"] })).status).toBe(201);
    expect((await add({ url: "https://8.8.8.8/x", events: ["booking.created"] })).status).toBe(409);
    for (const n of [2, 3, 4, 5]) expect((await add({ url: `https://8.8.8.8/${n}`, events: ["booking.created"] })).status).toBe(201);
    expect((await add({ url: "https://8.8.8.8/6", events: ["booking.created"] })).status).toBe(409);
  });

  it("switches off, removes, and keeps each gym's connections to itself", async () => {
    const { POST } = await import("@/app/api/staff/integrations/webhooks/route");
    const { PATCH, DELETE } = await import("@/app/api/staff/integrations/webhooks/[id]/route");
    const created = await (await POST(req("/api/staff/integrations/webhooks", "POST", fx.adminB.id, { url: "https://8.8.8.8/hook", events: ["booking.created"] }))).json();
    const id = created.data.webhook.id as string;
    const ctx = { params: Promise.resolve({ id }) };

    const off = await PATCH(req(`/x/${id}`, "PATCH", fx.adminB.id, { enabled: false }), ctx);
    expect((await off.json()).data.webhook.enabled).toBe(false);
    expect(fx.db.findGymById(GYM_B)?.webhooks?.[0].enabled).toBe(false);

    // another gym's admin (the primary gym has no record here) and a signed-out caller get nothing
    expect((await DELETE(req(`/x/${id}`, "DELETE", fx.adminA.id), ctx)).status).toBe(404);
    expect((await DELETE(req(`/x/${id}`, "DELETE", null), ctx)).status).toBe(401);
    expect(fx.db.findGymById(GYM_B)?.webhooks).toHaveLength(1);

    expect((await DELETE(req(`/x/${id}`, "DELETE", fx.adminB.id), ctx)).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.webhooks).toHaveLength(0);
  });

  it("sends a test and reports plainly whether it arrived", async () => {
    const { POST } = await import("@/app/api/staff/integrations/webhooks/route");
    const { POST: TEST } = await import("@/app/api/staff/integrations/webhooks/[id]/test/route");
    const created = await (await POST(req("/api/staff/integrations/webhooks", "POST", fx.adminB.id, { url: "https://8.8.8.8/hook", events: ["booking.created"] }))).json();
    const ctx = { params: Promise.resolve({ id: created.data.webhook.id as string }) };

    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const ok = await TEST(req("/x/test", "POST", fx.adminB.id), ctx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).message).toMatch(/connection works/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const bad = await TEST(req("/x/test", "POST", fx.adminB.id), ctx);
    expect(bad.status).toBe(502);
    expect((await bad.json()).message).toMatch(/error \(500\)/);
  });
});
