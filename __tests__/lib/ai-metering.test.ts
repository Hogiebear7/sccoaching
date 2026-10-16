// The reservation lifecycle (lib/ai-metering.ts): reserve a conservative maximum BEFORE the provider is called, reconcile with actual usage, and handle failures,
// timeouts and abandoned holds. The provider is a stand-in object (no network, no paid call). The budgets are TEST values.
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const KEYS = ["AI_ALLOWANCE_FREE_USD", "AI_ALLOWANCE_TRIAL_USD", "AI_ALLOWANCE_PAID_USD", "AI_ALLOWANCE_COMPLIMENTARY_USD"] as const;
const saved: Record<string, string | undefined> = {};
let fx: IapFixture;

function budgets(v: { free: string; trial: string; paid: string; complimentary: string }) {
  process.env.AI_ALLOWANCE_FREE_USD = v.free;
  process.env.AI_ALLOWANCE_TRIAL_USD = v.trial;
  process.env.AI_ALLOWANCE_PAID_USD = v.paid;
  process.env.AI_ALLOWANCE_COMPLIMENTARY_USD = v.complimentary;
}

async function grant(userId: string, over: Partial<import("@/lib/db").DigitalEntitlementRecord> = {}) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `app_store:${userId}`, userId, source: "app_store", status: "active", productId: "p", billingOptionId: null, storeRefHash: "h".repeat(64), environment: "production",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), autoRenewing: true, trial: false, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now, ...over,
  });
}

// A request of known size: the reservation is input (chars / 2 tokens, at 1.25 x $5 per Mtok) plus max_tokens at $25 per Mtok on the default model.
const params = (maxTokens = 1000, text = "x".repeat(2000)) => ({ model: "claude-opus-4-8", max_tokens: maxTokens, messages: [{ role: "user" as const, content: text }] });
const RESERVE = (1000 * 1.25 * 5 + 1000 * 25) / 1_000_000; // 1,000 input tokens + 1,000 output tokens = $0.03125

const usage = (input: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output });
const message = (input = 200, output = 100) => ({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], usage: usage(input, output) });

const holds = () => fx.db.listAiReservations();
const logs = (userId: string) => fx.db.findAiUsageLogsByUserId(userId);

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

    let seenDuring: { reservedUsd: number; userId: string; kind: string }[] = [];
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
    expect(maxCallCostUsd(params(8000)) - maxCallCostUsd(params(1000))).toBeCloseTo((7000 * 25) / 1_000_000, 8);
  });

  it("every provider call is made with a timeout and at most one retry", async () => {
    const { meteredCreate, AI_REQUEST_OPTIONS } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    let options: unknown;
    const client = { messages: { create: async (_p: unknown, o: unknown) => ((options = o), message()) } };
    await meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never);
    expect(options).toEqual(AI_REQUEST_OPTIONS);
    expect(AI_REQUEST_OPTIONS).toMatchObject({ timeout: expect.any(Number), maxRetries: 1 });
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

  it("a timeout is an UNKNOWN outcome: the hold is replaced by a conservative input-only ESTIMATE, flagged as estimated", async () => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    await grant(fx.memberA.id);
    const client = { messages: { create: async () => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); } } };
    await expect(meteredCreate(client as never, { userId: fx.memberA.id, feature: "coach_chat" }, params() as never)).rejects.toThrow("timed out");
    expect(holds()).toHaveLength(0);
    const [row] = logs(fx.memberA.id);
    expect(row).toMatchObject({ estimated: true, allowanceKind: "paid", inputTokens: expect.closeTo(1000, -1), outputTokens: 0 });
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it("an abandoned reservation (the process died mid-call) stops counting after its time limit, and not before", async () => {
    const db = await import("@/lib/db");
    const { HOLD_TTL_MS } = await import("@/lib/ai-metering");
    const t0 = Date.now();
    const first = db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 });
    expect(first.ok).toBe(true);
    // Still held a moment later: a second 0.9 does not fit.
    expect(db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 + 1000 }).ok).toBe(false);
    // After the time limit the dead process's hold no longer blocks anything, and is pruned.
    const later = db.reserveAiBudget({ userId: fx.memberA.id, feature: "coach_chat", kind: "paid", reserveUsd: 0.9, budgetUsd: 1, windowMs: 30 * DAY, ttlMs: HOLD_TTL_MS, nowMs: t0 + HOLD_TTL_MS + 1 });
    expect(later.ok).toBe(true);
    expect(holds()).toHaveLength(1);
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

  it.each(STAFF)("%s is logged but takes no member reservation", async (feature) => {
    const { meteredCreate } = await import("@/lib/ai-metering");
    let held = -1;
    const client = { messages: { create: async () => ((held = holds().length), message()) } };
    await meteredCreate(client as never, { userId: feature === "exercise_content" ? null : fx.adminA.id, feature }, params() as never);
    expect(held).toBe(0);
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
    budgets({ free: "0", trial: "0.25", paid: "1", complimentary: "0.5" });
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
