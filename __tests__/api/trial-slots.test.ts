// Trial capacity is claimed on the SERVER, atomically, BEFORE our purchase flow starts (purchase-context?trial=1). Mocked store; real routes and datastore.
// LIMIT these tests cannot remove: the stores decide eligibility and can start a trial outside our flow. A store-confirmed trial is honoured, never rejected.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppStoreFixture, type AppStoreFixture } from "../helpers/app-store-fixture";

const DAY = 86_400_000;
const MESSAGE = "Free trials are temporarily unavailable. Please try again later.";
// Fixture budgets (TEST values): per-trial 0.25, trial pool 5, paid pool 20, ceiling 50.
let fx: AppStoreFixture;

const trialContext = async (userId: string) => {
  const { GET } = await import("@/app/api/mobile/billing/app-store/purchase-context/route");
  return GET(new NextRequest("http://localhost/api/mobile/billing/app-store/purchase-context?trial=1", { headers: { Cookie: fx.cookie(userId) } }));
};
const paidContext = (userId: string) => fx.context(userId);
const newMember = (n: string) => fx.db.createUserWithRole(`${n}@example.test`, "x", "member", null).id;

beforeEach(async () => {
  fx = await createAppStoreFixture();
  process.env.AI_TRIAL_POOL_USD = "0.5"; // room for exactly two trials of 0.25
});
afterEach(() => fx.cleanup());

describe("a trial's capacity is claimed before the store checkout starts", () => {
  it("simultaneous starts: 3 members ask at once with room for 2 -> exactly 2 get the binding, the third is told plainly and receives NO binding", async () => {
    const ids = [fx.memberA.id, fx.memberB.id, newMember("third")];
    const results = await Promise.all(ids.map((id) => trialContext(id)));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    const refused = bodies.find((_b, i) => results[i].status === 409);
    expect(refused).toMatchObject({ success: false, code: "trial_unavailable", message: MESSAGE });
    expect(JSON.stringify(refused)).not.toMatch(/appAccountToken/);
    expect(bodies.filter((b) => b.data?.appAccountToken)).toHaveLength(2);
  });

  it("is idempotent: the same member asking again (a retry) keeps one claim and does not use up a second place", async () => {
    expect((await trialContext(fx.memberA.id)).status).toBe(200);
    expect((await trialContext(fx.memberA.id)).status).toBe(200);
    expect((await trialContext(fx.memberB.id)).status).toBe(200); // still room for the second
    expect((await trialContext(newMember("third"))).status).toBe(409);
  });

  it("an abandoned checkout frees its place when the claim expires, with no cleanup call and no lock held during the store sheet", async () => {
    const { reserveTrialStart, TRIAL_SLOT_TTL_MS } = await import("@/lib/ai-allowance");
    const t0 = Date.now();
    process.env.AI_TRIAL_POOL_USD = "0.25"; // one place
    expect(reserveTrialStart(fx.memberA.id, t0)).toEqual({ ok: true }); // synchronous: one datastore turn, finished before the app opens the store
    expect(reserveTrialStart(fx.memberB.id, t0 + 1000)).toMatchObject({ ok: false, reason: "pool_full" });
    expect(reserveTrialStart(fx.memberB.id, t0 + TRIAL_SLOT_TTL_MS + 1)).toEqual({ ok: true });
  });

  it("the purchase-context call never calls the store while it claims capacity (nothing slow runs inside the claim)", async () => {
    let storeCalls = 0;
    const original = fx.adapter.fetchStatus.bind(fx.adapter);
    fx.adapter.fetchStatus = ((...a: Parameters<typeof original>) => (storeCalls++, original(...a))) as typeof original;
    await trialContext(fx.memberA.id);
    expect(storeCalls).toBe(0);
  });

  it("a PAID purchase is a separate, explicit request: it does not claim trial capacity, and is not blocked by a full trial pool", async () => {
    await trialContext(fx.memberA.id);
    await trialContext(fx.memberB.id);
    expect((await trialContext(newMember("third"))).status).toBe(409);
    const paid = await paidContext(newMember("buyer"));
    expect(paid.status).toBe(200);
    expect((await paid.json()).data.appAccountToken).toBeTruthy();
  });

  it("the catalog counts live claims too: it stops saying a trial is available once the places are claimed", async () => {
    const read = async () => ((await (await fx.catalog(fx.memberA.id)).json()).data.plans as { trialAvailable: boolean }[]).every((p) => p.trialAvailable);
    expect(await read()).toBe(true);
    await trialContext(fx.memberA.id);
    expect(await read()).toBe(true); // one place left
    await trialContext(fx.memberB.id);
    expect(await read()).toBe(false);
  });

  it("with nothing configured (development) there is no AI limit to protect, so the claim is simply granted", async () => {
    for (const k of ["AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD", "AI_STAFF_USD", "AI_APP_CEILING_USD", "AI_TRIAL_POOL_USD", "AI_PAID_POOL_USD", "AI_COMPLIMENTARY_POOL_USD"]) delete process.env[k];
    const { reserveTrialStart } = await import("@/lib/ai-allowance");
    expect(reserveTrialStart(fx.memberA.id)).toEqual({ ok: true });
  });
});

