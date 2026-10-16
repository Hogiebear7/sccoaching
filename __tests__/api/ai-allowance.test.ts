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
    interpretFoodDescription: spy("interpretFoodDescription"),
    identifyFoodPhoto: spy("identifyFoodPhoto"),
    extractReceiptItems: spy("extractReceiptItems"),
    generateExerciseAlternatives: spy("generateExerciseAlternatives"),
  };
});

const DAY = 86_400_000;
let fx: IapFixture;
const saved: Record<string, string | undefined> = {};
const KEYS = ["AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD"] as const;
type Kind = "free" | "trial" | "paid" | "complimentary";
const ENV_FOR: Record<Kind, (typeof KEYS)[number]> = { free: KEYS[0], trial: KEYS[1], paid: KEYS[2], complimentary: KEYS[3] };

// TEST values only: free 0.1, trial 0.25, paid 1, complimentary 0.5.
function budgets(over: Partial<Record<Kind, string | undefined>> = {}) {
  const v: Record<Kind, string | undefined> = { free: "0.1", trial: "0.25", paid: "1", complimentary: "0.5", ...over };
  for (const k of Object.keys(v) as Kind[]) {
    if (v[k] === undefined) delete process.env[ENV_FOR[k]];
    else process.env[ENV_FOR[k]] = v[k];
  }
}

function log(userId: string, costUsd: number, ageMs = 0, allowanceKind?: Kind) {
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
    ...(allowanceKind ? { allowanceKind } : {}),
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
  budgets();
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("configuration", () => {
  it("is configured only when ALL FOUR budgets are valid numbers, and 0 is valid (it means none)", async () => {
    const { aiAllowanceConfigured, aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    expect(aiAllowanceConfigured()).toBe(true);
    for (const kind of ["free", "trial", "paid", "complimentary"] as const) {
      for (const bad of [undefined, "", "-1", "abc", "NaN"]) {
        budgets({ [kind]: bad });
        expect(aiAllowanceConfigured()).toBe(false);
      }
    }
    budgets({ free: "0", complimentary: "0" });
    expect(aiAllowanceConfigured()).toBe(true);
    budgets({ free: "0.2", trial: "0.5", paid: "2.5", complimentary: "0.75" });
    expect(aiAllowanceBudgets()).toEqual({ free: 0.2, trial: 0.5, paid: 2.5, complimentary: 0.75 });
  });

  it("with no budget set nothing is enforced (the behaviour before this existed), and says so", async () => {
    budgets({ free: undefined, trial: undefined, paid: undefined, complimentary: undefined });
    await grant(fx.memberA.id);
    log(fx.memberA.id, 999);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, enforced: false });
  });

  it("with ANY budget set enforcement is on, and a group whose budget is missing is refused as unavailable (fail closed), not allowed", async () => {
    budgets({ paid: undefined });
    await grant(fx.memberA.id);
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, reason: "unavailable", kind: "paid" });
  });
});

describe("a rolling 30-day cost allowance, per member", () => {
  it("allows use under the budget, reports what is left, and refuses once it is reached", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 0.4, 0, "paid");
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, enforced: true, kind: "paid" });
    log(fx.memberA.id, 0.6, 0, "paid");
    const refused = await check(fx.memberA.id);
    expect(refused).toMatchObject({ ok: false, kind: "paid" });
    expect((refused as { message: string }).message).not.toMatch(/unlimited|fair.use/i);
  });

  it("use older than 30 days does not count, and the allowance frees up as the oldest use ages out", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 5, 31 * DAY, "paid"); // outside the window
    expect((await check(fx.memberA.id)).ok).toBe(true);

    log(fx.memberA.id, 0.7, 20 * DAY, "paid");
    log(fx.memberA.id, 0.7, 2 * DAY, "paid");
    const refused = await check(fx.memberA.id);
    expect(refused.ok).toBe(false);
    // The oldest in-window use (20 days ago) leaves the window in 10 days; that alone brings the total under the budget.
    const resets = new Date((refused as { resetsAt: string }).resetsAt).getTime();
    expect(Math.abs(resets - (Date.now() + 10 * DAY))).toBeLessThan(5_000);
  });

  it("one member's use never counts against another", async () => {
    await grant(fx.memberA.id);
    await grant(fx.memberB.id);
    log(fx.memberA.id, 50, 0, "paid");
    expect((await check(fx.memberA.id)).ok).toBe(false);
    expect((await check(fx.memberB.id)).ok).toBe(true);
  });

  it("is read from the shared datastore on every check: a fresh module instance (another server process) sees the same total", async () => {
    await grant(fx.memberA.id);
    log(fx.memberA.id, 2, 0, "paid");
    vi.resetModules(); // no in-memory state can survive this
    const fresh = await import("@/lib/ai-allowance");
    expect(fresh.checkAiAllowance(fx.memberA.id).ok).toBe(false);
  });
});

