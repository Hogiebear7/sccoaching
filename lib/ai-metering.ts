// The one place a member's AI allowance is ENFORCED. Every provider call in lib/ai.ts that a member causes goes through here:
//
//   beginAiCall  ->  (provider call, NO datastore lock held, NOTHING held in memory)  ->  settle | fail
//
// 1. BEGIN. Refuse an oversized request outright (bounded input). Otherwise work out the most this ONE call could cost (the bounded input at the dearest
//    rate, plus every output token it is allowed to produce) and reserve that amount in a single atomic datastore turn (reserveAiBudget): spent + already-held
//    + this reservation must fit the member's budget, or the call is refused BEFORE the provider is contacted. Because the check and the hold are one turn,
//    any number of concurrent requests, in one process or many, can never be granted the same remaining budget.
// 2. CALL. The provider is called afterwards, with no lock held.
// 3. SETTLE. The reservation is replaced, in one write, by a usage row with the cost the provider actually reported.
//    FAIL. A provider error that carries an HTTP status was not billed: the hold is simply released. Anything else (a timeout, a dropped connection, an abort)
//    is an UNKNOWN outcome: the provider may have done the work, so a conservative ESTIMATE (the input, plus any output already received) is recorded,
//    flagged "estimated", rather than letting a failing call be free. A process that dies mid-call leaves a hold that expires by itself (HOLD_TTL_MS).
//
// With no budgets configured (development) nothing is reserved and calls behave as they did before allowances existed; usage is still logged.
// Staff-attributed features (coach summary, reply draft, exercise content) are not a member's allowance: they are role-gated, bounded by max_tokens and
// logged, and are not reserved here.

import { randomUUID } from "crypto";

import type Anthropic from "@anthropic-ai/sdk";

import {
  ALLOWANCE_UNAVAILABLE_MESSAGE,
  AI_ALLOWANCE_CODE,
  AI_ALLOWANCE_UNAVAILABLE_CODE,
  aiAllowanceBudgets,
  aiAllowanceEnforced,
  allowanceKindFor,
  allowanceMessage,
  resetsAtFor,
  windowMsFor,
} from "@/lib/ai-allowance";
import { CACHE_WRITE_MULTIPLIER, costUsdFor, priceFor, recordAiUsageFromResponse } from "@/lib/ai-usage";
import { reserveAiBudget, settleAiReservation, type AiAllowanceKind, type AiFeature, type AiUsageLogRecord } from "@/lib/db";

/** A hold left by a call that never settled (a crashed process) stops counting after this. Longer than any provider timeout below. */
export const HOLD_TTL_MS = 5 * 60 * 1000;
/** A provider call that has not answered by now is given up on (and counted as an unknown outcome). */
export const PROVIDER_TIMEOUT_MS = 90 * 1000;
/** One retry at most: a retry after a timeout is a second chance to be billed, and the hold covers one attempt's worth of output. */
export const PROVIDER_MAX_RETRIES = 1;

/** Bounded input. Characters are counted at 2 per token and an image at a flat 6,000 tokens, both deliberately pessimistic. */
export const MAX_INPUT_TOKENS_ESTIMATE = 60_000;
export const MAX_IMAGE_BASE64_CHARS = 8_000_000;
const CHARS_PER_TOKEN_PESSIMISTIC = 2;
const IMAGE_TOKENS_PESSIMISTIC = 6_000;
/** For an aborted or timed-out stream, output received so far is counted at 3 characters per token. */
const STREAMED_CHARS_PER_TOKEN = 3;

export const AI_REQUEST_OPTIONS = { timeout: PROVIDER_TIMEOUT_MS, maxRetries: PROVIDER_MAX_RETRIES } as const;

/** The features that spend a MEMBER's allowance. */
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
    readonly code: typeof AI_ALLOWANCE_CODE | typeof AI_ALLOWANCE_UNAVAILABLE_CODE,
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

/** The pessimistic input size of a request, in tokens, and how many of the images it carries are over the size cap. */
export function estimateInputTokens(params: Pick<MeterParams, "system" | "messages">): { tokens: number; oversizedImage: boolean } {
  const acc = { chars: 0, images: 0, imageChars: 0 };
  measure(params.system, acc);
  measure(params.messages, acc);
  return {
    tokens: Math.ceil(acc.chars / CHARS_PER_TOKEN_PESSIMISTIC) + acc.images * IMAGE_TOKENS_PESSIMISTIC,
    oversizedImage: acc.imageChars > MAX_IMAGE_BASE64_CHARS,
  };
}

/** The most this one call can cost: its (bounded) input at the cache-write rate plus every output token it is allowed. An ESTIMATE, always an upper bound. */
export function maxCallCostUsd(params: MeterParams): number {
  const { tokens } = estimateInputTokens(params);
  const price = priceFor(params.model);
  return (tokens * price.input * CACHE_WRITE_MULTIPLIER + params.max_tokens * price.output) / 1_000_000;
}