describe("a trial the store confirms outside our flow is honoured, not rejected", () => {
  const TRIAL_TX = { transactionId: "tx-outside", offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0 };

  it("with the trial pool full and no claim, the verified trial is accepted, and its member gets the promised AI up to their own trial allowance", async () => {
    await trialContext(fx.memberA.id);
    await trialContext(fx.memberB.id); // pool now claimed by A and B
    const outsider = newMember("outsider"); // never went through our flow: e.g. started from the App Store page or an offer code
    const res = await fx.claim(outsider, "otx-outside", { tx: { ...TRIAL_TX, expiresDate: Date.now() + 7 * DAY } });
    expect(res.status).toBe(200); // never rejected
    expect(fx.db.findDigitalEntitlement(outsider, "app_store")).toMatchObject({ trial: true, status: "active" });

    const { beginAiCall } = await import("@/lib/ai-metering");
    const request = { model: "claude-opus-4-8", max_tokens: 100, messages: [{ role: "user" as const, content: "hello" }] };
    const ticket = beginAiCall({ userId: outsider, feature: "coach_chat", params: request as never });
    ticket.settle({ input_tokens: 100, output_tokens: 50 });
    expect(fx.db.findAiUsageLogsByUserId(outsider).map((l) => l.allowanceKind)).toEqual(["trial"]);
  });

  it("but it is still bounded: by the member's own trial allowance, so the overage per outside trial is capped", async () => {
    const outsider = newMember("outsider2");
    await fx.claim(outsider, "otx-outside2", { tx: { ...TRIAL_TX, transactionId: "tx-o2", expiresDate: Date.now() + 7 * DAY } });
    fx.db.createAiUsageLog({ id: "spent", userId: outsider, feature: "coach_chat", model: "claude-opus-4-8", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.25, allowanceKind: "trial", createdAt: new Date().toISOString() });
    const { beginAiCall } = await import("@/lib/ai-metering");
    const request = { model: "claude-opus-4-8", max_tokens: 100, messages: [{ role: "user" as const, content: "hello" }] };
    expect(() => beginAiCall({ userId: outsider, feature: "coach_chat", params: request as never })).toThrow(/made the most of AI coaching during your free trial/);
  });

  it("paid subscribers' AI is untouched by outside trials: the paid reserve stays out of the trials' reach", async () => {
    const outsider = newMember("outsider3");
    await fx.claim(outsider, "otx-outside3", { tx: { ...TRIAL_TX, transactionId: "tx-o3", expiresDate: Date.now() + 7 * DAY } });
    // Ceiling just above the paid pool: a trial call may use at most the sliver above it, but the paid member still can.
    process.env.AI_PAID_POOL_USD = "1";
    process.env.AI_APP_CEILING_USD = "1.05";
    const { beginAiCall } = await import("@/lib/ai-metering");
    const request = { model: "claude-opus-4-8", max_tokens: 1000, messages: [{ role: "user" as const, content: "x".repeat(2000) }] };
    // A reservation of about $0.0385 does not fit the sliver (0.05) twice, but the paid member's calls are not blocked by the trial's.
    const t1 = beginAiCall({ userId: outsider, feature: "coach_chat", params: request as never });
    t1.settle({ input_tokens: 1000, output_tokens: 1000 });
    expect(() => beginAiCall({ userId: outsider, feature: "coach_chat", params: request as never })).toThrow(/aren't available on free trials/);
    const payer = newMember("payer");
    await fx.claim(payer, "otx-payer", { tx: { transactionId: "tx-payer", price: 12990, currency: "EUR" } });
    const paid = beginAiCall({ userId: payer, feature: "coach_chat", params: request as never });
    paid.settle({ input_tokens: 1000, output_tokens: 1000 });
    expect(fx.db.findAiUsageLogsByUserId(payer).map((l) => l.allowanceKind)).toEqual(["paid"]);
  });
});
