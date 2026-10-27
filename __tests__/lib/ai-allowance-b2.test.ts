// Stage B2 (owner decisions 2026-10-27): AI budgets are set in euros, a member can use at most a share of their 30-day allowance in any 24 hours,
// staff can pause AI for one member, and the owner is alerted at 50% and 80% of the emergency ceiling.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const MODEL = "claude-sonnet-5-5";
const KEYS = [
  "AI_ALLOWANCE_FREE_EUR", "AI_ALLOWANCE_TRIAL_EUR", "AI_ALLOWANCE_PAID_EUR", "AI_ALLOWANCE_COMPLIMENTARY_EUR", "AI_STAFF_EUR", "AI_APP_CEILING_EUR",
  "AI_TRIAL_POOL_EUR", "AI_PAID_POOL_EUR", "AI_COMPLIMENTARY_POOL_EUR", "AI_USD_PER_EUR", "AI_DAILY_SHARE", "ANTHROPIC_MODEL",
  "AI_ALLOWANCE_PAID_USD",
] as const;
const saved: Record<string, string | undefined> = {};
let fx: IapFixture;

function setEuroBudgets(over: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  Object.assign(process.env, {
    AI_ALLOWANCE_FREE_EUR: "0", AI_ALLOWANCE_TRIAL_EUR: "0.75", AI_ALLOWANCE_PAID_EUR: "3", AI_ALLOWANCE_COMPLIMENTARY_EUR: "3",
    AI_STAFF_EUR: "10", AI_TRIAL_POOL_EUR: "20", AI_PAID_POOL_EUR: "60", AI_COMPLIMENTARY_POOL_EUR: "30", AI_APP_CEILING_EUR: "120",
    AI_USD_PER_EUR: "1.05", ANTHROPIC_MODEL: MODEL, ...over,
  });
}

async function paidMember(email: string) {
  const u = fx.db.createUserWithRole(email, "x", "member", null);
  const now = new Date().toISOString();
  fx.db.saveProfile({ userId: u.id, fullName: "Paid", createdAt: now, updatedAt: now } as never);
  fx.db.saveDigitalEntitlement({
    id: `app_store:${u.id}`, userId: u.id, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64),
    environment: "production", currentPeriodEnd: new Date(Date.now() + 40 * DAY).toISOString(), autoRenewing: true, trial: false, grantedByUserId: null,
    note: null, revokedAt: null, createdAt: now, updatedAt: now,
  });
  return u;
}

// One chat message on Sonnet 5.5, about 1.7 US cents as the provider would report it.
const chatParams = { model: MODEL, max_tokens: 1000, system: [{ type: "text", text: "s".repeat(4000) }], messages: [{ role: "user", content: "hello" }] };
const chatUsage = { input_tokens: 5000, cache_read_input_tokens: 1200, output_tokens: 650 };

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  fx = await createFixture();
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("budgets are set in euros and converted at a conservative rate", () => {
  it("each euro budget becomes euros x AI_USD_PER_EUR in dollars, the currency the metering uses", async () => {
    setEuroBudgets();
    const { aiAllowanceBudgets, aiPoolBudgets } = await import("@/lib/ai-allowance");
    expect(aiAllowanceBudgets().paid).toBeCloseTo(3.15, 10);
    expect(aiAllowanceBudgets().trial).toBeCloseTo(0.7875, 10);
    expect(aiAllowanceBudgets().free).toBe(0);
    expect(aiPoolBudgets().ceiling).toBeCloseTo(126, 10);
  });

  it("an unset or implausible rate falls back to 1.05; the older dollar setting is read only when no euro one is set", async () => {
    setEuroBudgets({ AI_USD_PER_EUR: "40" });
    const { aiAllowanceBudgets, aiUsdPerEur } = await import("@/lib/ai-allowance");
    expect(aiUsdPerEur()).toBe(1.05);
    delete process.env.AI_ALLOWANCE_PAID_EUR;
    process.env.AI_ALLOWANCE_PAID_USD = "2.5";
    expect(aiAllowanceBudgets().paid).toBe(2.5);
  });

  it("staff see a member's allowance in euros, matching the settings", async () => {
    setEuroBudgets();
    const u = await paidMember("eur-status@example.test");
    const { memberAllowanceStatus } = await import("@/lib/ai-allowance");
    expect(memberAllowanceStatus(u.id)).toMatchObject({ kind: "paid", paused: false, budgetEur: 3, spentEur: 0, dailyCapEur: 1, spentTodayEur: 0 });
  });
});

