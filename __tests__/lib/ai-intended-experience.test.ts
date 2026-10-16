// The intended trial and paid experience, run through the REAL metering (reservation headroom included) on claude-sonnet-5-5.
//
// WHAT IS MEASURED vs ASSUMED. The prices (published page), the request sizes (the real system prompts in lib/ai.ts, the real caps: 20 chat messages of history,
// photos resized to 1280 px by the app, notes at most 900 characters) and the reservation arithmetic are from the code. The TOKEN COUNTS the provider would report
// (image tokens, reply and thinking length, member-context size) are ASSUMPTIONS: no real usage has ever been logged. Change ASSUMED below and the answer changes.
//
// The "workout generation" is POST /api/mobile/programs/generate: one metered programme_generation call (generateProgrammeSkeleton, max_tokens 2000), gated by
// hasAccess(..., "workoutGenerate") and the allowance. It sends the system prompt plus a short instruction, NOT the member's history.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const KEYS = ["AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD", "AI_STAFF_USD", "AI_APP_CEILING_USD", "ANTHROPIC_MODEL"] as const;
const saved: Record<string, string | undefined> = {};
let fx: IapFixture;

const MODEL = "claude-sonnet-5-5";
const CHARS_PER_TOKEN = 3.5; // to turn assumed token counts into the text a request would carry

// Prompt sizes in characters, measured from lib/ai.ts (template literals, grounding clause included).
const SYSTEM_CHARS = { coach: 4133, photo: 2290, generation: 7275 /* freeform; structured is 6394 */ };

// ASSUMED provider-reported usage per call (tokens). Not measured.
const ASSUMED = {
  photo: { input: 2474, output: 700 }, // 1,800 image + 654 system + text; output includes thinking at medium effort
  generation: { cacheWrite: 2100, input: 250, output: 900 }, // system written to the 5-minute cache (never warm across days), tiny instruction, low effort
  chat: { context: 2000, userMsg: 80, system: 1181, output: 650, perHistoryExchange: 300, historyCapExchanges: 10 }, // route keeps the last 20 messages
};

function setBudgets(v: { trial?: string; paid: string }) {
  process.env.AI_ALLOWANCE_FREE_USD = "0";
  process.env.AI_ALLOWANCE_TRIAL_USD = v.trial ?? "0.9";
  process.env.AI_ALLOWANCE_PAID_USD = v.paid;
  process.env.AI_ALLOWANCE_COMPLIMENTARY_USD = v.paid;
  process.env.AI_STAFF_USD = "100";
  process.env.AI_APP_CEILING_USD = "10000";
  process.env.ANTHROPIC_MODEL = MODEL;
}

