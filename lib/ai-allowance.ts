// A bounded AI allowance per member, enforced on the server from the shared datastore.
//
// WHY: every AI call costs real money (logged per call, from the token counts the provider reports, in aiUsageLogs). A flat subscription price with uncapped AI
// cost is not a business the owner can reason about, and a free trial multiplies the exposure. So every member has a cost allowance in USD, and the
// allowance depends on WHAT THEY HOLD, never on what they ask for:
//
//   free            no digital plan. Covers the AI features a free member can still reach (photo and description food scans, receipts, exercise alternatives,
//                   programme check-ins). Rolling 30 days.
//   trial           a store free trial. ONE TOTAL for the whole trial: it is a lifetime total per account, so cancelling, reinstalling, restoring, converting or
//                   starting a trial on the other store never replenishes it. Trial use is tagged "trial" and never counts toward the paid allowance.
//   paid            a paid store subscription. Rolling 30 days. It begins at the first request made after the plan stops being a trial (conversion): trial
//                   use is not counted against it.
//   complimentary   staff-granted or legacy complimentary access. Rolling 30 days, with its OWN budget: a complimentary member is neither a trial nor a paid
//                   member and is never silently given either allowance.
//
// A member who holds several: paid beats trial beats complimentary beats free (the larger real entitlement a person actually pays for decides; a grant or a
// trial never lifts a paying member down, and a complimentary grant never replaces a trial's smaller total).
//
// ACROSS PROCESSES: nothing is kept in memory. The pre-check here sums the logged costs from the shared datastore, and the hard guarantee is the atomic
// reservation in lib/ai-metering.ts (one datastore turn per reservation, no lock held during a provider call).
//
// THE NUMBERS ARE NOT IN THE CODE. They are the owner's, in the environment (USD):
//   AI_ALLOWANCE_FREE_USD  AI_ALLOWANCE_TRIAL_USD  AI_ALLOWANCE_PAID_USD  AI_ALLOWANCE_COMPLIMENTARY_USD
// A value of 0 is valid and means "none" for that group. Unset means NOT SET. If NONE are set, nothing is enforced (the behaviour before this existed:
// development). If any is set, enforcement is ON and a group whose budget is unset is refused (fail closed, code "ai_allowance_unavailable"). A store
// purchase cannot be started until all four are set (aiAllowanceConfigured), so a plan is never sold with uncapped or undefined AI cost.

import { aiSpendUsd, findAiUsageLogsByUserId, findDigitalEntitlementsByUserId, type AiAllowanceKind } from "@/lib/db";
import { liveDigitalEntitlements } from "@/lib/digital-entitlement";

export const AI_ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_ALLOWANCE_CODE = "ai_allowance_reached";
export const AI_ALLOWANCE_UNAVAILABLE_CODE = "ai_allowance_unavailable";

const ENV: Record<AiAllowanceKind, string> = {
  free: "AI_ALLOWANCE_FREE_USD",
  trial: "AI_ALLOWANCE_TRIAL_USD",
  paid: "AI_ALLOWANCE_PAID_USD",
  complimentary: "AI_ALLOWANCE_COMPLIMENTARY_USD",
};

export const ALLOWANCE_KINDS = Object.keys(ENV) as AiAllowanceKind[];

function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function aiAllowanceBudgets(): Record<AiAllowanceKind, number | null> {
  return { free: parseBudget(process.env[ENV.free]), trial: parseBudget(process.env[ENV.trial]), paid: parseBudget(process.env[ENV.paid]), complimentary: parseBudget(process.env[ENV.complimentary]) };
}

/** At least one budget is set, so enforcement is on. With none set nothing is enforced (development). */
export function aiAllowanceEnforced(): boolean {
  return ALLOWANCE_KINDS.some((k) => aiAllowanceBudgets()[k] !== null);
}

/** All four budgets are set, so a plan can be sold with a defined AI cost. */
export function aiAllowanceConfigured(): boolean {
  const b = aiAllowanceBudgets();
  return ALLOWANCE_KINDS.every((k) => b[k] !== null);
}

