// The one place AI spending is ENFORCED. Every provider call in lib/ai.ts goes through here:
//
//   beginAiCall  ->  (provider call, NO datastore lock held, NOTHING held in memory)  ->  settle | fail
//
// 1. BEGIN. Refuse an oversized request (bounded input) and an unpriced model (never reserve against a guessed price). Work out the most this ONE call could
//    cost (the bounded input at the dearest input rate, every output token it may produce, plus a 10% margin for a billing modifier the app does not use) and
//    reserve it in a single atomic datastore turn (reserveAiBudget). That one turn checks, together: the member's own group budget (or, for the staff-run
//    features, the ONE pool shared by all staff), and an APP-WIDE ceiling on all AI spending. If any would be crossed the call is refused BEFORE the provider is
//    contacted. Because check and hold are one turn, concurrent requests, in one process or many, can never be granted the same remaining budget.
// 2. CALL. The provider is called afterwards, with no lock held, under a hard deadline (an AbortSignal), with NO automatic retries (a retry is a second
//    billable call the reservation does not cover; the member's own retry makes a new reservation).
// 3. SETTLE. The hold is replaced, in one write, by the cost of what the provider REPORTED (every billed component: input, 5-minute and 1-hour cache writes,
//    cache reads, output including thinking, web search; an unrecognised modifier is counted at +10% and flagged).
//    FAIL. A provider error with an HTTP status was rejected, not billed: the hold is released. Anything else (a timeout, a dropped connection, an abort) is an
//    UNKNOWN outcome, because the provider may have completed: a non-streaming call is charged its full RESERVED MAXIMUM (flagged as an estimate); a stream is
//    charged its input plus the output already received.
// 4. NEVER FREED EARLY. A hold's time limit (HOLD_TTL_MS) is longer than the hard deadline, so a live call always settles before it. A hold that still expires
//    (the process died, the host froze) is not released: it becomes a charge at its reserved maximum, and a late settle for it REPLACES that charge with the
//    real usage. So budget is only ever freed by what the provider actually reported.
//
// With no budgets configured (development) nothing is reserved and calls behave as they did before allowances existed; usage is still logged.

import { randomUUID } from "crypto";

import type Anthropic from "@anthropic-ai/sdk";

import {
  ALLOWANCE_UNAVAILABLE_MESSAGE,
  TRIAL_AI_UNAVAILABLE_MESSAGE,
  memberClassPool,
  AI_ALLOWANCE_CODE,
  AI_ALLOWANCE_UNAVAILABLE_CODE,
  AI_UPGRADE_CODE,
  UPGRADE_MESSAGE,
  aiAllowanceBudgets,
  aiAllowanceEnforced,
  aiPoolBudgets,
  allowanceKindFor,
  allowanceMessage,
  resetsAtFor,
  windowMsFor,
  AI_ALLOWANCE_WINDOW_MS,
} from "@/lib/ai-allowance";
import { UNRECOGNISED_COMPONENT_MARKUP, costFromUsage, costUsdFor, ratesForKnownModel, priceFor, recordAiUsageFromResponse, type ProviderUsage } from "@/lib/ai-usage";
import { reserveAiBudget, settleAiReservation, type AiAllowanceKind, type AiFeature, type AiUsageLogRecord } from "@/lib/db";

/** A provider call that has not finished by now is given up on. Applies to the whole call, retries (there are none) and streams included. */
export const PROVIDER_DEADLINE_MS = 120 * 1000;
/** Longer than the deadline, so a live call always settles before its hold can expire. */
export const HOLD_TTL_MS = 10 * 60 * 1000;

/** Bounded input. Characters are counted at 2 per token and an image at a flat 6,000 tokens, both deliberately pessimistic. */
export const MAX_INPUT_TOKENS_ESTIMATE = 60_000;
export const MAX_IMAGE_BASE64_CHARS = 8_000_000;
const CHARS_PER_TOKEN_PESSIMISTIC = 2;
const IMAGE_TOKENS_PESSIMISTIC = 6_000;
/** For a stream cut short, output received so far is counted at 3 characters per token. */
const STREAMED_CHARS_PER_TOKEN = 3;

