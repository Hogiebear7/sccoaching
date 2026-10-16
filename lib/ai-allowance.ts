// A bounded AI allowance per member, enforced on the server from the shared datastore.
//
// WHY: every AI call costs real money (logged exactly, per call, in aiUsageLogs from the token counts the provider reports), and the only limit before this
// was a per-minute burst limit. A flat subscription price with uncapped AI cost is not a business the owner can reason about, and a free trial multiplies
// the exposure. So each member has a spend allowance over a rolling 30 days, in USD cost, with a smaller one while they are on a free trial.
//
// ACROSS PROCESSES: nothing is kept in memory. Each check sums the member's logged costs from the shared datastore (one file, one lock for every process),
// so every server process sees the same total. The check happens BEFORE the provider call and the cost is logged AFTER it, so requests that overlap can
// overshoot by at most the cost of the calls already in flight; the existing per-route burst limits bound that.
//
// THE NUMBERS ARE NOT IN THE CODE. They are the owner's, set in the environment:
//   AI_ALLOWANCE_PAID_USD   cost allowance per rolling 30 days for a paid (or complimentary) member
//   AI_ALLOWANCE_TRIAL_USD  cost allowance per rolling 30 days while the member's plan is a free trial
// Unset or not a positive number means NOT ENFORCED (the behaviour before this file existed), and aiAllowanceConfigured() is false: the purchase routes
// refuse to start a purchase until both are set, so a subscription is never sold with uncapped AI cost by accident.
//
// What a member sees when the allowance is used up is plain: the feature answers 429 with code "ai_allowance_reached" and the date it frees up again.
// Nothing here advertises or implies unlimited AI.

import { findAiUsageLogsByUserId, findDigitalEntitlementsByUserId } from "@/lib/db";
import { liveDigitalEntitlements } from "@/lib/digital-entitlement";

export const AI_ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_ALLOWANCE_CODE = "ai_allowance_reached";

function parseBudget(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function aiAllowanceBudgets(): { paidUsd: number | null; trialUsd: number | null } {
  return { paidUsd: parseBudget(process.env.AI_ALLOWANCE_PAID_USD), trialUsd: parseBudget(process.env.AI_ALLOWANCE_TRIAL_USD) };
}

/** Both budgets are set, so a plan can be sold without uncapped AI cost. */
export function aiAllowanceConfigured(): boolean {
  const b = aiAllowanceBudgets();
  return b.paidUsd !== null && b.trialUsd !== null;
}

export type AllowanceKind = "paid" | "trial";

// A member whose only live digital entitlement is a free trial gets the trial allowance. Anyone else with access (paid, complimentary, legacy) gets the paid one.
export function allowanceKindFor(userId: string, nowMs: number): AllowanceKind {
  const live = liveDigitalEntitlements(findDigitalEntitlementsByUserId(userId), nowMs);
  return live.length > 0 && live.every((e) => e.trial === true) ? "trial" : "paid";
}

export type AllowanceResult =
  | { ok: true; enforced: boolean; kind: AllowanceKind; remainingUsd: number | null }
  | { ok: false; kind: AllowanceKind; resetsAt: string; message: string };

export const ALLOWANCE_MESSAGE =
  "You've used your AI allowance for now. It frees up gradually as your earlier use passes 30 days. The rest of the app keeps working.";

export function checkAiAllowance(userId: string, nowMs: number = Date.now()): AllowanceResult {
  const kind = allowanceKindFor(userId, nowMs);
  const budget = kind === "trial" ? aiAllowanceBudgets().trialUsd : aiAllowanceBudgets().paidUsd;
  if (budget === null) return { ok: true, enforced: false, kind, remainingUsd: null };

  const since = nowMs - AI_ALLOWANCE_WINDOW_MS;
  const inWindow = findAiUsageLogsByUserId(userId)
    .filter((l) => new Date(l.createdAt).getTime() >= since)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let spent = inWindow.reduce((sum, l) => sum + l.costUsd, 0);

  if (spent < budget) return { ok: true, enforced: true, kind, remainingUsd: budget - spent };

  // When does enough of the oldest use fall out of the window to get back under the budget?
  let resetsAtMs = nowMs + AI_ALLOWANCE_WINDOW_MS;
  for (const l of inWindow) {
    spent -= l.costUsd;
    if (spent < budget) {
      resetsAtMs = new Date(l.createdAt).getTime() + AI_ALLOWANCE_WINDOW_MS;
      break;
    }
  }
  return { ok: false, kind, resetsAt: new Date(resetsAtMs).toISOString(), message: ALLOWANCE_MESSAGE };
}
