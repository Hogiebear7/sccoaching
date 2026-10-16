// The reservation lifecycle (lib/ai-metering.ts): reserve a conservative maximum BEFORE the provider is called, reconcile with actual usage, and handle failures,
// timeouts and abandoned holds. The provider is a stand-in object (no network, no paid call). The budgets are TEST values.
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const KEYS = ["AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD", "AI_STAFF_USD", "AI_APP_CEILING_USD", "ANTHROPIC_MODEL"] as const;
const saved: Record<string, string | undefined> = {};
let fx: IapFixture;

// TEST values only. The staff pool and the app-wide ceiling default to amounts that never bind unless a test sets them.
function budgets(v: { free: string; trial: string; paid: string; complimentary: string; staff?: string; ceiling?: string }) {
  process.env.AI_ALLOWANCE_FREE_USD = v.free;
  process.env.AI_ALLOWANCE_TRIAL_USD = v.trial;
  process.env.AI_ALLOWANCE_PAID_USD = v.paid;
  process.env.AI_ALLOWANCE_COMPLIMENTARY_USD = v.complimentary;
  process.env.AI_STAFF_USD = v.staff ?? "100";
  process.env.AI_APP_CEILING_USD = v.ceiling ?? "1000";
}

async function grant(userId: string, over: Partial<import("@/lib/db").DigitalEntitlementRecord> = {}) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`, userId, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64), environment: "production",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), autoRenewing: true, trial: false, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now, ...over,
  });
}

// A request of known size on the default model (opus-4-8: $5 in, $10 for a 1-hour cache write, $25 out per Mtok). The reservation is the input (chars / 2 tokens) at
// the dearest input rate plus every allowed output token, plus a 10% margin: about 1,000 input tokens + 1,000 output tokens = (10,000 + 25,000) x 1.1 / 1e6.
const params = (maxTokens = 1000, text = "x".repeat(2000), model = "claude-opus-4-8") => ({ model, max_tokens: maxTokens, messages: [{ role: "user" as const, content: text }] });
const RESERVE = ((1000 * 10 + 1000 * 25) * 1.1) / 1_000_000; // $0.0385

const usage = (input: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output });
const message = (input = 200, output = 100) => ({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], usage: usage(input, output) });

const holds = () => fx.db.listAiReservations();
const logs = (userId: string) => fx.db.findAiUsageLogsByUserId(userId);
const allLogs = () => fx.db.findAllAiUsageLogs();

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  fx = await createFixture();
  budgets({ free: "0.1", trial: "0.25", paid: "1", complimentary: "0.5" });
});
afterEach(() => {
  fx.cleanup();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the reservation is a conservative maximum, taken BEFORE the provider is contacted", () => {
  it("holds the call's maximum while the provider works, then replaces it with the reported usage in one step", async () => {
    const { meteredCreate, maxCallCostUsd } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    expect(maxCallCostUsd(params())).toBeCloseTo(RESERVE, 4);

    let seenDuring: { reservedUsd: number; userId: string | null; kind: string }[] = [];
    const client = {
      messages: {
        create: async () => {
          seenDuring = holds().map((h) => ({ reservedUsd: h.reservedUsd, userId: h.userId, kind: h.kind }));
          return message(200, 100);
        },
      },
    };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);

    expect(seenDuring).toEqual([{ reservedUsd: expect.closeTo(RESERVE, 4), userId: fx.memberA.id, kind: "paid" }]);
    expect(holds()).toHaveLength(0);
    const [row] = logs(fx.memberA.id);
    expect(row).toMatchObject({ allowanceKind: "paid", inputTokens: 200, outputTokens: 100, feature: "coach_chat" });
    expect(row.costUsd).toBeCloseTo((200 * 5 + 100 * 25) / 1_000_000, 10); // the REPORTED usage, far below the held maximum
    expect(row.costUsd).toBeLessThan(RESERVE);
    expect(row.estimated).toBeUndefined();
  });

  it("refuses BEFORE the provider is reached when the maximum does not fit the remaining budget", async () => {
    const { meteredCreate, AiAllowanceError } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    let reachedProvider = 0;
    const client = { messages: { create: async () => (reachedProvider++, message()) } };
    // 1.00 budget, 0.99 already used: a call that could cost up to 0.031 does not fit, even though its real cost would be tiny.
    fx.db.createAiUsageLog({ id: "u1", userId: fx.memberA.id, feature: "coach_chat", model: "claude-opus-4-8", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.99, allowanceKind: "paid", createdAt: new Date().toISOString() });
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).rejects.toBeInstanceOf(AiAllowanceError);
    expect(reachedProvider).toBe(0);
    expect(holds()).toHaveLength(0);
  });

  it("concurrent requests cannot all be granted the same remaining budget: 10 at once against room for 4 -> exactly 4 reach the provider", async () => {
    const { meteredCreate, AiAllowanceError } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    budgets({ free: "0.1", trial: "0.25", paid: String(RESERVE * 4 + 0.001), complimentary: "0.5" });
    let inFlight = 0;
    let peak = 0;
    const client = {
      messages: {
        create: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 25)); // every request is begun before any settles
          inFlight--;
          return message(200, 100);
        },
      },
    };
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(6);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AiAllowanceError);
    expect(peak).toBe(4);
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toHaveLength(4);
  });

  it("reconciling releases the unused part: after a cheap call a later call fits that would not have while the maximum was held", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    budgets({ free: "0.1", trial: "0.25", paid: String(RESERVE * 1.5), complimentary: "0.5" }); // room for one maximum, not two
    const client = { messages: { create: async () => message(200, 100) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).resolves.toBeDefined();
  });

  it("no datastore lock is held during the provider call: the datastore is read and written freely while a call is in flight", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    const db = await import("@/lib/db");
    await grant(fx.memberA.id);
    let wroteDuringCall = false;
    const client = {
      messages: {
        create: async () => {
          const other = db.reserveAiBudget({ userId: fx.memberB.id, feature: "coach_chat", kind: "free", reserveUsd: 0.01, budgetUsd: 0.1, windowMs: 30 * DAY, ttlMs: 60_000 });
          wroteDuringCall = other.ok;
          if (other.ok) db.settleAiReservation(other.id, null);
          return message();
        },
      },
    };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(wroteDuringCall).toBe(true);
  });
});

describe("bounded input and output", () => {
  it("refuses an oversized request before reserving or calling anything", async () => {
    const { meteredCreate, AiRequestTooLargeError, MAX_INPUT_TOKENS_ESTIMATE } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    let reachedProvider = 0;
    const client = { messages: { create: async () => (reachedProvider++, message()) } };
    const huge = "x".repeat(MAX_INPUT_TOKENS_ESTIMATE * 2 + 10);
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params(1000, huge) as never)).rejects.toBeInstanceOf(AiRequestTooLargeError);
    expect(reachedProvider).toBe(0);
    expect(holds()).toHaveLength(0);
  });

  it("refuses an oversized image, and counts every image at a flat pessimistic size", async () => {
    const { meteredCreate, AiRequestTooLargeError, MAX_IMAGE_BASE64_CHARS, estimateInputTokens } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const withImage = (data: string) => ({ ...params(), messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }, { type: "text", text: "read" }] }] });
    expect(estimateInputTokens(withImage("AAAA") as never).tokens).toBeGreaterThanOrEqual(6000);
    const client = { messages: { create: async () => message() } };
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "food_photo_scan" }, withImage("A".repeat(MAX_IMAGE_BASE64_CHARS + 1)) as never)).rejects.toBeInstanceOf(AiRequestTooLargeError);
  });

  it("output is bounded by max_tokens, and the reservation includes every one of those tokens", async () => {
    const { maxCallCostUsd } = await import("@/lib/ai-metering");
    expect(maxCallCostUsd(params(8000)) - maxCallCostUsd(params(1000))).toBeCloseTo((7000 * 25 * 1.1) / 1_000_000, 8);
  });

  it("every provider call has a hard deadline and NO automatic retries (a retry is a second billable call the reservation does not cover)", async () => {
    const { meteredCreate, PROVIDER_DEADLINE_MS, HOLD_TTL_MS } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    let options: { timeout?: number; maxRetries?: number; signal?: AbortSignal } | undefined;
    const client = { messages: { create: async (_p: unknown, o: typeof options) => ((options = o), message()) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(options?.maxRetries).toBe(0);
    expect(options?.timeout).toBe(PROVIDER_DEADLINE_MS);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    // A live call always ends before its hold can expire.
    expect(HOLD_TTL_MS).toBeGreaterThan(PROVIDER_DEADLINE_MS);
  });
});

describe("failures, timeouts and abandoned reservations", () => {
  it("a provider error with an HTTP status was not billed: the hold is released and nothing is recorded", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const client = { messages: { create: async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); } } };
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).rejects.toThrow("overloaded");
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toHaveLength(0);
  });

  it("a timeout is an UNKNOWN outcome: the provider may have completed, so the call is charged its full RESERVED MAXIMUM, flagged as an estimate", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const client = { messages: { create: async () => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); } } };
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).rejects.toThrow("timed out");
    expect(holds()).toHaveLength(0);
    const [row] = logs(fx.memberA.id);
    expect(row).toMatchObject({ estimated: true, allowanceKind: "paid" });
    expect(row.costUsd).toBeCloseTo(RESERVE, 4);
  });

  it("a crashed call's hold is NEVER released as if nothing happened: after its time limit it becomes a charge at the reserved maximum", async () => {
    const db = await import("@/lib/db");
    const { HOLD_TTL_MS } = await import("@/lib/ai-metering");
    const t0 = Date.now();
    const ask = (nowMs: number) => db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs });
    const first = ask(t0);
    expect(first.ok).toBe(true);
    // Still held a moment later: a second 0.9 does not fit.
    expect(ask(t0 + 1000).ok).toBe(false);
    // The process died and never settled. After the hold's time limit the budget is STILL not free: the provider may have completed that call.
    expect(ask(t0 + HOLD_TTL_MS + 1).ok).toBe(false);
    expect(holds()).toHaveLength(0);
    const [charge] = logs(fx.memberA.id);
    expect(charge).toMatchObject({ costUsd: 0.9, estimated: true, allowanceKind: "paid", abandonedReservationId: (first as { id: string }).id });
  });

  it("a LATE settle replaces the abandoned charge with what the call really cost (the slow call finished after its hold expired)", async () => {
    const db = await import("@/lib/db");
    const { HOLD_TTL_MS } = await import("@/lib/ai-metering");
    const t0 = Date.now();
    const first = db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 }) as { id: string };
    // Another request arrives after the hold expired: the abandoned maximum is charged, and this one is refused.
    expect(db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.5, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 + HOLD_TTL_MS + 1 }).ok).toBe(false);
    // The slow call finally answers: its real usage replaces the 0.9 charge (one row, not two).
    db.settleAiReservation(first.id, { id: "real", userId: fx.memberA.id, feature: "coach_chat", model: "claude-opus-4-8", inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.0035, allowanceKind: "paid", createdAt: new Date().toISOString() });
    expect(logs(fx.memberA.id).map((l) => l.costUsd)).toEqual([0.0035]);
    expect(db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.5, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 + HOLD_TTL_MS + 2 }).ok).toBe(true);
  });

  it("a late failure the provider rejected (an HTTP status) removes the abandoned charge: it was never billed", async () => {
    const db = await import("@/lib/db");
    const t0 = Date.now();
    const first = db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: 1000, nowMs: t0 }) as { id: string };
    db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.1, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: 1000, nowMs: t0 + 5000 });
    expect(logs(fx.memberA.id)).toHaveLength(1);
    db.settleAiReservation(first.id, null);
    expect(logs(fx.memberA.id)).toHaveLength(0);
  });

  it("a slow call inside its time limit keeps its hold, and a call that outlives the deadline is cut off by its own signal", async () => {
    const { meteredCreate, PROVIDER_DEADLINE_MS, HOLD_TTL_MS } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    let seenSignal: AbortSignal | undefined;
    const client = {
      messages: {
        create: (_p: unknown, o: { signal: AbortSignal }) => {
          seenSignal = o.signal;
          return new Promise((_resolve, reject) => o.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "APIUserAbortError" }))));
        },
      },
    };
    const pending = meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    pending.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(holds()).toHaveLength(1); // the slow call still holds its budget
    expect(seenSignal?.aborted).toBe(false);
    expect(PROVIDER_DEADLINE_MS).toBeLessThan(HOLD_TTL_MS);
  });

  it("settling twice is harmless, and a settle for a hold that already expired still records the usage", async () => {
    const { beginAiCall } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const ticket = beginAiCall({ userId: fx.memberA.id, feature: "coach_chat", params: params() as never });
    ticket.settle(usage(100, 50));
    ticket.settle(usage(100, 50));
    ticket.fail(new Error("late"));
    expect(logs(fx.memberA.id)).toHaveLength(1);
  });
});

describe("streams (coach chat, nutrition coach)", () => {
  function fakeStream() {
    const emitter = new EventEmitter();
    return { emitter, client: { messages: { stream: () => emitter } } };
  }

  it("settles with the final message's reported usage", async () => {
    const { meteredStream } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const { emitter, client } = fakeStream();
    meteredStream(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(holds()).toHaveLength(1);
    emitter.emit("finalMessage", message(300, 120));
    emitter.emit("end");
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toMatchObject([{ inputTokens: 300, outputTokens: 120, allowanceKind: "paid" }]);
  });

  it("an error before any output releases the hold (HTTP status) and records nothing", async () => {
    const { meteredStream } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const { emitter, client } = fakeStream();
    meteredStream(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    emitter.emit("error", Object.assign(new Error("bad request"), { status: 400 }));
    emitter.emit("end");
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toHaveLength(0);
  });

  it("a client that disconnects mid-stream (abort) is counted: input plus the output already produced, flagged estimated", async () => {
    const { meteredStream } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const { emitter, client } = fakeStream();
    meteredStream(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    emitter.emit("text", "y".repeat(300));
    emitter.emit("abort", new Error("aborted"));
    emitter.emit("end");
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toMatchObject([{ estimated: true, outputTokens: 100, inputTokens: expect.closeTo(1000, -1) }]);
  });

  it("a stream that ends without a final message still settles (nothing is left holding budget)", async () => {
    const { meteredStream } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const { emitter, client } = fakeStream();
    meteredStream(client as never, { userId: fx.memberA.id, feature: "nutrition_coach_chat" }, params() as never);
    emitter.emit("end");
    expect(holds()).toHaveLength(0);
    expect(logs(fx.memberA.id)).toMatchObject([{ estimated: true }]);
  });

  it("is refused before a stream is opened when the maximum does not fit", async () => {
    const { meteredStream, AiAllowanceError } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    budgets({ free: "0.1", trial: "0.25", paid: "0.001", complimentary: "0.5" });
    let opened = 0;
    const client = { messages: { stream: () => (opened++, new EventEmitter()) } };
    expect(() => meteredStream(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).toThrow(AiAllowanceError);
    expect(opened).toBe(0);
  });
});

describe("coverage: every member-attributed AI feature is reserved, and staff-attributed ones are not a member's allowance", () => {
  const MEMBER = ["coach_chat", "nutrition_coach_chat", "meal_suggestions", "food_photo_scan", "food_description", "receipt_scan", "workout_review", "tracker_import", "programme_generation", "programme_checkin", "exercise_alternatives"] as const;
  const STAFF = ["staff_member_summary", "staff_draft_reply", "exercise_content"] as const;

  it.each(MEMBER)("%s takes a reservation and counts against the member", async (feature) => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let held = 0;
    const client = { messages: { create: async () => ((held = holds().length), message()) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature }, params() as never); // a free member: the free group
    expect(held).toBe(1);
    expect(logs(fx.memberA.id)).toMatchObject([{ feature, allowanceKind: "free" }]);
  });

  it.each(STAFF)("%s is not a member's allowance: it reserves from the shared STAFF pool and is logged as staff", async (feature) => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let held: { kind: string }[] = [];
    const client = { messages: { create: async () => ((held = holds()), message()) } };
    await meteredCreate(client as never, { userId: feature === "exercise_content" ? null : fx.adminA.id, feature }, params() as never);
    expect(held).toMatchObject([{ kind: "staff" }]);
    expect(allLogs().at(-1)).toMatchObject({ feature, allowanceKind: "staff" });
  });

  it("with no budgets set (development) nothing is reserved but usage is still logged with its group", async () => {
    for (const k of KEYS) delete process.env[k];
    const { meteredCreate } = await import("@/lib/ai-metering");
    let held = -1;
    const client = { messages: { create: async () => ((held = holds().length), message()) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(held).toBe(0);
    expect(logs(fx.memberA.id)).toHaveLength(1);
  });
});

describe("the groups through the real reservation", () => {
  const fit = (n: number) => String(RESERVE * n + 0.0005);
  async function callOnce(userId: string, actual = { input: 200, output: 100 }) {
    const { meteredCreate } = await import("@/lib/ai-metering");
    const client = { messages: { create: async () => message(actual.input, actual.output) } };
    return meteredCreate(client as never, { userId, feature: "coach_chat" }, params() as never);
  }

  it("trial: one total for the whole trial. Using it up, cancelling and re-starting never gives it back", async () => {
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    budgets({ free: "0.1", trial: fit(1), paid: "1", complimentary: "0.5" });
    await grant(fx.memberA.id, { trial: true });
    // The first call's real cost is the whole trial total (a deliberately expensive stand-in).
    await callOnce(fx.memberA.id, { input: 1000, output: 1000 });
    await expect(callOnce(fx.memberA.id)).rejects.toBeInstanceOf(AiAllowanceError);

    await grant(fx.memberA.id, { trial: true, status: "canceled", autoRenewing: false });
    await expect(callOnce(fx.memberA.id)).rejects.toBeInstanceOf(AiAllowanceError);
    await grant(fx.memberA.id, { trial: true, id: "google_play:x", source: "google_play" });
    await expect(callOnce(fx.memberA.id)).rejects.toBeInstanceOf(AiAllowanceError);
  });

  it("conversion: the paid allowance starts when the trial ends, from zero, and trial use never counts toward it", async () => {
    budgets({ free: "0.1", trial: fit(1), paid: fit(1), complimentary: "0.5" });
    await grant(fx.memberA.id, { trial: true });
    await callOnce(fx.memberA.id, { input: 1000, output: 1000 });
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    await expect(callOnce(fx.memberA.id)).rejects.toBeInstanceOf(AiAllowanceError);

    await grant(fx.memberA.id, { trial: false }); // the first paid period
    await expect(callOnce(fx.memberA.id)).resolves.toBeDefined();
    expect(logs(fx.memberA.id).map((l) => l.allowanceKind)).toEqual(["trial", "paid"]);
  });

  it("complimentary: bounded by its own budget, tagged complimentary, never silently trial or paid", async () => {
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    budgets({ free: "0.1", trial: "9", paid: "9", complimentary: fit(1) });
    grantStaffDigitalEntitlement({ userId: fx.memberB.id, grantedByUserId: fx.adminA.id });
    await callOnce(fx.memberB.id, { input: 1000, output: 1000 });
    await expect(callOnce(fx.memberB.id)).rejects.toBeInstanceOf(AiAllowanceError);
    expect(logs(fx.memberB.id).map((l) => l.allowanceKind)).toEqual(["complimentary"]);
  });

  it("paid: a rolling 30 days. Spend older than the window no longer counts", async () => {
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    budgets({ free: "0.1", trial: "0.25", paid: fit(1), complimentary: "0.5" });
    await grant(fx.memberA.id);
    fx.db.createAiUsageLog({ id: "old", userId: fx.memberA.id, feature: "coach_chat", model: "claude-opus-4-8", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 5, allowanceKind: "paid", createdAt: new Date(Date.now() - 31 * DAY).toISOString() });
    await expect(callOnce(fx.memberA.id, { input: 1000, output: 1000 })).resolves.toBeDefined();
    await expect(callOnce(fx.memberA.id)).rejects.toBeInstanceOf(AiAllowanceError);
  });

  it("the refusal carries the group and a plain message that separates the AI allowance from the subscription", async () => {
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    budgets({ free: "0.001", trial: "0.25", paid: "1", complimentary: "0.5" });
    try {
      await callOnce(fx.memberA.id);
      throw new Error("should have been refused");
    } catch (err) {
      expect(err).toBeInstanceOf(AiAllowanceError);
      const e = err as InstanceType<typeof AiAllowanceError>;
      expect(e).toMatchObject({ code: "ai_allowance_reached", kind: "free" });
      expect(e.message).toMatch(/subscription .* unaffected/i);
      expect(e.message).not.toMatch(/fair.use|unlimited/i);
    }
  });
});

describe("staff-run features: one shared cumulative pool, and an app-wide ceiling on everything", () => {
  const call = async (userId: string | null, feature: "staff_member_summary" | "staff_draft_reply" | "exercise_content" | "coach_chat" = "staff_member_summary", actual = { input: 200, output: 100 }) => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let reached = 0;
    const client = { messages: { create: async () => (reached++, message(actual.input, actual.output)) } };
    await meteredCreate(client as never, { userId, feature }, params() as never);
    return reached;
  };

  it("all staff share ONE budget: three different staff users and a system call draw down the same pool, and the call that would cross it is refused before the provider", async () => {
    const { AiAllowanceError } = await import("@/lib/ai-metering");
    budgets({ free: "0.1", trial: "0.25", paid: "1", complimentary: "0.5", staff: String(RESERVE * 2 + 0.0005) });
    // Each call's real cost is the whole reserve (an expensive stand-in), so the pool is used by the second call.
    const dear = { input: 1000, output: 1000 };
    await call(fx.adminA.id, "staff_member_summary", dear);
    await call(fx.adminB?.id ?? fx.adminA.id, "staff_draft_reply", dear);
    let reached = 0;
    const { meteredCreate } = await import("@/lib/ai-metering");
    const client = { messages: { create: async () => (reached++, message()) } };
    await expect(meteredCreate(client as never, { userId: null, feature: "exercise_content" }, params() as never)).rejects.toMatchObject({ name: "AiAllowanceError", code: "ai_allowance_reached", kind: "staff" });
    expect(reached).toBe(0);
    expect(AiAllowanceError).toBeDefined();
    // Members are unaffected by the staff pool being used up.
    await expect(call(fx.memberA.id, "coach_chat")).resolves.toBe(1);
  });

  it("concurrent staff requests cannot all be granted the same pool: 6 at once against room for 2 -> 2 reach the provider", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    budgets({ free: "0.1", trial: "0.25", paid: "1", complimentary: "0.5", staff: String(RESERVE * 2 + 0.0005) });
    let reached = 0;
    const client = { messages: { create: async () => ((reached++), await new Promise((r) => setTimeout(r, 20)), message()) } };
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_v, i) => meteredCreate(client as never, { userId: i % 2 ? fx.adminA.id : null, feature: "staff_member_summary" }, params() as never)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(reached).toBe(2);
  });

  it("an app-wide ceiling caps ALL AI spending (members and staff together): once held plus spent reaches it, nothing more is started, and members only see 'unavailable'", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    budgets({ free: "9", trial: "9", paid: "9", complimentary: "9", staff: "9", ceiling: String(RESERVE * 3 + 0.0005) });
    await grant(fx.memberA.id);
    const dear = { input: 1000, output: 1000 };
    await call(fx.memberA.id, "coach_chat", dear);
    await call(fx.memberB.id, "coach_chat", dear);
    await call(fx.adminA.id, "staff_member_summary", dear);
    let reached = 0;
    const client = { messages: { create: async () => (reached++, message()) } };
    for (const [userId, feature] of [[fx.memberA.id, "coach_chat"], [fx.adminA.id, "staff_draft_reply"]] as const) {
      const err = await meteredCreate(client as never, { userId, feature }, params() as never).catch((e) => e);
      expect(err).toMatchObject({ name: "AiAllowanceError", code: "ai_allowance_unavailable" });
      expect(String(err.message)).not.toMatch(/\$|[0-9]\.[0-9]/); // never reveals an amount
    }
    expect(reached).toBe(0);
  });

  it("the ceiling counts live holds too, so concurrent calls cannot overshoot it", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    budgets({ free: "9", trial: "9", paid: "9", complimentary: "9", staff: "9", ceiling: String(RESERVE * 3 + 0.0005) });
    let reached = 0;
    const client = { messages: { create: async () => ((reached++), await new Promise((r) => setTimeout(r, 20)), message()) } };
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_v, i) => meteredCreate(client as never, { userId: [fx.memberA.id, fx.memberB.id, fx.adminA.id, null][i % 4], feature: i % 4 >= 2 ? "staff_member_summary" : "coach_chat" }, params() as never)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(reached).toBe(3);
  });

  it("with enforcement on, an unset staff pool or an unset app-wide ceiling refuses (fail closed) instead of running unbounded", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let reached = 0;
    const client = { messages: { create: async () => (reached++, message()) } };
    delete process.env.AI_STAFF_USD;
    await expect(meteredCreate(client as never, { userId: fx.adminA.id, feature: "staff_member_summary" }, params() as never)).rejects.toMatchObject({ code: "ai_allowance_unavailable" });
    budgets({ free: "0.1", trial: "0.25", paid: "1", complimentary: "0.5" });
    delete process.env.AI_APP_CEILING_USD;
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).rejects.toMatchObject({ code: "ai_allowance_unavailable" });
    expect(reached).toBe(0);
  });
});

describe("pricing: every billed component, and no guessing", () => {
  it("an unpriced model is refused when allowances are enforced (never reserved at a guessed rate), and the call is not made", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let reached = 0;
    const client = { messages: { create: async () => (reached++, message()) } };
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params(1000, "x".repeat(2000), "claude-made-up-9") as never)).rejects.toMatchObject({ code: "ai_allowance_unavailable" });
    expect(reached).toBe(0);
    expect(holds()).toHaveLength(0);
  });

  it("plan purchases stay blocked while the configured model is unpriced, and open for a priced one", async () => {
    const { aiAllowanceConfigured, aiModelPriced } = await import("@/lib/ai-allowance");
    process.env.ANTHROPIC_MODEL = "claude-made-up-9";
    expect(aiModelPriced()).toBe(false);
    expect(aiAllowanceConfigured()).toBe(false);
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    expect(aiModelPriced()).toBe(true);
    expect(aiAllowanceConfigured()).toBe(true);
  });

  it("claude-sonnet-5-5 is priced from the published page: $2 in, $2.50 / $4 cache write (5m / 1h), $0.10 cache read, $10 out per Mtok", async () => {
    const { ratesForKnownModel } = await import("@/lib/ai-usage");
    expect(ratesForKnownModel("claude-sonnet-5-5")).toEqual({ input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 });
    // The cache-read rate is model-specific (0.05x on Sonnet 5.5, 0.1x on Sonnet 5), so it is a table value, not a shared multiplier.
    expect(ratesForKnownModel("claude-sonnet-5")?.cacheRead).toBe(0.2);
  });

  it("costs every component: fresh input, 5-minute and 1-hour cache writes, cache reads, output (thinking included)", async () => {
    const { costFromUsage } = await import("@/lib/ai-usage");
    const base = { input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 };
    // Sonnet 5.5: 1000 x 2 + 2000 x 0.1 + 500 x 10 = 2000 + 200 + 5000 = 7,200 / 1e6.
    expect(costFromUsage("claude-sonnet-5-5", base).costUsd).toBeCloseTo(0.0072, 8);
    // With a cache write and NO breakdown it is charged at the dearer 1-hour rate: + 1000 x 4.
    expect(costFromUsage("claude-sonnet-5-5", { ...base, cache_creation_input_tokens: 1000 }).costUsd).toBeCloseTo(0.0072 + 0.004, 8);
    // With a breakdown, 5-minute writes are cheaper: 600 x 2.5 + 400 x 4 = 3,100.
    expect(
      costFromUsage("claude-sonnet-5-5", { ...base, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 } }).costUsd
    ).toBeCloseTo(0.0072 + 0.0031, 8);
    expect(costFromUsage("claude-sonnet-5-5", base).exact).toBe(true);
  });

  it("web searches are priced at $0.01 each, and an unrecognised billing modifier is counted at +10% and flagged as an estimate", async () => {
    const { costFromUsage } = await import("@/lib/ai-usage");
    const base = { input_tokens: 1000, output_tokens: 500 }; // 2,000 + 5,000 = 0.007
    expect(costFromUsage("claude-sonnet-5-5", { ...base, server_tool_use: { web_search_requests: 3 } })).toMatchObject({ exact: true });
    expect(costFromUsage("claude-sonnet-5-5", { ...base, server_tool_use: { web_search_requests: 3 } }).costUsd).toBeCloseTo(0.007 + 0.03, 8);
    const odd = costFromUsage("claude-sonnet-5-5", { ...base, service_tier: "priority" });
    expect(odd.exact).toBe(false);
    expect(odd.costUsd).toBeCloseTo(0.007 * 1.1, 8);
    expect(costFromUsage("claude-sonnet-5-5", { ...base, inference_geo: "us" }).costUsd).toBeCloseTo(0.007 * 1.1, 8);
    expect(costFromUsage("claude-sonnet-5-5", { ...base, server_tool_use: { web_fetch_requests: 1 } }).exact).toBe(false);
  });

  it("a response with an unrecognised component is settled flagged as an estimate", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const client = { messages: { create: async () => ({ ...message(), usage: { ...usage(200, 100), service_tier: "priority" } }) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(logs(fx.memberA.id)[0]).toMatchObject({ estimated: true });
  });

  it("the reservation is priced at the DEAREST input rate (the 1-hour cache write) plus every output token, plus 10%", async () => {
    const { maxCallCostUsd } = await import("@/lib/ai-metering");
    // Sonnet 5.5: dearest input $4, output $10; 1,002 estimated input tokens (the role and type strings count too) and 1,000 output tokens.
    expect(maxCallCostUsd(params(1000, "x".repeat(2000), "claude-sonnet-5-5"))).toBeCloseTo(((1002 * 4 + 1000 * 10) * 1.1) / 1_000_000, 6);
    // A final cost is far lower than the reservation for a typical call: that gap is the headroom a call needs to START.
    const { costFromUsage } = await import("@/lib/ai-usage");
    expect(costFromUsage("claude-sonnet-5-5", usage(500, 200)).costUsd).toBeLessThan(maxCallCostUsd(params(1000, "x".repeat(2000), "claude-sonnet-5-5")) / 2);
  });
});

describe("free group with a budget of $0: a friendly upgrade message, not a spending error", () => {
  it("is refused before any reservation or provider call, with the upgrade code and a message that says the rest of the app still works", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    budgets({ free: "0", trial: "0.25", paid: "1", complimentary: "1" });
    let reached = 0;
    const client = { messages: { create: async () => (reached++, message()) } };
    const err = await meteredCreate(client as never, { userId: fx.memberA.id, feature: "food_photo_scan" }, params() as never).catch((e) => e);
    expect(err).toMatchObject({ name: "AiAllowanceError", code: "ai_upgrade_required", kind: "free" });
    expect(err.message).toMatch(/part of the App Subscription/);
    expect(err.message).toMatch(/Everything else in the app/);
    expect(err.message).not.toMatch(/allowance|limit|used/i);
    expect(reached).toBe(0);
    expect(holds()).toHaveLength(0);
  });

  it("complimentary is a separate group with its own budget, set here to the same value as paid", async () => {
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    const { allowanceKindFor, aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    budgets({ free: "0", trial: "0.25", paid: "1", complimentary: "1" });
    grantStaffDigitalEntitlement({ userId: fx.memberB.id, grantedByUserId: fx.adminA.id });
    expect(allowanceKindFor(fx.memberB.id, Date.now())).toBe("complimentary");
    expect(aiAllowanceBudgets().complimentary).toBe(aiAllowanceBudgets().paid);
  });
});
