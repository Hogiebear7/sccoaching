// The bounded AI allowance (lib/ai-allowance.ts): real datastore, real routes, the AI provider replaced by stand-ins that record whether they were reached.
// The budgets used here are TEST values; the real numbers are the owner's and live in the environment.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppStoreFixture } from "../helpers/app-store-fixture";
import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const reached = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  const spy = (name: string) =>
    vi.fn(async () => {
      reached.calls.push(name);
      throw new Error(`provider reached: ${name}`);
    });
  const stream = (name: string) =>
    vi.fn(() => {
      reached.calls.push(name);
      throw new Error(`provider reached: ${name}`);
    });
  return {
    ...actual,
    isAiConfigured: () => true,
    createCoachChatStream: stream("createCoachChatStream"),
    createNutritionCoachChatStream: stream("createNutritionCoachChatStream"),
    generateMealSuggestions: spy("generateMealSuggestions"),
    extractTrackerStats: spy("extractTrackerStats"),
    generateProgrammeSkeleton: spy("generateProgrammeSkeleton"),
    generateWorkoutReview: spy("generateWorkoutReview"),
  };
});

const DAY = 86_400_000;
let fx: IapFixture;
const saved: Record<string, string | undefined> = {};
const KEYS = ["AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_TRIAL_USD"] as const;

