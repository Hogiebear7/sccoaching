// Regression found by the end-to-end journeys: a manual write over an ENDED Google Play row used to inherit the old Play
// purchase token, billing option and paid period. An inherited past period end made a freshly granted Membership read
// as lapsed (so the conflict rules treated it as not active), and an inherited token is stale. Walking away from a Play
// row must clear all three. Real route handlers, real temporary datastore, fake provider.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const TOKEN = "fake-play-token-leaving";

const post = (url: string, userId: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: JSON.stringify(body) });

async function endPlayRow() {
  await fx.claim(fx.memberA.id, TOKEN);
  fx.adapter.setSnapshot(TOKEN, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 86_400_000 });
  await fx.rtdn(fx.subscriptionEvent(TOKEN, 13));
  expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toMatchObject({ provider: "google_play", status: "canceled" });
}

const row = () => fx.db.findSubscriptionByUserId(fx.memberA.id)!;
const expectClean = () => expect(row()).toMatchObject({ provider: "none", providerSubscriptionId: null, currentPeriodEnd: null });

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("a manual write over an ended Google Play row starts clean", () => {
  it("staff tier grant (Membership)", async () => {
    await endPlayRow();
    const { POST } = await import("@/app/api/staff/members/[userId]/tier/route");
    const res = await POST(post(`/api/staff/members/${fx.memberA.id}/tier`, fx.adminA.id, { tier: "membership" }), { params: Promise.resolve({ userId: fx.memberA.id }) });
    expect(res.status).toBe(200);
    expectClean();
    expect(row().billingOptionId).toBeNull();
  });

  it("admin activation", async () => {
    await endPlayRow();
    const { POST } = await import("@/app/api/admin/membership/activate/route");
    const res = await POST(post("/api/admin/membership/activate", fx.adminA.id, { userId: fx.memberA.id, packageId: fx.ids.membershipPackage }));
    expect(res.status).toBe(200);
    expectClean();
  });

  it("staff subscription override", async () => {
    await endPlayRow();
    const { POST } = await import("@/app/api/staff/members/[userId]/subscription/route");
    const res = await POST(post(`/api/staff/members/${fx.memberA.id}/subscription`, fx.adminA.id, { status: "active", packageId: fx.ids.membershipPackage }), {
      params: Promise.resolve({ userId: fx.memberA.id }),
    });
    expect(res.status).toBe(200);
    expectClean();
  });

  it("so a freshly granted Membership counts as active and blocks a Play claim", async () => {
    await endPlayRow();
    const { POST } = await import("@/app/api/staff/members/[userId]/tier/route");
    await POST(post(`/api/staff/members/${fx.memberA.id}/tier`, fx.adminA.id, { tier: "membership" }), { params: Promise.resolve({ userId: fx.memberA.id }) });

    expect((await fx.context(fx.memberA.id)).status).toBe(409);
    const claim = await fx.claim(fx.memberA.id, "fake-play-token-second");
    expect((await claim.json()).code).toBe("membership_active");
  });

  it("a Play purchase later granted still works (leaving Play does not affect entering it)", async () => {
    await endPlayRow();
    expect((await fx.claim(fx.memberA.id, "fake-play-token-third")).status).toBe(200);
    expect(row()).toMatchObject({ provider: "google_play", providerSubscriptionId: "fake-play-token-third", status: "active" });
  });
});