describe("the daily cap: at most a third of the 30-day allowance in any 24 hours", () => {
  it("refuses once a day's share is used, with the daily message, and the spend stays under the cap", async () => {
    setEuroBudgets({ AI_DAILY_SHARE: String(1 / 3) });
    const u = await paidMember("daily@example.test");
    const { beginAiCall, AiAllowanceError } = await import("@/lib/ai-metering");
    const { DAILY_LIMIT_MESSAGE, checkAiAllowance } = await import("@/lib/ai-allowance");

    let refused: InstanceType<typeof AiAllowanceError> | null = null;
    for (let i = 0; i < 500 && !refused; i++) {
      try {
        beginAiCall({ userId: u.id, feature: "coach_chat", params: chatParams as never }).settle(chatUsage);
      } catch (err) {
        refused = err as InstanceType<typeof AiAllowanceError>;
      }
    }
    expect(refused?.message).toBe(DAILY_LIMIT_MESSAGE);
    const spentUsd = fx.db.findAiUsageLogsByUserId(u.id).reduce((s, l) => s + l.costUsd, 0);
    expect(spentUsd).toBeLessThanOrEqual(3.15 / 3 + 1e-9);
    expect(spentUsd).toBeGreaterThan(3.15 / 3 - 0.05);
    // The friendly pre-check answers the same once the day's spend itself has reached the cap (the reservation above also counts a call's maximum).
    fx.db.createAiUsageLog({ id: "top-up", userId: u.id, feature: "coach_chat", model: MODEL, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.1, allowanceKind: "paid", createdAt: new Date().toISOString() } as never);
    expect(checkAiAllowance(u.id)).toMatchObject({ ok: false, reason: "reached", message: DAILY_LIMIT_MESSAGE });
  });
});

