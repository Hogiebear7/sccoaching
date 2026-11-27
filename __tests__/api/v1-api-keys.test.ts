// API keys for a gym and the /api/v1 routes they open: a key acts only on its own gym, is stored hashed, is shown once, can be revoked, is rate limited, and an unpaid gym cannot invite.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashApiKey, readKeyFromRequest } from "@/lib/gym-api-keys";
import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;
const T = "2026-01-01T00:00:00.000Z";

function gym(id: string, slug: string, ownerUserId: string, extra: Record<string, unknown> = {}) {
  fx.db.createGym({ id, slug, name: id === GYM_B ? "Gym B" : "Other Gym", tagline: null, description: null, ownerUserId, contactEmail: "c@example.test", contactPhone: null, addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T, ...extra } as never);
}
const staffReq = (path: string, method: string, userId: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: body === undefined ? undefined : JSON.stringify(body) });
const apiReq = (path: string, key: string | null, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });

async function makeKey(userId = fx.adminB.id, name = "Zapier") {
  const { POST } = await import("@/app/api/staff/integrations/api-keys/route");
  const res = await POST(staffReq("/api/staff/integrations/api-keys", "POST", userId, { name }));
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  fx = await createFixture();
  gym(GYM_B, "gym-b", fx.adminB.id);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("making and revoking keys", () => {
  it("shows the key once, stores only a hash, and lists it without the key", async () => {
    const made = await makeKey();
    expect(made.status).toBe(201);
    const key = made.json.data.key as string;
    expect(key).toMatch(/^scp_[0-9a-f]{48}$/);
    const stored = fx.db.findGymById(GYM_B)!.apiKeys![0];
    expect(stored.hash).toBe(hashApiKey(key));
    expect(JSON.stringify(stored)).not.toContain(key);

    const { GET } = await import("@/app/api/staff/integrations/api-keys/route");
    const list = await (await GET(staffReq("/api/staff/integrations/api-keys", "GET", fx.adminB.id))).json();
    expect(list.data.keys).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(key);
    expect(JSON.stringify(list)).not.toContain(stored.hash);
  });

  it("needs a name, stops at five, and only the gym's own admin can revoke", async () => {
    expect((await makeKey(fx.adminB.id, "")).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await makeKey(fx.adminB.id, `k${i}`)).status).toBe(201);
    expect((await makeKey(fx.adminB.id, "k6")).status).toBe(409);

    const { DELETE } = await import("@/app/api/staff/integrations/api-keys/[id]/route");
    const id = fx.db.findGymById(GYM_B)!.apiKeys![0].id;
    const ctx = { params: Promise.resolve({ id }) };
    expect((await DELETE(staffReq("/x", "DELETE", fx.adminA.id), ctx)).status).toBe(404); // the primary gym's admin has no record here
    expect((await DELETE(staffReq("/x", "DELETE", fx.adminB.id), ctx)).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)!.apiKeys![0].revokedAt).toBeTruthy();
  });
});

describe("what a key can do", () => {
  it("rejects a missing, wrong, malformed or revoked key", async () => {
    const { GET } = await import("@/app/api/v1/classes/route");
    expect((await GET(apiReq("/api/v1/classes", null))).status).toBe(401);
    expect((await GET(apiReq("/api/v1/classes", "scp_nope"))).status).toBe(401);
    expect((await GET(apiReq("/api/v1/classes", `scp_${"0".repeat(48)}`))).status).toBe(401);

    const key = (await makeKey()).json.data.key as string;
    expect((await GET(apiReq("/api/v1/classes", key))).status).toBe(200);
    const { DELETE } = await import("@/app/api/staff/integrations/api-keys/[id]/route");
    await DELETE(staffReq("/x", "DELETE", fx.adminB.id), { params: Promise.resolve({ id: fx.db.findGymById(GYM_B)!.apiKeys![0].id }) });
    expect((await GET(apiReq("/api/v1/classes", key))).status).toBe(401);
  });

  it("reads the key from either header", () => {
    expect(readKeyFromRequest(new NextRequest("http://x.test", { headers: { Authorization: "Bearer scp_a" } }))).toBe("scp_a");
    expect(readKeyFromRequest(new NextRequest("http://x.test", { headers: { "X-API-Key": "scp_b" } }))).toBe("scp_b");
    expect(readKeyFromRequest(new NextRequest("http://x.test"))).toBeNull();
  });

  it("looks a member up only inside the key's own gym", async () => {
    const key = (await makeKey()).json.data.key as string;
    const { GET } = await import("@/app/api/v1/members/route");
    const own = fx.db.findUserById(fx.memberB.id)!;
    const found = await (await GET(apiReq(`/api/v1/members?email=${encodeURIComponent(own.email)}`, key))).json();
    expect(found.data.found).toBe(true);
    expect(found.data.member.email).toBe(own.email);
    // a member of the primary gym, a made-up address, and no email at all
    const other = fx.db.findUserById(fx.memberA.id)!;
    expect((await (await GET(apiReq(`/api/v1/members?email=${encodeURIComponent(other.email)}`, key))).json()).data).toEqual({ found: false });
    expect((await (await GET(apiReq("/api/v1/members?email=nobody@example.test", key))).json()).data).toEqual({ found: false });
    expect((await GET(apiReq("/api/v1/members", key))).status).toBe(400);
  });

  it("sends an invite for its own gym, validates, and is refused for a gym that is not live yet", async () => {
    const key = (await makeKey()).json.data.key as string;
    const { POST } = await import("@/app/api/v1/invites/route");
    expect((await POST(apiReq("/api/v1/invites", key, { method: "POST", body: { email: "not-an-email", tier: "membership" } }))).status).toBe(400);
    expect((await POST(apiReq("/api/v1/invites", key, { method: "POST", body: { email: "new@example.test", tier: "free" } }))).status).toBe(400);
    const ok = await POST(apiReq("/api/v1/invites", key, { method: "POST", body: { email: "new@example.test", tier: "membership" } }));
    expect(ok.status).toBe(201);
    expect(fx.db.findInvites().some((i) => i.email === "new@example.test" && i.invitedByStaffId === fx.adminB.id)).toBe(true);

    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true"); // gym B has no payment record
    const held = await POST(apiReq("/api/v1/invites", key, { method: "POST", body: { email: "held@example.test", tier: "membership" } }));
    expect(held.status).toBe(423);
    expect(fx.db.findInvites().some((i) => i.email === "held@example.test")).toBe(false);
  });

  it("is rate limited per key", async () => {
    const key = (await makeKey()).json.data.key as string;
    const { GET } = await import("@/app/api/v1/classes/route");
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await GET(apiReq("/api/v1/classes", key))).status;
    expect(last).toBe(429);
  });
});