describe("four allowance groups, decided by what the member holds", () => {
  it("a member with no digital plan is in the free group, with its own (small) budget", async () => {
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, kind: "free" });
    log(fx.memberA.id, 0.1, 0, "free");
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, reason: "reached", kind: "free" });
  });

  it("a budget of 0 means none for that group: refused at once, with that group's message", async () => {
    budgets({ free: "0" });
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "free" });
  });

  it("a free-trial member is in the trial group", async () => {
    await grant(fx.memberA.id, { trial: true });
    log(fx.memberA.id, 0.3, 0, "trial");
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "trial" });
  });

  it("a staff-granted complimentary member is COMPLIMENTARY: bounded by its own budget, and neither a trial nor paid", async () => {
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberB.id, grantedByUserId: fx.adminA.id });
    expect(await check(fx.memberB.id)).toMatchObject({ ok: true, kind: "complimentary" });
    log(fx.memberB.id, 0.5, 0, "complimentary");
    const refused = await check(fx.memberB.id);
    expect(refused).toMatchObject({ ok: false, kind: "complimentary" });
    expect((refused as { message: string }).message).toMatch(/complimentary/i);
    // Complimentary use is not paid use and not trial use.
    expect((await import("@/lib/db")).aiSpendUsd(fx.db.findAiUsageLogsByUserId(fx.memberB.id), fx.memberB.id, "paid", 30 * DAY, Date.now())).toBe(0);
    expect((await import("@/lib/db")).aiSpendUsd(fx.db.findAiUsageLogsByUserId(fx.memberB.id), fx.memberB.id, "trial", null, Date.now())).toBe(0);
  });

  it("a trial alongside a complimentary grant is still the trial group: the grant does not turn it into paid", async () => {
    await grant(fx.memberA.id, { trial: true });
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberA.id, grantedByUserId: fx.adminA.id });
    expect((await check(fx.memberA.id)).kind).toBe("trial");
  });

  it("paid wins over trial and complimentary", async () => {
    await grant(fx.memberA.id);
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberA.id, grantedByUserId: fx.adminA.id });
    expect((await check(fx.memberA.id)).kind).toBe("paid");
  });

  it("usage rows written before groups existed (no tag) count toward every group except the trial", async () => {
    const db = await import("@/lib/db");
    log(fx.memberA.id, 0.2);
    expect(db.aiSpendUsd(fx.db.findAiUsageLogsByUserId(fx.memberA.id), fx.memberA.id, "paid", 30 * DAY, Date.now())).toBeCloseTo(0.2);
    expect(db.aiSpendUsd(fx.db.findAiUsageLogsByUserId(fx.memberA.id), fx.memberA.id, "trial", null, Date.now())).toBe(0);
  });
});

describe("trial accounting: one total per account, never replenished", () => {
  it("the trial total is for the whole trial: use from long ago still counts, and a cancelled, re-started or restored trial does not reset it", async () => {
    await grant(fx.memberA.id, { trial: true });
    log(fx.memberA.id, 0.25, 40 * DAY, "trial"); // older than any rolling window
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "trial" });

    // Cancelled during the trial (access continues to its end): same total.
    await grant(fx.memberA.id, { trial: true, status: "canceled", autoRenewing: false });
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "trial" });

    // Reinstall / restore / the same trial re-verified from the other store: a new entitlement row, same account, same total.
    await grant(fx.memberA.id, { trial: true, id: `google_play:${fx.memberA.id}`, source: "google_play" });
    expect(await check(fx.memberA.id)).toMatchObject({ ok: false, kind: "trial" });
  });

  it("conversion starts the PAID allowance fresh from zero: trial use never counts toward it", async () => {
    await grant(fx.memberA.id, { trial: true });
    log(fx.memberA.id, 0.25, 3 * DAY, "trial");
    expect((await check(fx.memberA.id)).ok).toBe(false);

    await grant(fx.memberA.id, { trial: false }); // the first paid period begins
    expect(await check(fx.memberA.id)).toMatchObject({ ok: true, kind: "paid", remainingUsd: 1 });
  });

  it("converting does not give the trial back: when the paid plan lapses the member is not in the trial group again", async () => {
    await grant(fx.memberA.id, { trial: false, status: "expired", currentPeriodEnd: new Date(Date.now() - 5 * DAY).toISOString() });
    expect((await check(fx.memberA.id)).kind).toBe("free");
  });
});