async function grant(userId: string, trial: boolean) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`, userId, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64), environment: "production",
    currentPeriodEnd: new Date(Date.now() + 40 * DAY).toISOString(), autoRenewing: true, trial, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now,
  });
}

type Outcome = { done: number; refusedAt: string | null; spent: number; calls: Record<string, number> };

// Runs the intended experience in order, day by day, through beginAiCall (reserve) and settle (assumed usage). Stops at the first refusal.
async function run(userId: string, plan: { days: number; photosPerDay: number; generations: number; chats: number }): Promise<Outcome> {
  const { beginAiCall } = await import("@/lib/ai-metering");
  const calls: Record<string, number> = { photo: 0, generation: 0, chat: 0 };
  let chatIndex = 0;
  let done = 0;
  const attempt = (kind: "photo" | "generation" | "chat") => {
    let params: { model: string; max_tokens: number; system: unknown; messages: unknown };
    let usage: { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens: number };
    if (kind === "photo") {
      params = {
        model: MODEL, max_tokens: 2000, system: [{ type: "text", text: "s".repeat(SYSTEM_CHARS.photo) }],
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } }, { type: "text", text: "Identify the food (or read the nutrition label) in this photo." }] }],
      };
      usage = { input_tokens: ASSUMED.photo.input, output_tokens: ASSUMED.photo.output };
    } else if (kind === "generation") {
      params = { model: MODEL, max_tokens: 2000, system: [{ type: "text", text: "s".repeat(SYSTEM_CHARS.generation) }], messages: [{ role: "user", content: "g".repeat(900) }] };
      usage = { input_tokens: ASSUMED.generation.input, cache_creation_input_tokens: ASSUMED.generation.cacheWrite, output_tokens: ASSUMED.generation.output };
    } else {
      const exchanges = Math.min(chatIndex, ASSUMED.chat.historyCapExchanges);
      const historyTokens = exchanges * ASSUMED.chat.perHistoryExchange;
      params = {
        model: MODEL, max_tokens: 4000,
        system: [{ type: "text", text: "s".repeat(SYSTEM_CHARS.coach) }, { type: "text", text: "c".repeat(Math.round(ASSUMED.chat.context * CHARS_PER_TOKEN)) }],
        messages: [{ role: "user", content: "h".repeat(Math.round((historyTokens + ASSUMED.chat.userMsg) * CHARS_PER_TOKEN)) }],
      };
      // The first message of the account writes the system prompt to the cache; later ones read it.
      usage = chatIndex === 0
        ? { input_tokens: ASSUMED.chat.context + ASSUMED.chat.userMsg + historyTokens, cache_creation_input_tokens: ASSUMED.chat.system, output_tokens: ASSUMED.chat.output }
        : { input_tokens: ASSUMED.chat.context + ASSUMED.chat.userMsg + historyTokens, cache_read_input_tokens: ASSUMED.chat.system, output_tokens: ASSUMED.chat.output };
      chatIndex++;
    }
    const ticket = beginAiCall({ userId, feature: kind === "photo" ? "food_photo_scan" : kind === "generation" ? "programme_generation" : "coach_chat", params: params as never });
    ticket.settle(usage);
    calls[kind]++;
    done++;
  };

  let refusedAt: string | null = null;
  try {
    for (let day = 1; day <= plan.days; day++) {
      for (let p = 0; p < plan.photosPerDay; p++) attempt("photo");
      if (Math.floor((day * plan.generations) / plan.days) > Math.floor(((day - 1) * plan.generations) / plan.days)) attempt("generation");
      const chatsToday = Math.floor((day * plan.chats) / plan.days) - Math.floor(((day - 1) * plan.chats) / plan.days);
      for (let c = 0; c < chatsToday; c++) attempt("chat");
    }
  } catch (err) {
    refusedAt = `${(err as { code?: string }).code ?? "error"} after ${done} calls (${JSON.stringify(calls)})`;
  }
  const spent = fx.db.findAiUsageLogsByUserId(userId).reduce((s, l) => s + l.costUsd, 0);
  return { done, refusedAt, spent, calls };
}

const TRIAL = (photosPerDay: number) => ({ days: 7, photosPerDay, generations: 7, chats: 10 });
const PAID = (photosPerDay: number) => ({ days: 30, photosPerDay, generations: 30, chats: 40 });

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  fx = await createFixture();
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the workout generation estimate applies to the actual route", () => {
  it("POST /api/mobile/programs/generate makes exactly one metered programme_generation call, capped at 2,000 output tokens, with a small input", async () => {
    const fs = await import("node:fs");
    const route = fs.readFileSync("app/api/mobile/programs/generate/route.ts", "utf8");
    expect(route.match(/generateProgrammeSkeleton\(/g)).toHaveLength(1);
    expect(route).toContain('"workoutGenerate"');
    expect(route).toContain("aiAllowanceRefusal(user.id)");
    const ai = fs.readFileSync("lib/ai.ts", "utf8").replace(/\r\n/g, "\n");
    const fn = ai.slice(ai.indexOf("export async function generateProgrammeSkeleton"), ai.indexOf("export function parseProgrammeCheckIn") > 0 ? ai.indexOf("export function parseProgrammeCheckIn") : undefined);
    expect(fn.match(/meteredCreate\(/g)).toHaveLength(1);
    expect(fn).toContain('feature: "programme_generation"');
    expect(fn).toContain("max_tokens: 2000");
    // The messages are the short instruction only: no member history is sent.
    expect(fn).toContain('messages: [{ role: "user", content: instruction }]');
  });
});

describe("intended experience on claude-sonnet-5-5 through the real reservation (ASSUMED token usage)", () => {
  it("TRIAL, 3 photos a day, 7 generations, 10 chats: completes at the proposed $0.75", async () => {
    setBudgets({ trial: "0.75", paid: "3" });
    await grant(fx.memberA.id, true);
    const r = await run(fx.memberA.id, TRIAL(3));
    console.log("trial 3/day @ $0.75:", JSON.stringify(r));
    expect(r.refusedAt).toBeNull();
  });

  it("TRIAL, 5 photos a day: the proposed $0.75 is NOT enough: about $0.67 is spent, but the 10th chat cannot START (it needs its maximum, about $0.08, in headroom)", async () => {
    setBudgets({ trial: "0.75", paid: "3" });
    await grant(fx.memberA.id, true);
    const r = await run(fx.memberA.id, TRIAL(5));
    console.log("trial 5/day @ $0.75:", JSON.stringify(r));
    expect(r.refusedAt).toMatch(/ai_allowance_reached/);
    expect(r.calls).toMatchObject({ photo: 35, generation: 7, chat: 9 });
    expect(r.spent).toBeLessThanOrEqual(0.75);
  });

  it("TRIAL, 5 photos a day: completes at $0.90", async () => {
    setBudgets({ trial: "0.9", paid: "3" });
    await grant(fx.memberA.id, true);
    const r = await run(fx.memberA.id, TRIAL(5));
    console.log("trial 5/day @ $0.90:", JSON.stringify(r));
    expect(r.refusedAt).toBeNull();
  });

  // [photos a day, paid budget, should the whole month fit?]
  for (const [ppd, budget, fits] of [[3, "2.0", false], [3, "2.5", true], [5, "3.0", false], [5, "3.5", true]] as const) {
    it(`PAID 30 days, ${ppd} photos a day, 30 generations, 40 chats at $${budget}: ${fits ? "completes" : "runs out"}`, async () => {
      setBudgets({ paid: budget });
      await grant(fx.memberA.id, false);
      const r = await run(fx.memberA.id, PAID(ppd));
      console.log(`paid ${ppd}/day @ $${budget}:`, JSON.stringify(r));
      if (fits) expect(r.refusedAt).toBeNull();
      else expect(r.refusedAt).toMatch(/ai_allowance_reached/);
      expect(r.spent).toBeLessThanOrEqual(Number(budget) + 1e-9);
    });
  }

  it("the same 30 days is a complimentary member's too when complimentary equals paid", async () => {
    setBudgets({ paid: "3.5" });
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberB.id, grantedByUserId: fx.adminA.id });
    const r = await run(fx.memberB.id, PAID(5));
    expect(r.refusedAt).toBeNull();
    expect(fx.db.findAiUsageLogsByUserId(fx.memberB.id).every((l) => l.allowanceKind === "complimentary")).toBe(true);
  });

  it("a free member (budget $0) gets none of it: the first photo is refused with the upgrade code, and nothing is reserved or spent", async () => {
    setBudgets({ paid: "3.5" });
    const r = await run(fx.memberA.id, TRIAL(3));
    expect(r.refusedAt).toMatch(/ai_upgrade_required after 0 calls/);
    expect(r.spent).toBe(0);
  });
});