type Usage = { input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; output_tokens: number };

export interface AiCallTicket {
  /** The provider answered: replace the hold with the real, reported usage. */
  settle(usage: Usage): void;
  /** The call did not complete. Releases the hold, or records a flagged estimate when the outcome is unknown. */
  fail(error: unknown, outputCharsReceived?: number): void;
}

export interface BeginInput {
  userId: string | null;
  feature: AiFeature;
  params: MeterParams;
}

const NOOP_TICKET_FOR_UNMETERED = (input: BeginInput): AiCallTicket => {
  let done = false;
  return {
    settle(usage) {
      if (done) return;
      done = true;
      recordAiUsageFromResponse({ userId: input.userId, feature: input.feature, model: input.params.model, usage });
    },
    fail() {
      done = true;
    },
  };
};

/** True when the error is a provider answer with an HTTP status: the request was rejected, not billed. */
function wasRejectedByProvider(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400;
}

export function beginAiCall(input: BeginInput, nowMs: number = Date.now()): AiCallTicket {
  const { userId, feature, params } = input;
  if (!userId || !isMemberAiFeature(feature)) return NOOP_TICKET_FOR_UNMETERED(input);

  const size = estimateInputTokens(params);
  if (size.oversizedImage || size.tokens > MAX_INPUT_TOKENS_ESTIMATE) throw new AiRequestTooLargeError();

  const kind = allowanceKindFor(userId, nowMs);
  const enforced = aiAllowanceEnforced();
  let reservationId: string | null = null;

  if (enforced) {
    const budget = aiAllowanceBudgets()[kind];
    if (budget === null) throw new AiAllowanceError(AI_ALLOWANCE_UNAVAILABLE_CODE, kind, ALLOWANCE_UNAVAILABLE_MESSAGE);
    const reserveUsd = maxCallCostUsd(params);
    const result = reserveAiBudget({ userId, feature, kind, reserveUsd, budgetUsd: budget, windowMs: windowMsFor(kind), ttlMs: HOLD_TTL_MS, nowMs });
    if (!result.ok) {
      const resetsAt = resetsAtFor(userId, kind, budget, reserveUsd, nowMs);
      throw new AiAllowanceError(AI_ALLOWANCE_CODE, kind, allowanceMessage(kind, resetsAt), resetsAt);
    }
    reservationId = result.id;
  }

  const inputTokens = size.tokens;
  let done = false;

  const row = (usage: { input: number; cacheWrite: number; cacheRead: number; output: number }, estimated: boolean): AiUsageLogRecord => ({
    id: randomUUID(),
    userId,
    feature,
    model: params.model,
    inputTokens: usage.input,
    cacheWriteTokens: usage.cacheWrite,
    cacheReadTokens: usage.cacheRead,
    outputTokens: usage.output,
    costUsd: costUsdFor({ model: params.model, inputTokens: usage.input, cacheWriteTokens: usage.cacheWrite, cacheReadTokens: usage.cacheRead, outputTokens: usage.output }),
    allowanceKind: kind,
    ...(estimated ? { estimated: true } : {}),
    createdAt: new Date().toISOString(),
  });

  return {
    settle(usage) {
      if (done) return;
      done = true;
      try {
        settleAiReservation(
          reservationId,
          row({ input: usage.input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, output: usage.output_tokens }, false)
        );
      } catch (err) {
        // Never lose the member's answer to a bookkeeping failure; the hold expires by itself.
        console.error("[ai-metering] failed to settle reservation:", err);
      }
    },
    fail(error, outputCharsReceived = 0) {
      if (done) return;
      done = true;
      try {
        if (wasRejectedByProvider(error)) {
          settleAiReservation(reservationId, null);
          return;
        }
        // Unknown outcome: count what we are sure was sent, and any output already received.
        const outputTokens = Math.ceil(outputCharsReceived / STREAMED_CHARS_PER_TOKEN);
        settleAiReservation(reservationId, row({ input: inputTokens, cacheWrite: 0, cacheRead: 0, output: outputTokens }, true));
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
    const message = await client.messages.create(params, AI_REQUEST_OPTIONS);
    ticket.settle(message.usage);
    return message;
  } catch (err) {
    ticket.fail(err);
    throw err;
  }
}

/** `client.messages.stream` under a reservation. Settles on the final message; on an error, abort or early end it releases or records an estimate. */
export function meteredStream(
  client: Anthropic,
  ctx: { userId: string | null; feature: AiFeature },
  params: Anthropic.MessageStreamParams
) {
  const ticket = beginAiCall({ ...ctx, params });
  let chars = 0;
  let settled = false;
  try {
    const stream = client.messages.stream(params, AI_REQUEST_OPTIONS);
    stream.on("text", (delta) => {
      chars += delta.length;
    });
    stream.on("finalMessage", (message) => {
      settled = true;
      ticket.settle(message.usage);
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
