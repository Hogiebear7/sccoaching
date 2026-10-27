// Shared AI pools (lib/ai-allowance.ts, lib/db.ts reserveAiBudget): a trial pool across accounts, a paid pool that trial/free/complimentary/staff use cannot
// consume, complimentary counted on its own, an emergency ceiling, and a trial that is only represented as available while the pool can honour it.
// Real datastore, real reservation; the provider is a stand-in. All amounts are TEST values.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const KEYS = [
  "AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD",
  "AI_STAFF_USD", "AI_APP_CEILING_USD", "AI_TRIAL_POOL_USD", "AI_PAID_POOL_USD", "AI_COMPLIMENTARY_POOL_USD", "ANTHROPIC_MODEL",
] as const;
const saved: Record<string, string | undefined> = {};
let fx: IapFixture;

// Opus 4.8 test model: a 2,000-character request with max 1,000 output tokens reserves about this much (see ai-metering.test.ts).
const RESERVE = ((1000 * 10 + 1000 * 25) * 1.1) / 1_000_000;
const DEAR_COST = (1000 * 5 + 1000 * 25) / 1_000_000; // what the stand-in provider reports for one call: 1,000 in + 1,000 out

function budgets(over: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  const v: Record<string, string> = {
    AI_ALLOWANCE_FREE_USD: "9", AI_ALLOWANCE_TRIAL_USD: "9", AI_ALLOWANCE_PAID_USD: "9", AI_ALLOWANCE_COMPLIMENTARY_USD: "9",
    AI_STAFF_USD: "500", AI_APP_CEILING_USD: "1000", AI_TRIAL_POOL_USD: "500", AI_PAID_POOL_USD: "500", AI_COMPLIMENTARY_POOL_USD: "500", ...over,
  };
  for (const k of KEYS) {
    if (k === "ANTHROPIC_MODEL") continue;
    if (v[k] === undefined) delete process.env[k];
    else process.env[k] = v[k];
  }
}