function budgets(paid?: string, trial?: string) {
  for (const [k, v] of [["AI_ALLOWANCE_PAID_USD", paid], ["AI_ALLOWANCE_TRIAL_USD", trial]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function log(userId: string, costUsd: number, ageMs = 0) {
  fx.db.createAiUsageLog({
    id: `l-${Math.random()}`,
    userId,
    feature: "coach_chat",
    model: "claude-opus-4-8",
    inputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 1,
    costUsd,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  } as never);
}

async function grant(userId: string, over: Partial<import("@/lib/db").DigitalEntitlementRecord> = {}) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`, userId, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64), environment: "production",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), autoRenewing: true, trial: false, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now, ...over,
  });
}

const check = async (userId: string) => (await import("@/lib/ai-allowance")).checkAiAllowance(userId);

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  reached.calls = [];
  fx = await createFixture();
  budgets("1", "0.25");
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("configuration", () => {
  it("is configured only when BOTH budgets are positive numbers", async () => {
    const { aiAllowanceConfigured, aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    expect(aiAllowanceConfigured()).toBe(true);
    for (const [paid, trial] of [[undefined, "0.25"], ["1", undefined], ["0", "0.25"], ["-1", "0.25"], ["abc", "0.25"], ["1", ""], ["NaN", "1"]] as const) {
      budgets(paid, trial);
      expect(aiAllowanceConfigured()).toBe(false);
    }
    budgets("2.5", "0.5");
    expect(aiAllowanceBudgets()).toEqual({ paidUsd: 2.5, trialUsd: 0.5 });
  });

  it("with no budget set nothing is enforced (the behaviour before this existed), and says so", async () => {
    budgets(undefined, undefined);
    await grant(fx.memberA.id);
    log(fx.memberA.id, 999);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, enforced: false });
  });
});

describe("a rolling 30-day cost allowance, per member", () => {
  it("allows use under the budget, reports what is left, and refuses once it is reached", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 0.4);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, enforced: true, kind: "paid" });
    log(fx.memberA.id, 0.6);
    const refused = await check(fx.memberA.id);
    expect(refused).toMatchObject({ ok: false, kind: "paid" });
    expect((refused as { message: string }).message).not.toMatch(/unlimited/i);
  });

  it("use older than 30 days does not count, and the allowance frees up as the oldest use ages out", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 5, 31 * DAY); // outside the window
    expect((await check(fx.memberA.id)).ok).toBe(true);

    log(fx.memberA.id, 0.7, 20 * DAY);
    log(fx.memberA.id, 0.7, 2 * DAY);
    const refused = await check(fx.memberA.id);
    expect(refused.ok).toBe(false);
    // The oldest in-window use (20 days ago) leaves the window in 10 days; that alone brings the total under the budget.
    const resets = new Date((refused as { resetsAt: string }).resetsAt).getTime();
    expect(Math.abs(resets - (Date.now() + 10 * DAY))).toBeLessThan(5_000);
  });

  it("one member's use never counts against another", async () => {
    await grant(fx.memberA.id);
    await grant(fx.memberB.id);
    log(fx.memberA.id, 50);
    expect((await check(fx.memberA.id)).ok).toBe(false);
    expect((await check(fx.memberB.id)).ok).toBe(true);
  });

  it("is read from the shared datastore on every check: a fresh module instance (another server process) sees the same total", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 2);
    vi.resetModules(); // no in-memory state can survive this
    const fresh = await import("@/lib/ai-allowance");
    expect(fresh.checkAiAllowance(fx.memberA.id).ok).toBe(false);
  });
});

describe("trial versus paid", () => {
  it("a member whose only live plan is a free trial gets the smaller trial allowance", async () => {
    await grant(fx.memberA.id, { trial: true });
    log(fx.memberA.id, 0.3);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "trial" });
  });

  it("the same use is fine on a paid plan, and on a complimentary grant", async () => {
    await grant(fx.memberA.id, { trial: false });
    log(fx.memberA.id, 0.3);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, kind: "paid" });

    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberB.id, grantedByUserId: fx.adminA.id });
    log(fx.memberB.id, 0.3);
    expect(await check(fx.memberB.id)).toMatchObject({ ok: true, kind: "paid" });
  });

  it("a trial alongside a complimentary grant is treated as paid: the grant is not a trial", async () => {
    await grant(fx.memberA.id, { trial: true });
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberA.id, grantedByUserId: fx.adminA.id });
    expect((await check(fx.memberA.id)).kind).toBe("paid");
  });

  it("when the trial converts, the larger paid allowance applies from the next check", async () => {
    await grant(fx.memberA.id, { trial: true });
    log(fx.memberA.id, 0.3);
    expect((await check(fx.memberA.id)).ok).toBe(false);
    await grant(fx.memberA.id, { trial: false });
    expect((await check(fx.memberA.id)).ok).toBe(true);
  });
});

describe("enforced on every AI route, before the provider is reached", () => {
  const call = (method: string, url: string, userId: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: body === undefined ? undefined : JSON.stringify(body) });

  async function consenting(userId: string) {
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(userId) ?? ({ userId } as never)), aiDataConsent: { grantedAt: "2026-10-01T00:00:00.000Z", version: 1 } } as never);
  }

  const ROUTES: { name: string; run: (u: string) => Promise<Response> }[] = [
    { name: "AI coach chat", run: async (u) => (await import("@/app/api/ai/chat/route")).POST(call("POST", "/api/ai/chat", u, { content: "hi" })) },
    { name: "AI nutrition coach", run: async (u) => (await import("@/app/api/ai/nutrition-coach/route")).POST(call("POST", "/api/ai/nutrition-coach", u, { content: "hi" })) },
    { name: "programme generation", run: async (u) => (await import("@/app/api/mobile/programs/generate/route")).POST(call("POST", "/api/mobile/programs/generate", u, {})) },
    { name: "meal suggestions", run: async (u) => (await import("@/app/api/mobile/nutrition/meal-suggest/route")).POST(call("POST", "/api/mobile/nutrition/meal-suggest", u, {})) },
    { name: "tracker import", run: async (u) => (await import("@/app/api/mobile/tracker-import/scan/route")).POST(call("POST", "/api/mobile/tracker-import/scan", u, { imageBase64: "AAAA" })) },
  ];

  it.each(ROUTES.map((r) => [r.name, r] as const))("%s: a member over the allowance gets 429 ai_allowance_reached and the provider is never called", async (_name, route) => {
    const user = fx.db.createUserWithRole("heavy@example.test", "x", "member", null);
    await consenting(user.id);
    await grant(user.id);
    log(user.id, 5);
    const res = await route.run(user.id);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "ai_allowance_reached", resetsAt: expect.any(String) });
    expect(reached.calls).toEqual([]);
  });

  it("a member inside the allowance is not refused by it (the request reaches the provider stand-in)", async () => {
    const user = fx.db.createUserWithRole("light@example.test", "x", "member", null);
    await consenting(user.id);
    await grant(user.id);
    const res = await ROUTES[0].run(user.id);
    expect(res.status).not.toBe(429);
    expect(reached.calls).toContain("createCoachChatStream");
  });

  it("the allowance is checked AFTER the plan check: a member without the digital plan still gets the 403, not a spend message", async () => {
    const user = fx.db.createUserWithRole("none@example.test", "x", "member", null);
    await consenting(user.id);
    log(user.id, 100);
    expect((await ROUTES[0].run(user.id)).status).toBe(403);
  });
});

describe("a plan is never sold with uncapped AI cost", () => {
  it("the App Store purchase context is refused until both budgets are set", async () => {
    fx.cleanup();
    const apple = await createAppStoreFixture();
    delete process.env.AI_ALLOWANCE_PAID_USD;
    delete process.env.AI_ALLOWANCE_TRIAL_USD;
    const res = await apple.context(apple.memberA.id);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");

    process.env.AI_ALLOWANCE_PAID_USD = "1";
    expect((await apple.context(apple.memberA.id)).status).toBe(503); // trial budget still unset
    process.env.AI_ALLOWANCE_TRIAL_USD = "0.25";
    expect((await apple.context(apple.memberA.id)).status).toBe(200);
    apple.cleanup();
    fx = await createFixture(); // so afterEach has something to clean
  });
});