/** A trial's total is for the whole trial; every other allowance is a rolling window. */
export const windowMsFor = (kind: AiAllowanceKind): number | null => (kind === "trial" ? null : AI_ALLOWANCE_WINDOW_MS);

export function allowanceKindFor(userId: string, nowMs: number): AiAllowanceKind {
  const live = liveDigitalEntitlements(findDigitalEntitlementsByUserId(userId), nowMs);
  if (live.some((e) => e.source !== "staff_grant" && e.trial !== true)) return "paid";
  if (live.some((e) => e.source !== "staff_grant" && e.trial === true)) return "trial";
  if (live.length > 0) return "complimentary";
  return "free";
}

export const ALLOWANCE_COVERS =
  "AI features: coach and nutrition-coach chat, programme generation and check-ins, meal ideas, food photo and description scans, receipt and tracker scans, exercise alternatives and workout reviews";

export function allowanceMessage(kind: AiAllowanceKind, resetsAt: string | null, format: (iso: string) => string = (iso) => iso.slice(0, 10)): string {
  const tail = "Your subscription and everything else in the app are unaffected; only the AI features pause.";
  switch (kind) {
    case "trial":
      return `You've used the AI allowance included with your free trial. It doesn't renew during the trial, and your paid AI allowance starts when the trial becomes a paid plan. ${tail}`;
    case "paid":
      return `You've used your AI allowance. It is measured over a rolling 30 days: AI use older than 30 days stops counting${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
    case "complimentary":
      return `You've used the AI allowance that comes with your complimentary access. It is measured over a rolling 30 days${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
    default:
      return `You've used the AI allowance included without a subscription. It is measured over a rolling 30 days${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
  }
}

export const ALLOWANCE_UNAVAILABLE_MESSAGE = "AI features aren't available right now. Nothing else in the app is affected.";

/** When enough of the oldest counted use ages out of the rolling window for `neededUsd` to fit under the budget. Null for a trial (it does not renew) or when it can never fit. */
export function resetsAtFor(userId: string, kind: AiAllowanceKind, budgetUsd: number, neededUsd: number, nowMs: number): string | null {
  const windowMs = windowMsFor(kind);
  if (windowMs === null || neededUsd > budgetUsd) return null;
  const logs = findAiUsageLogsByUserId(userId)
    .filter((l) => (l.allowanceKind === kind || (l.allowanceKind === undefined && kind !== "trial")) && new Date(l.createdAt).getTime() >= nowMs - windowMs)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let spent = logs.reduce((s, l) => s + l.costUsd, 0);
  for (const l of logs) {
    spent -= l.costUsd;
    if (spent + neededUsd <= budgetUsd + 1e-9) return new Date(new Date(l.createdAt).getTime() + windowMs).toISOString();
  }
  return null;
}

export type AllowanceResult =
  | { ok: true; enforced: boolean; kind: AiAllowanceKind; remainingUsd: number | null }
  | { ok: false; reason: "reached"; kind: AiAllowanceKind; resetsAt: string | null; message: string }
  | { ok: false; reason: "unavailable"; kind: AiAllowanceKind; message: string };

// The cheap pre-check each route makes so a member over their allowance gets a clear answer before any work. It is NOT the guarantee: the atomic reservation is.
export function checkAiAllowance(userId: string, nowMs: number = Date.now()): AllowanceResult {
  const kind = allowanceKindFor(userId, nowMs);
  if (!aiAllowanceEnforced()) return { ok: true, enforced: false, kind, remainingUsd: null };
  const budget = aiAllowanceBudgets()[kind];
  if (budget === null) return { ok: false, reason: "unavailable", kind, message: ALLOWANCE_UNAVAILABLE_MESSAGE };

  const spent = aiSpendUsd(findAiUsageLogsByUserId(userId), userId, kind, windowMsFor(kind), nowMs);
  if (spent < budget) return { ok: true, enforced: true, kind, remainingUsd: budget - spent };
  return { ok: false, reason: "reached", kind, resetsAt: resetsAtFor(userId, kind, budget, 0, nowMs), message: allowanceMessage(kind, resetsAtFor(userId, kind, budget, 0, nowMs)) };
}