/** Fresh per call: the signal is the hard deadline. maxRetries 0 on purpose (see above). */
export function providerRequestOptions() {
  return { timeout: PROVIDER_DEADLINE_MS, maxRetries: 0, signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS) } as const;
}

/** The features that spend a MEMBER's allowance. The staff-run features draw on the shared staff pool instead. */
const MEMBER_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>([
  "coach_chat",
  "nutrition_coach_chat",
  "meal_suggestions",
  "food_photo_scan",
  "food_description",
  "receipt_scan",
  "workout_review",
  "tracker_import",
  "programme_generation",
  "programme_checkin",
  "exercise_alternatives",
]);

export const isMemberAiFeature = (feature: AiFeature): boolean => MEMBER_FEATURES.has(feature);

export class AiAllowanceError extends Error {
  constructor(
    readonly code: typeof AI_ALLOWANCE_CODE | typeof AI_ALLOWANCE_UNAVAILABLE_CODE | typeof AI_UPGRADE_CODE,
    readonly kind: AiAllowanceKind,
    message: string,
    readonly resetsAt: string | null = null
  ) {
    super(message);
    this.name = "AiAllowanceError";
  }
}

export class AiRequestTooLargeError extends Error {
  constructor() {
    super("That request is too large for the AI features. Try again with less text or a smaller photo.");
    this.name = "AiRequestTooLargeError";
  }
}

interface MeterParams {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages?: unknown;
}

function measure(value: unknown, acc: { chars: number; images: number; imageChars: number }): void {
  if (typeof value === "string") {
    acc.chars += value.length;
  } else if (Array.isArray(value)) {
    for (const v of value) measure(v, acc);
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.type === "image" || o.type === "document") {
      acc.images += 1;
      const source = o.source as { data?: unknown } | undefined;
      if (source && typeof source.data === "string") acc.imageChars += source.data.length;
      return;
    }
    for (const k of Object.keys(o)) if (k !== "cache_control") measure(o[k], acc);
  }
}

/** The pessimistic input size of a request, in tokens, and whether any image is over the size cap. */
export function estimateInputTokens(params: Pick<MeterParams, "system" | "messages">): { tokens: number; oversizedImage: boolean } {
  const acc = { chars: 0, images: 0, imageChars: 0 };
  measure(params.system, acc);
  measure(params.messages, acc);
  return {
    tokens: Math.ceil(acc.chars / CHARS_PER_TOKEN_PESSIMISTIC) + acc.images * IMAGE_TOKENS_PESSIMISTIC,
    oversizedImage: acc.imageChars > MAX_IMAGE_BASE64_CHARS,
  };
}

/**
 * The most this one call can cost: its (bounded) input at the dearest input rate (the 1-hour cache write), every output token it is allowed, and a 10% margin
 * for a billing modifier the app does not use. An upper bound for RESERVING; the final cost is almost always far lower. An unpriced model has no maximum.
 */
export function maxCallCostUsd(params: MeterParams): number {
  const rates = ratesForKnownModel(params.model);
  const { tokens } = estimateInputTokens(params);
  const inputRate = rates ? Math.max(rates.input, rates.cacheWrite5m, rates.cacheWrite1h) : priceFor(params.model).input;
  const outputRate = rates ? rates.output : priceFor(params.model).output;
  return ((tokens * inputRate + params.max_tokens * outputRate) * UNRECOGNISED_COMPONENT_MARKUP) / 1_000_000;
}

export interface AiCallTicket {
  /** What was reserved for this call (its maximum), in USD. */
  readonly reservedUsd: number;
  /** The provider answered: replace the hold with the real, reported usage. */
  settle(usage: ProviderUsage): void;
  /** The call did not complete. Releases the hold (a rejected request) or records a flagged charge (unknown outcome; see the header). */
  fail(error: unknown, streamedOutputChars?: number): void;
}

