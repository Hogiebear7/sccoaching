// Low-severity hardening from the post-merge audit:
//   - staff pause/resume must not touch a row billed through Google Play (the member manages it in Google Play);
//   - a refused Revolut event delivered repeatedly writes one audit row, not one per delivery.
//
// REAL routes, REAL service and REAL temporary datastore; only the Google adapter is faked. The Revolut webhook is signed with a
// throwaway test secret generated here. No network, no provider, no real token.
import { createHmac } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const DAY = 86_400_000;
const PLAY_TOKEN = "fake-play-token-lo-1";
const REVOLUT_SECRET = "wsk_test_only_not_a_real_secret";
let savedSecret: string | undefined;

const row = () => fx.db.findSubscriptionByUserId(fx.memberA.id)!;
const rejected = () => fx.db.findIapEvents({ type: "staff_write_rejected" });
const conflicts = () => fx.db.findIapEvents({ type: "provider_conflict_rejected" });

async function staffPauseResume(body: Record<string, unknown>, userId = fx.memberA.id) {
  const { POST } = await import("@/app/api/staff/members/[userId]/pause/route");
  return POST(
    new NextRequest(`http://localhost/api/staff/members/${userId}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.cookie(fx.adminA.id) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId }) }
  );
}

async function revolut(event: string, orderId: string) {
  const { POST } = await import("@/app/api/billing/webhook/route");
  const raw = JSON.stringify({ event, order_id: orderId });
  const ts = String(Date.now());
  const sig = `v1=${createHmac("sha256", REVOLUT_SECRET).update(`v1.${ts}.${raw}`).digest("hex")}`;
  return POST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", headers: { "revolut-signature": sig, "revolut-request-timestamp": ts }, body: raw }));
}

beforeEach(async () => {
  savedSecret = process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
  process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = REVOLUT_SECRET;
  fx = await createPlayFixture();
});
afterEach(() => {
  fx.cleanup();
  if (savedSecret === undefined) delete process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
  else process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = savedSecret;
});

describe("staff pause and resume on a Google Play row", () => {
  async function livePlay() {
    await fx.claim(fx.memberA.id, PLAY_TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
    expect(row()).toMatchObject({ provider: "google_play", status: "active", providerSubscriptionId: PLAY_TOKEN });
  }

  it("refuses a pause with the stable code play_billing_active and changes nothing", async () => {
    await livePlay();
    const before = row();
    const purchase = fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN);
    const acks = fx.adapter.ackCalls.length;

    const res = await staffPauseResume({ action: "pause", duration: "1m" });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "play_billing_active" });
    expect(body.message).toContain("Google Play");
    expect(row()).toEqual(before);
    expect(row()).toMatchObject({ provider: "google_play", providerSubscriptionId: PLAY_TOKEN, status: "active", currentPeriodEnd: before.currentPeriodEnd });
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toEqual(purchase);
    // Nothing is sent to Google: no acknowledgement, no cancel, no pause.
    expect(fx.adapter.ackCalls).toHaveLength(acks);
  });

  it("refuses a resume of a row Google Play itself has paused, keeping the Play status", async () => {
    await livePlay();
    fx.adapter.setSnapshot(PLAY_TOKEN, { state: "SUBSCRIPTION_STATE_PAUSED" });
    await fx.rtdn(fx.subscriptionEvent(PLAY_TOKEN, 10));
    expect(row().status).toBe("paused");
    const before = row();

    const res = await staffPauseResume({ action: "resume" });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("play_billing_active");
    expect(row()).toEqual(before);
    expect(row().status).toBe("paused");
  });

  it("refuses for a cancelled-but-paid Play subscription and keeps its paid-through date", async () => {
    await livePlay();
    fx.adapter.setSnapshot(PLAY_TOKEN, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false });
    await fx.rtdn(fx.subscriptionEvent(PLAY_TOKEN, 3));
    const before = row();
    expect(before.status).toBe("active");

    expect((await staffPauseResume({ action: "pause", duration: "2w" })).status).toBe(409);
    expect((await staffPauseResume({ action: "resume" })).status).toBe(409);
    expect(row()).toEqual(before);
  });

  it("refuses for an expired Play row too, and leaves the token and ownership intact", async () => {
    await livePlay();
    fx.db.saveSubscription({ ...row(), status: "inactive", currentPeriodEnd: new Date(Date.now() - DAY).toISOString() });
    const before = row();
    const purchase = fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN);

    expect((await staffPauseResume({ action: "pause", duration: "1m" })).status).toBe(409);
    expect((await staffPauseResume({ action: "resume" })).status).toBe(409);
    expect(row()).toEqual(before);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toEqual(purchase);
  });

  it("audits each refused attempt with the code and action only (no token)", async () => {
    await livePlay();
    await staffPauseResume({ action: "pause", duration: "1m" });
    await staffPauseResume({ action: "resume" });
    const events = rejected();
    expect(events.map((e) => e.detail)).toEqual([
      { code: "play_billing_active", action: "pause", source: "staff_pause_resume" },
      { code: "play_billing_active", action: "resume", source: "staff_pause_resume" },
    ]);
    expect(JSON.stringify(events)).not.toContain(PLAY_TOKEN);
  });

  it("still pauses and resumes a manually administered (non-Play) membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "none", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() });
    expect((await staffPauseResume({ action: "pause", duration: "1m" })).status).toBe(200);
    expect(row().status).toBe("paused");
    expect((await staffPauseResume({ action: "resume" })).status).toBe(200);
    expect(row().status).toBe("active");
    expect(rejected()).toHaveLength(0);
  });

  it("an invalid action is still a 400, not a Play refusal", async () => {
    await livePlay();
    expect((await staffPauseResume({ action: "nonsense" })).status).toBe(400);
  });
});

describe("Revolut refused-event audit dedupe", () => {
  async function liveStripeRow() {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_live_stripe", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() });
  }

  it("records one audit row however many times the same refused event is delivered, and always answers the same", async () => {
    await liveStripeRow();
    const before = row();
    const first = await revolut("ORDER_COMPLETED", "sub_live_stripe");
    const again = await revolut("ORDER_COMPLETED", "sub_live_stripe");
    const third = await revolut("ORDER_COMPLETED", "sub_live_stripe");

    for (const res of [first, again, third]) {
      expect(res.status).toBe(200);
      expect((await res.json()).message).toBe("Not applied: another provider's subscription is already active.");
    }
    expect(conflicts()).toHaveLength(1);
    expect(row()).toEqual(before);
  });

  it("still audits a DIFFERENT refused event for the same order separately", async () => {
    await liveStripeRow();
    await revolut("ORDER_COMPLETED", "sub_live_stripe");
    await revolut("ORDER_CANCELLED", "sub_live_stripe");
    await revolut("ORDER_CANCELLED", "sub_live_stripe");
    expect(conflicts()).toHaveLength(2);
  });

  it("stores only a hash: no order reference, payload field or secret reaches the audit row or the ledger", async () => {
    await liveStripeRow();
    await revolut("ORDER_COMPLETED", "sub_live_stripe");
    const ledger = JSON.stringify(JSON.parse(readFileSync(path.join(fx.dir, "db.json"), "utf8")).paymentEvents);
    const audit = JSON.stringify(conflicts());
    for (const forbidden of ["sub_live_stripe", REVOLUT_SECRET]) {
      expect(ledger).not.toContain(forbidden);
      expect(audit).not.toContain(forbidden);
    }
    expect(Object.keys(conflicts()[0].detail).sort()).toEqual(["code", "existingProvider", "incomingProvider", "referenceHash", "source"]);
  });

  it("does not change how an accepted Revolut event for its own row is handled", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "pending", provider: "revolut", providerSubscriptionId: "rev_order_mine", currentPeriodEnd: null });
    expect((await revolut("ORDER_COMPLETED", "rev_order_mine")).status).toBe(200);
    expect(row()).toMatchObject({ provider: "revolut", status: "active" });
    expect(conflicts()).toHaveLength(0);
  });
});