async function grant(userId: string, trial: boolean) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`, userId, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64), environment: "production",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), autoRenewing: true, trial, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now,
  });
}

const request = () => ({ model: "claude-opus-4-8", max_tokens: 1000, messages: [{ role: "user" as const, content: "x".repeat(2000) }] });
const usage = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1000 };

// One call through the real reservation; resolves true if it ran, false (with the error) if refused.
async function call(userId: string | null, feature: "coach_chat" | "food_photo_scan" | "staff_member_summary"): Promise<{ ran: boolean; error?: { code: string; message: string } }> {
  const { beginAiCall } = await import("@/lib/ai-metering");
  try {
    beginAiCall({ userId, feature, params: request() as never }).settle(usage);
    return { ran: true };
  } catch (err) {
    return { ran: false, error: err as { code: string; message: string } };
  }
}

async function runUntilRefused(userIds: (string | null)[], feature: "coach_chat" | "food_photo_scan" | "staff_member_summary", cap = 60): Promise<number> {
  let ran = 0;
  for (let i = 0; i < cap; i++) {
    const r = await call(userIds[i % userIds.length], feature);
    if (!r.ran) return ran;
    ran++;
  }
  return ran;
}

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  fx = await createFixture();
  process.env.ANTHROPIC_MODEL = "claude-opus-4-8";
  budgets();
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("one shared trial pool across accounts", () => {
  it("a trial the store has CONFIRMED is honoured even when the pool is full (the pool decides whether a NEW trial may start, not whether a live one is served), up to the member's own trial allowance", async () => {
    budgets({ AI_TRIAL_POOL_USD: String(RESERVE + DEAR_COST / 2), AI_ALLOWANCE_TRIAL_USD: String(DEAR_COST + RESERVE + 0.001) });
    const a = fx.memberA.id, b = fx.memberB.id;
    await grant(a, true);
    await grant(b, true);
    expect((await call(a, "coach_chat")).ran).toBe(true);
    expect((await call(b, "coach_chat")).ran).toBe(true); // pool is over, yet the confirmed trial is served
    // ...but each is still bounded by its own trial allowance.
    expect((await call(a, "coach_chat")).ran).toBe(true);
    const refused = await call(a, "coach_chat");
    expect(refused.ran).toBe(false);
    expect(refused.error).toMatchObject({ code: "ai_allowance_reached" });
  });

  it("free-tier members on a full pool are refused with a plain 'unavailable on free trials' message", async () => {
    budgets({ AI_TRIAL_POOL_USD: String(RESERVE + DEAR_COST / 2) });
    expect((await call(fx.memberA.id, "food_photo_scan")).ran).toBe(true);
    const refused = await call(fx.memberB.id, "food_photo_scan");
    expect(refused.ran).toBe(false);
    expect(refused.error).toMatchObject({ code: "ai_allowance_unavailable" });
    expect(refused.error?.message).toMatch(/aren't available on free trials right now/);
    expect(refused.error?.message).toMatch(/subscription .* unaffected/);
    expect(refused.error?.message).not.toMatch(/\$|[0-9]\.[0-9]/);
  });

  it("free-tier use shares that pool too (acquisition spend), so it cannot be a side door around it", async () => {
    budgets({ AI_TRIAL_POOL_USD: String(RESERVE + DEAR_COST / 2) });
    await grant(fx.memberA.id, true);
    expect((await call(fx.memberA.id, "coach_chat")).ran).toBe(true);
    // memberB has no plan: the free group, drawing on the same pool.
    expect((await call(fx.memberB.id, "food_photo_scan")).ran).toBe(false);
  });
});

describe("paid subscribers' capacity cannot be consumed by trial, free, complimentary or staff use", () => {
  it("with the ceiling only just above the paid pool, trials, staff and complimentary together are stopped long before they reach the paid pool, and paid calls still run", async () => {
    // Paid pool = 5 reservations. Ceiling = 6 reservations. So everything that is not paid can use at most about ONE reservation's worth of ceiling.
    budgets({ AI_PAID_POOL_USD: String(RESERVE * 5 + 0.0005), AI_APP_CEILING_USD: String(RESERVE * 6 + 0.0005) });
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    const paidUser = fx.memberA.id, trialUser = fx.memberB.id;
    const compUser = fx.db.createUserWithRole("comp@example.test", "x", "member", null).id;
    await grant(paidUser, false);
    await grant(trialUser, true);
    grantStaffDigitalEntitlement({ userId: compUser, grantedByUserId: fx.adminA.id });

    // Everyone who is not paid tries as hard as they can first.
    const trialRan = await runUntilRefused([trialUser], "coach_chat");
    const staffRan = await runUntilRefused([fx.adminA.id, null], "staff_member_summary");
    const compRan = await runUntilRefused([compUser], "coach_chat");
    expect(trialRan + staffRan + compRan).toBeLessThanOrEqual(2);

    // Paid use is untouched: it can still make (nearly) its whole pool.
    const paidRan = await runUntilRefused([paidUser], "coach_chat");
    expect(paidRan).toBeGreaterThanOrEqual(4);
  });

  it("without any trial or staff activity the paid pool alone is what limits paid use", async () => {
    budgets({ AI_PAID_POOL_USD: String(RESERVE + DEAR_COST * 1.5) });
    await grant(fx.memberA.id, false);
    const ran = await runUntilRefused([fx.memberA.id], "coach_chat");
    expect(ran).toBe(2); // two calls settle at DEAR_COST each, the third no longer fits the pool
    const refused = await call(fx.memberA.id, "coach_chat");
    expect(refused.error).toMatchObject({ code: "ai_allowance_unavailable" });
  });

  it("concurrent trial, staff and paid requests: non-paid never take the paid pool's share, paid still gets exactly its pool", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    budgets({ AI_PAID_POOL_USD: String(RESERVE * 4 + 0.0005), AI_APP_CEILING_USD: String(RESERVE * 6 + 0.0005) });
    await grant(fx.memberA.id, false);
    await grant(fx.memberB.id, true);
    const reached = { paid: 0, other: 0 };
    const slow = (bucket: "paid" | "other") => ({ messages: { create: async () => ((reached[bucket]++), await new Promise((r) => setTimeout(r, 15)), { id: "m", type: "message", role: "assistant", content: [], usage }) } });
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 6; i++) {
      jobs.push(meteredCreate(slow("other") as never, { userId: fx.memberB.id, feature: "coach_chat" }, request() as never).catch(() => undefined));
      jobs.push(meteredCreate(slow("other") as never, { userId: i % 2 ? fx.adminA.id : null, feature: "staff_member_summary" }, request() as never).catch(() => undefined));
      jobs.push(meteredCreate(slow("paid") as never, { userId: fx.memberA.id, feature: "coach_chat" }, request() as never).catch(() => undefined));
    }
    await Promise.all(jobs);
    // The six-reservation ceiling minus the four-reservation paid pool leaves room for ONE non-paid reservation at a time, never more than two settle.
    expect(reached.other).toBeLessThanOrEqual(2);
    expect(reached.paid).toBe(4);
  });
});

describe("complimentary access is counted explicitly", () => {
  it("has its own pool and its own tag: a complimentary pool that is full stops complimentary AI only, and complimentary use never appears as paid", async () => {
    budgets({ AI_COMPLIMENTARY_POOL_USD: String(RESERVE + DEAR_COST / 2) });
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    const comp1 = fx.memberB.id;
    const comp2 = fx.db.createUserWithRole("comp2@example.test", "x", "member", null).id;
    grantStaffDigitalEntitlement({ userId: comp1, grantedByUserId: fx.adminA.id });
    grantStaffDigitalEntitlement({ userId: comp2, grantedByUserId: fx.adminA.id });
    await grant(fx.memberA.id, false);
    expect((await call(comp1, "coach_chat")).ran).toBe(true);
    expect((await call(comp2, "coach_chat")).ran).toBe(false);
    expect((await call(fx.memberA.id, "coach_chat")).ran).toBe(true); // paid is unaffected
    expect(fx.db.findAiUsageLogsByUserId(comp1).map((l) => l.allowanceKind)).toEqual(["complimentary"]);
  });
});

describe("the emergency ceiling is a last resort and can still stop everything", () => {
  it("reaching it refuses paid subscribers too, with no amount shown; it does not promise uninterrupted paid access", async () => {
    budgets({ AI_APP_CEILING_USD: String(RESERVE * 2 + 0.0005) });
    await grant(fx.memberA.id, false);
    expect((await runUntilRefused([fx.memberA.id], "coach_chat"))).toBeGreaterThanOrEqual(1);
    const refused = await call(fx.memberA.id, "coach_chat");
    expect(refused.ran).toBe(false);
    expect(refused.error).toMatchObject({ code: "ai_allowance_unavailable" });
    expect(refused.error?.message).not.toMatch(/\$|[0-9]\.[0-9]/);
  });

  it("a ceiling below the paid pool is a configuration error: purchases stay blocked", async () => {
    const { aiAllowanceConfigured, aiPoolsConsistent } = await import("@/lib/ai-allowance");
    expect(aiAllowanceConfigured()).toBe(true);
    budgets({ AI_APP_CEILING_USD: "100", AI_PAID_POOL_USD: "200" });
    expect(aiPoolsConsistent()).toBe(false);
    expect(aiAllowanceConfigured()).toBe(false);
  });

  it("all nine budgets are required to configure: any missing shared pool blocks purchases", async () => {
    const { aiAllowanceConfigured } = await import("@/lib/ai-allowance");
    for (const k of ["AI_TRIAL_POOL_USD", "AI_PAID_POOL_USD", "AI_COMPLIMENTARY_POOL_USD", "AI_STAFF_USD", "AI_APP_CEILING_USD"] as const) {
      budgets();
      delete process.env[k];
      expect(aiAllowanceConfigured(), k).toBe(false);
    }
  });
});

describe("a trial is only represented as available while the pool can honour it", () => {
  const perTrial = 0.25;

  it("counts what each LIVE trial is still entitled to, so many trials starting at once cannot oversell the pool", async () => {
    const { trialCapacity } = await import("@/lib/ai-allowance");
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial), AI_TRIAL_POOL_USD: String(perTrial * 3) });
    expect(trialCapacity()).toEqual({ available: true });
    await grant(fx.memberA.id, true); // 0.25 committed of 0.75: room for 2 more
    expect(trialCapacity()).toEqual({ available: true });
    await grant(fx.memberB.id, true); // 0.50 committed: room for exactly 1 more
    expect(trialCapacity()).toEqual({ available: true });
    const third = fx.db.createUserWithRole("t3@example.test", "x", "member", null);
    await grant(third.id, true); // 0.75 committed: none left
    expect(trialCapacity()).toEqual({ available: false, reason: "pool_full" });
  });

  it("unavailable when the pool has been used, when the ceiling or paid reserve leaves no room, and when the budgets are not configured", async () => {
    const { trialCapacity } = await import("@/lib/ai-allowance");
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial), AI_TRIAL_POOL_USD: "0.2" });
    expect(trialCapacity()).toEqual({ available: false, reason: "pool_full" });
    // The ceiling minus the paid pool's unused remainder leaves less than one trial.
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial), AI_PAID_POOL_USD: "10", AI_APP_CEILING_USD: "10.1" });
    expect(trialCapacity()).toEqual({ available: false, reason: "ceiling_reached" });
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial) });
    delete process.env.AI_PAID_POOL_USD;
    expect(trialCapacity()).toEqual({ available: false, reason: "not_configured" });
  });

  it("in development, with nothing configured, there is no AI limit to protect", async () => {
    const { trialCapacity } = await import("@/lib/ai-allowance");
    for (const k of KEYS) delete process.env[k];
    expect(trialCapacity()).toEqual({ available: true });
  });

  it("the billing catalog tells the app: trialAvailable true while the pool can honour a trial, false when it cannot", async () => {
    const { GET } = await import("@/app/api/mobile/billing/catalog/route");
    const read = async () => {
      const res = await GET(new NextRequest("http://localhost/api/mobile/billing/catalog", { headers: { Cookie: fx.cookie(fx.memberA.id) } }));
      return (await res.json()).data.plans as { trialAvailable: boolean }[];
    };
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial), AI_TRIAL_POOL_USD: "5" });
    const open = await read();
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((p) => p.trialAvailable === true)).toBe(true);
    budgets({ AI_ALLOWANCE_TRIAL_USD: String(perTrial), AI_TRIAL_POOL_USD: "0.1" });
    expect((await read()).every((p) => p.trialAvailable === false)).toBe(true);
  });
});