export interface BeginInput {
  userId: string | null;
  feature: AiFeature;
  params: MeterParams;
}

/** True when the error is a provider answer with an HTTP status: the request was rejected, not billed. */
function wasRejectedByProvider(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400;
}

export function beginAiCall(input: BeginInput, nowMs: number = Date.now()): AiCallTicket {
  const { userId, feature, params } = input;

  const size = estimateInputTokens(params);
  if (size.oversizedImage || size.tokens > MAX_INPUT_TOKENS_ESTIMATE) throw new AiRequestTooLargeError();

  const memberCall = !!userId && isMemberAiFeature(feature);
  const kind: AiAllowanceKind = memberCall ? allowanceKindFor(userId, nowMs) : "staff";
  const enforced = aiAllowanceEnforced();
  const reserveUsd = maxCallCostUsd(params);
  let reservationId: string | null = null;

  if (enforced) {
    // Never reserve against a guessed price: an unpriced model is refused outright.
    if (ratesForKnownModel(params.model) === null) {
      console.error(`[ai-metering] refusing a call to a model with no known price: ${params.model}`);
      throw new AiAllowanceError(AI_ALLOWANCE_UNAVAILABLE_CODE, kind, ALLOWANCE_UNAVAILABLE_MESSAGE);
    }
    const pools = aiPoolBudgets();
    const budget = memberCall ? aiAllowanceBudgets()[kind as Exclude<AiAllowanceKind, "staff">] : pools.staff;
    // A member on a live free trial is NOT held to the shared trial pool. The pool decides whether a NEW trial may start (reserveTrialStart), but a trial the store has
    // confirmed is honoured up to the member's own trial allowance, wherever it was started (including outside our purchase flow, which we cannot control). It is
    // still bounded by that per-member cap, the emergency ceiling and the paid reserve, so it can never take capacity allocated to paid subscribers.
    const classPool = memberCall && kind !== "trial" ? memberClassPool(kind as Exclude<AiAllowanceKind, "staff">) : null;
    if (budget === null || pools.ceiling === null || pools.paid === null || (classPool && classPool.usd === null)) {
      throw new AiAllowanceError(AI_ALLOWANCE_UNAVAILABLE_CODE, kind, ALLOWANCE_UNAVAILABLE_MESSAGE);
    }
    if (kind === "free" && budget === 0) throw new AiAllowanceError(AI_UPGRADE_CODE, kind, UPGRADE_MESSAGE);

    const result = reserveAiBudget({
      userId,
      feature,
      kind,
      reserveUsd,
      budgetUsd: budget,
      windowMs: windowMsFor(kind) ?? (kind === "staff" ? AI_ALLOWANCE_WINDOW_MS : null),
      pool: !memberCall,
      classPool: classPool && classPool.usd !== null ? { kinds: classPool.kinds, usd: classPool.usd } : null,
      // Everything that is not a paid subscriber leaves the paid pool's unused remainder untouched inside the ceiling.
      protectPaidPoolUsd: pools.paid,
      ceilingUsd: pools.ceiling,
      ceilingWindowMs: AI_ALLOWANCE_WINDOW_MS,
      ttlMs: HOLD_TTL_MS,
      nowMs,
    });
    if (!result.ok) {
      if (result.limit === "ceiling" || result.limit === "pool") {
        // A shared pool or the emergency ceiling is the owner's, not the member's: members see "unavailable", never a number. A trial or free member is told
        // plainly that AI is unavailable on trials, not that they used something up.
        throw new AiAllowanceError(AI_ALLOWANCE_UNAVAILABLE_CODE, kind, kind === "trial" || kind === "free" ? TRIAL_AI_UNAVAILABLE_MESSAGE : ALLOWANCE_UNAVAILABLE_MESSAGE);
      }
      const resetsAt = memberCall && userId ? resetsAtFor(userId, kind, budget, reserveUsd, nowMs) : null;
      throw new AiAllowanceError(AI_ALLOWANCE_CODE, kind, allowanceMessage(kind, resetsAt), resetsAt);
    }
    reservationId = result.id;
  }

  let done = false;

  const row = (cost: { costUsd: number; tokens: { input: number; cacheWrite: number; cacheRead: number; output: number } }, estimated: boolean): AiUsageLogRecord => ({
    id: randomUUID(),
    userId,
    feature,
    model: params.model,
    inputTokens: cost.tokens.input,
    cacheWriteTokens: cost.tokens.cacheWrite,
    cacheReadTokens: cost.tokens.cacheRead,
    outputTokens: cost.tokens.output,
    costUsd: cost.costUsd,
    allowanceKind: kind,
    ...(estimated ? { estimated: true } : {}),
    createdAt: new Date().toISOString(),
  });

  return {
    reservedUsd: reserveUsd,
    settle(usage) {
      if (done) return;
      done = true;
      try {
        if (!enforced) {
          // Nothing reserved (development): log as before, tagged with its group.
          recordAiUsageFromResponse({ userId, feature, model: params.model, usage: { ...usage, output_tokens: usage.output_tokens } });
          return;
        }
        const cost = costFromUsage(params.model, usage);
        settleAiReservation(reservationId, row(cost, !cost.exact));
      } catch (err) {
        // Never lose the member's answer to a bookkeeping failure; the hold turns into a maximum-cost charge when it expires.
        console.error("[ai-metering] failed to settle reservation:", err);
      }
    },
    fail(error, streamedOutputChars) {
      if (done) return;
      done = true;
      try {
        if (!enforced) return;
        if (wasRejectedByProvider(error)) {
          settleAiReservation(reservationId, null);
          return;
        }
        // Unknown outcome: the provider may have completed.
        if (streamedOutputChars === undefined) {
          // A non-streaming call that did not report back: charge its full reserved maximum.
          settleAiReservation(reservationId, row({ costUsd: reserveUsd, tokens: { input: size.tokens, cacheWrite: 0, cacheRead: 0, output: 0 } }, true));
        } else {
          const outputTokens = Math.ceil(streamedOutputChars / STREAMED_CHARS_PER_TOKEN);
          const costUsd = costUsdFor({ model: params.model, inputTokens: size.tokens, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens });
          settleAiReservation(reservationId, row({ costUsd, tokens: { input: size.tokens, cacheWrite: 0, cacheRead: 0, output: outputTokens } }, true));
        }
      } catch (err) {
        console.error("[ai-metering] failed to release reservation:", err);
      }
    },
  };
}