describe("staff can pause AI for one member", () => {
  it("a paused member is refused before anything is reserved or sent; resuming restores it", async () => {
    setEuroBudgets();
    const u = await paidMember("paused@example.test");
    const { beginAiCall } = await import("@/lib/ai-metering");
    const { checkAiAllowance, AI_PAUSED_MESSAGE } = await import("@/lib/ai-allowance");

    fx.db.saveProfile({ ...fx.db.findProfileByUserId(u.id)!, aiPausedAt: new Date().toISOString() });
    expect(checkAiAllowance(u.id)).toMatchObject({ ok: false, reason: "paused", message: AI_PAUSED_MESSAGE });
    expect(() => beginAiCall({ userId: u.id, feature: "coach_chat", params: chatParams as never })).toThrow(AI_PAUSED_MESSAGE);
    expect(fx.db.listAiReservations()).toEqual([]);

    fx.db.saveProfile({ ...fx.db.findProfileByUserId(u.id)!, aiPausedAt: null });
    expect(checkAiAllowance(u.id).ok).toBe(true);
  });

  it("the staff route needs members.grantTier: an admin can pause, a coach cannot", async () => {
    setEuroBudgets();
    const u = await paidMember("pause-route@example.test");
    const admin = fx.db.createUserWithRole("pause-admin@example.test", "x", "admin", null);
    const coach = fx.db.createUserWithRole("pause-coach@example.test", "x", "coach", null);
    const { POST } = await import("@/app/api/staff/members/[userId]/ai-pause/route");
    const { NextRequest } = await import("next/server");
    const req = (cookie: string, paused: boolean) =>
      new NextRequest(`http://localhost/api/staff/members/${u.id}/ai-pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ paused }),
      });
    const params = { params: Promise.resolve({ userId: u.id }) };

    expect((await POST(req(fx.cookie(coach.id), true), params)).status).toBe(403);
    expect(fx.db.findProfileByUserId(u.id)!.aiPausedAt ?? null).toBeNull();

    expect((await POST(req(fx.cookie(admin.id), true), params)).status).toBe(200);
    expect(fx.db.findProfileByUserId(u.id)!.aiPausedAt).toBeTruthy();
    expect((await POST(req(fx.cookie(admin.id), false), params)).status).toBe(200);
    expect(fx.db.findProfileByUserId(u.id)!.aiPausedAt).toBeNull();
  });
});

describe("the owner is alerted at 50% and 80% of the emergency ceiling", () => {
  it("once per threshold a month, to the primary gym's admin managers only, in euros", async () => {
    setEuroBudgets({ AI_APP_CEILING_EUR: "1" });
    const owner = fx.db.createUserWithRole("owner@example.test", "x", "admin_manager", null);
    const { aiSpendAlertJob } = await import("@/lib/jobs/ai-spend-alert");

    expect(await aiSpendAlertJob.run()).toMatch(/no alert/);

    // 0.60 USD of a 1.05 USD ceiling: past 50%, under 80%.
    fx.db.createAiUsageLog({ id: "l1", userId: null, feature: "coach_summary", model: MODEL, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.6, createdAt: new Date().toISOString() } as never);
    expect(await aiSpendAlertJob.run()).toMatch(/alerted [1-9]\d* owners?/);
    expect(await aiSpendAlertJob.run()).toMatch(/alerted 0 owners/);
    // Another gym's admin manager is never told about the platform-wide ceiling.
    const otherGym = fx.db.findStaffUsers().find((u) => u.role === "admin_manager" && u.gymId)!;
    expect(fx.db.findNotificationsByUserId(otherGym.id).filter((n) => n.type === "ai_spend_alert")).toEqual([]);
    const alerts = fx.db.findNotificationsByUserId(owner.id).filter((n) => n.type === "ai_spend_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("50%");
    expect(alerts[0].body).toContain("€1.00");
  });
});

describe("cycle-phase guidance is part of the App subscription; the phase itself is free", () => {
  it("a Free member gets the estimate with the guidance fields empty", async () => {
    const free = fx.db.createUserWithRole("cycle-free@example.test", "x", "member", null);
    const now = new Date().toISOString();
    fx.db.saveProfile({ userId: free.id, fullName: "F", gender: "Female", cycleTrackingEligible: true, cycleTrackingEnabled: true, createdAt: now, updatedAt: now } as never);
    const lastPeriod = new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10);
    const settings = { userId: free.id, lastPeriodStartDate: lastPeriod, averageCycleLength: 28, averagePeriodLength: 5, updatedAt: now } as never;
    const { memberPhaseEstimateForViewer, memberPhaseEstimate } = await import("@/lib/cycle-phase-data");

    const full = memberPhaseEstimate(free.id, settings);
    const shown = memberPhaseEstimateForViewer(free.id, settings);
    expect(full?.trainingGuidance).toBeTruthy();
    expect(shown).toMatchObject({ phase: full?.phase, trainingGuidance: "", intensityGuidance: "", recoveryGuidance: "", readinessNote: "" });
  });
});

describe("members never see that AI has a limit (owner decision 2026-10-27)", () => {
  it("every member-facing pause message reads as a pause with an end, with no allowance, limit or amount", async () => {
    const { allowanceMessage, DAILY_LIMIT_MESSAGE, TRIAL_AI_UNAVAILABLE_MESSAGE, ALLOWANCE_UNAVAILABLE_MESSAGE } = await import("@/lib/ai-allowance");
    const messages = [
      allowanceMessage("paid", "2026-11-14T10:00:00.000Z"),
      allowanceMessage("complimentary", null),
      allowanceMessage("free", null),
      allowanceMessage("trial", null),
      DAILY_LIMIT_MESSAGE,
      TRIAL_AI_UNAVAILABLE_MESSAGE,
      ALLOWANCE_UNAVAILABLE_MESSAGE,
    ];
    for (const m of messages) expect(m).not.toMatch(/allowance|limit|quota|€|\$|\d+(\.\d+)? ?(eur|usd)/i);
    expect(allowanceMessage("paid", "2026-11-14T10:00:00.000Z")).toBe("AI coaching will be ready again on 14 Nov. Everything else in the app works as normal.");
  });
});