describe("enforced on every member AI route, before the provider is reached", () => {
  const call = (method: string, url: string, userId: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: body === undefined ? undefined : JSON.stringify(body) });

  async function consenting(userId: string) {
    fx.db.saveProfile({ ...(fx.db.findProfileByUserId(userId) ?? ({ userId } as never)), aiDataConsent: { grantedAt: "2026-10-01T00:00:00.000Z", version: 1 } } as never);
  }

  const PLAN_ROUTES: { name: string; run: (u: string) => Promise<Response> }[] = [
    { name: "AI coach chat", run: async (u) => (await import("@/app/api/ai/chat/route")).POST(call("POST", "/api/ai/chat", u, { content: "hi" })) },
    { name: "AI nutrition coach", run: async (u) => (await import("@/app/api/ai/nutrition-coach/route")).POST(call("POST", "/api/ai/nutrition-coach", u, { content: "hi" })) },
    { name: "programme generation", run: async (u) => (await import("@/app/api/mobile/programs/generate/route")).POST(call("POST", "/api/mobile/programs/generate", u, {})) },
    { name: "meal suggestions", run: async (u) => (await import("@/app/api/mobile/nutrition/meal-suggest/route")).POST(call("POST", "/api/mobile/nutrition/meal-suggest", u, {})) },
    { name: "tracker import", run: async (u) => (await import("@/app/api/mobile/tracker-import/scan/route")).POST(call("POST", "/api/mobile/tracker-import/scan", u, { imageBase64: "AAAA" })) },
  ];

  it.each(PLAN_ROUTES.map((r) => [r.name, r] as const))("%s: a member over the allowance gets 429 ai_allowance_reached and the provider is never called", async (_name, route) => {
    const user = fx.db.createUserWithRole("heavy@example.test", "x", "member", null);
    await consenting(user.id);
    await grant(user.id);
    log(user.id, 5, 0, "paid");
    const res = await route.run(user.id);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "ai_allowance_reached", kind: "paid", resetsAt: expect.any(String) });
    expect(body.message).toMatch(/AI allowance/);
    expect(reached.calls).toEqual([]);
  });

  // The routes a member WITHOUT the digital plan can still reach: the free group's budget applies.
  const FREE_ROUTES: { name: string; run: (u: string) => Promise<Response> }[] = [
    { name: "food description", run: async (u) => (await import("@/app/api/mobile/nutrition/food/describe/route")).POST(call("POST", "/api/mobile/nutrition/food/describe", u, { descriptionText: "a banana" })) },
    { name: "food photo / label scan", run: async (u) => (await import("@/app/api/mobile/nutrition/food/label-scan/route")).POST(call("POST", "/api/mobile/nutrition/food/label-scan", u, { imageBase64: "data:image/jpeg;base64,AAAA" })) },
    { name: "receipt scan", run: async (u) => (await import("@/app/api/mobile/nutrition/receipt-scan/route")).POST(call("POST", "/api/mobile/nutrition/receipt-scan", u, { imageBase64: "data:image/jpeg;base64,AAAA" })) },
  ];

  it.each(FREE_ROUTES.map((r) => [r.name, r] as const))("%s: a free member over the free allowance gets 429 and the provider is never called", async (_name, route) => {
    const user = fx.db.createUserWithRole("freeheavy@example.test", "x", "member", null);
    await consenting(user.id);
    log(user.id, 5, 0, "free");
    const res = await route.run(user.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "ai_allowance_reached", kind: "free" });
    expect(reached.calls).toEqual([]);
  });

  it("a member inside the allowance is not refused by it (the request reaches the provider stand-in)", async () => {
    const user = fx.db.createUserWithRole("light@example.test", "x", "member", null);
    await consenting(user.id);
    await grant(user.id);
    const res = await PLAN_ROUTES[0].run(user.id);
    expect(res.status).not.toBe(429);
    expect(reached.calls).toContain("createCoachChatStream");
  });

  it("the allowance is checked AFTER the plan check: a member without the digital plan still gets the 403 on plan-only features", async () => {
    const user = fx.db.createUserWithRole("none@example.test", "x", "member", null);
    await consenting(user.id);
    log(user.id, 100, 0, "free");
    expect((await PLAN_ROUTES[0].run(user.id)).status).toBe(403);
  });
});

describe("a plan is never sold with undefined AI cost", () => {
  it("the App Store purchase context is refused until all four budgets are set", async () => {
    fx.cleanup();
    const apple = await createAppStoreFixture();
    for (const k of KEYS) delete process.env[k];
    const res = await apple.context(apple.memberA.id);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");

    process.env.AI_ALLOWANCE_PAID_USD = "1";
    process.env.AI_ALLOWANCE_TRIAL_USD = "0.25";
    process.env.AI_ALLOWANCE_FREE_USD = "0.1";
    expect((await apple.context(apple.memberA.id)).status).toBe(503); // complimentary budget still unset
    process.env.AI_ALLOWANCE_COMPLIMENTARY_USD = "0";
    expect((await apple.context(apple.memberA.id)).status).toBe(200);
    apple.cleanup();
    fx = await createFixture(); // so afterEach has something to clean
  });
});