/** `client.messages.create` under a reservation. The only way lib/ai.ts calls the provider for a message. */
export async function meteredCreate(
  client: Anthropic,
  ctx: { userId: string | null; feature: AiFeature },
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  const ticket = beginAiCall({ ...ctx, params });
  try {
    const message = await client.messages.create(params, providerRequestOptions());
    ticket.settle(message.usage as ProviderUsage);
    return message;
  } catch (err) {
    ticket.fail(err);
    throw err;
  }
}

/** `client.messages.stream` under a reservation. Settles on the final message; on an error, abort or early end it releases or records a charge. */
export function meteredStream(
  client: Anthropic,
  ctx: { userId: string | null; feature: AiFeature },
  params: Anthropic.MessageStreamParams
) {
  const ticket = beginAiCall({ ...ctx, params });
  let chars = 0;
  let settled = false;
  try {
    const stream = client.messages.stream(params, providerRequestOptions());
    stream.on("text", (delta) => {
      chars += delta.length;
    });
    stream.on("finalMessage", (message) => {
      settled = true;
      ticket.settle(message.usage as ProviderUsage);
    });
    stream.on("error", (err) => {
      settled = true;
      ticket.fail(err, chars);
    });
    stream.on("abort", (err) => {
      settled = true;
      ticket.fail(err, chars);
    });
    // 'end' fires last on every path; anything not yet settled is an unknown outcome.
    stream.on("end", () => {
      if (!settled) ticket.fail(new Error("stream ended without a final message"), chars);
    });
    return stream;
  } catch (err) {
    ticket.fail(err);
    throw err;
  }
}
