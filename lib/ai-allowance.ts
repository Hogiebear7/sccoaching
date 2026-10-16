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
// SHARED POOLS sit above the per-member groups, because per-member allowances alone do not cap total spending (all rolling 30 days, all users together):
//   trial pool          trial AND free-tier use (the acquisition spend), across all accounts
//   paid pool           paid subscribers
//   complimentary pool  complimentary access, counted explicitly: it is a cost to the business even though nobody pays for it
//   staff pool          the staff-run features (coach summary, reply draft, exercise content)
//   ceiling             an EMERGENCY ceiling on ALL AI spending. Reaching it stops AI for everyone, paid subscribers included. It is a last resort, not a promise
//                       of uninterrupted paid access.
// SEPARATION IS ENFORCED, not just planned: every class is held to its own pool, and trial, free, complimentary and staff calls must also leave the paid pool's
// UNUSED remainder untouched inside the ceiling (see reserveAiBudget). So no amount of trial, staff, free or complimentary use can take capacity allocated to
// paid subscribers; only the paid pool's own use, or a ceiling set below the paid pool (rejected by aiAllowanceConfigured), can. A new trial is only
// represented as available while the trial pool can honour it (trialCapacity).
//
// THE NUMBERS ARE NOT IN THE CODE. They are the owner's, in the environment (USD):
//   per member: AI_ALLOWANCE_FREE_USD  AI_ALLOWANCE_TRIAL_USD  AI_ALLOWANCE_PAID_USD  AI_ALLOWANCE_COMPLIMENTARY_USD
//   shared:     AI_TRIAL_POOL_USD  AI_PAID_POOL_USD  AI_COMPLIMENTARY_POOL_USD  AI_STAFF_USD  AI_APP_CEILING_USD
// A value of 0 is valid and means "none". Unset means NOT SET. If NONE are set, nothing is enforced (the behaviour before this existed: development). If any
// is set, enforcement is ON and anything whose budget is unset is refused (fail closed, code "ai_allowance_unavailable"). The model must also have a known
// price. A store purchase cannot be started until all nine are set, the ceiling is at least the paid pool, and the model is priced (aiAllowanceConfigured).

import { configuredAiModel } from "@/lib/ai-model";
import { ratesForKnownModel } from "@/lib/ai-usage";
import { aiCapacitySnapshot, aiSpendUsd, findAiUsageLogsByUserId, findAllAiUsageLogs, findAllDigitalEntitlements, findDigitalEntitlementsByUserId, type AiAllowanceKind } from "@/lib/db";
import { liveDigitalEntitlements } from "@/lib/digital-entitlement";

/** The four groups a MEMBER can be in ("staff" is the shared pool for staff-run features, not a member group). */
export type MemberAllowanceKind = Exclude<AiAllowanceKind, "staff">;

export const AI_ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_ALLOWANCE_CODE = "ai_allowance_reached";
export const AI_ALLOWANCE_UNAVAILABLE_CODE = "ai_allowance_unavailable";
/** A member in the free group whose budget is 0: the feature is part of the subscription. A friendly upgrade message, not an error about spending. */
export const AI_UPGRADE_CODE = "ai_upgrade_required";

const ENV: Record<MemberAllowanceKind, string> = {
  free: "AI_ALLOWANCE_FREE_USD",
  trial: "AI_ALLOWANCE_TRIAL_USD",
  paid: "AI_ALLOWANCE_PAID_USD",
  complimentary: "AI_ALLOWANCE_COMPLIMENTARY_USD",
};

export const ALLOWANCE_KINDS = Object.keys(ENV) as MemberAllowanceKind[];
const ENV_STAFF = "AI_STAFF_USD";
const ENV_CEILING = "AI_APP_CEILING_USD";
const ENV_TRIAL_POOL = "AI_TRIAL_POOL_USD";
const ENV_PAID_POOL = "AI_PAID_POOL_USD";
const ENV_COMPLIMENTARY_POOL = "AI_COMPLIMENTARY_POOL_USD";

function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function aiAllowanceBudgets(): Record<MemberAllowanceKind, number | null> {
  return { free: parseBudget(process.env[ENV.free]), trial: parseBudget(process.env[ENV.trial]), paid: parseBudget(process.env[ENV.paid]), complimentary: parseBudget(process.env[ENV.complimentary]) };
}

/** The shared pools (all users together) and the app-wide emergency ceiling. */
export function aiPoolBudgets(): { staff: number | null; ceiling: number | null; trial: number | null; paid: number | null; complimentary: number | null } {
  return {
    staff: parseBudget(process.env[ENV_STAFF]),
    ceiling: parseBudget(process.env[ENV_CEILING]),
    trial: parseBudget(process.env[ENV_TRIAL_POOL]),
    paid: parseBudget(process.env[ENV_PAID_POOL]),
    complimentary: parseBudget(process.env[ENV_COMPLIMENTARY_POOL]),
  };
}

/** The shared pool a member group draws on: trial and free share the acquisition pool. Null when that pool is not set. */
export function memberClassPool(kind: MemberAllowanceKind): { kinds: AiAllowanceKind[]; usd: number | null } {
  const p = aiPoolBudgets();
  if (kind === "paid") return { kinds: ["paid"], usd: p.paid };
  if (kind === "complimentary") return { kinds: ["complimentary"], usd: p.complimentary };
  return { kinds: ["trial", "free"], usd: p.trial };
}

/** At least one budget is set, so enforcement is on. With none set nothing is enforced (development). */
export function aiAllowanceEnforced(): boolean {
  const p = aiPoolBudgets();
  return ALLOWANCE_KINDS.some((k) => aiAllowanceBudgets()[k] !== null) || Object.values(p).some((v) => v !== null);
}

/** The emergency ceiling must be at least the paid pool, or it could stop paid use that the pools say is allocated. */
export function aiPoolsConsistent(): boolean {
  const p = aiPoolBudgets();
  return p.ceiling !== null && p.paid !== null && p.ceiling >= p.paid;
}

/** The configured model has a known price. An unpriced model is never reserved against (it would be a guess). */
export function aiModelPriced(): boolean {
  return ratesForKnownModel(configuredAiModel()) !== null;
}

/** All nine budgets are set, the ceiling covers the paid pool, and the model is priced, so a plan can be sold with a defined AI cost. */
export function aiAllowanceConfigured(): boolean {
  const b = aiAllowanceBudgets();
  const p = aiPoolBudgets();
  return (
    ALLOWANCE_KINDS.every((k) => b[k] !== null) &&
    p.staff !== null &&
    p.ceiling !== null &&
    p.trial !== null &&
    p.paid !== null &&
    p.complimentary !== null &&
    aiPoolsConsistent() &&
    aiModelPriced()
  );
}

export type TrialCapacity = { available: true } | { available: false; reason: "not_configured" | "pool_full" | "ceiling_reached" };

/**
 * Whether a NEW free trial could be honoured with its intended AI allowance right now. The store, not this server, starts a trial, so this cannot stop one; it
 * decides whether the app may REPRESENT the trial (and its AI) as available. Capacity counts what the trial pool and the ceiling still hold after the AI each
 * LIVE trial is still entitled to (so many trials started at once cannot oversell the pool), and must fit one more full trial allowance. Advisory, not a
 * reservation: the reservation in reserveAiBudget stays the hard guarantee. With nothing configured (development) there is no AI limit to protect.
 */
export function trialCapacity(nowMs: number = Date.now()): TrialCapacity {
  if (!aiAllowanceEnforced()) return { available: true };
  if (!aiAllowanceConfigured()) return { available: false, reason: "not_configured" };
  const perTrial = aiAllowanceBudgets().trial as number;
  const pools = aiPoolBudgets();
  const snap = aiCapacitySnapshot(nowMs);
  const logs = findAllAiUsageLogs();
  const liveTrials = liveDigitalEntitlements(findAllDigitalEntitlements(), nowMs).filter((e) => e.trial === true && e.source !== "staff_grant");
  const committed = liveTrials.reduce((s, e) => s + Math.max(0, perTrial - aiSpendUsd(logs, e.userId, "trial", null, nowMs)), 0);

  const poolFree = (pools.trial as number) - snap.trialClass.spentUsd - snap.trialClass.heldUsd - committed;
  if (poolFree + 1e-9 < perTrial) return { available: false, reason: "pool_full" };
  const paidRemainder = Math.max(0, (pools.paid as number) - snap.paid.spentUsd - snap.paid.heldUsd);
  const ceilingFree = (pools.ceiling as number) - snap.all.spentUsd - snap.all.heldUsd - paidRemainder - committed;
  if (ceilingFree + 1e-9 < perTrial) return { available: false, reason: "ceiling_reached" };
  return { available: true };
}

/** A trial's total is for the whole trial; every other allowance is a rolling window. */
export const windowMsFor = (kind: AiAllowanceKind): number | null => (kind === "trial" ? null : AI_ALLOWANCE_WINDOW_MS);

export function allowanceKindFor(userId: string, nowMs: number): MemberAllowanceKind {
  const live = liveDigitalEntitlements(findDigitalEntitlementsByUserId(userId), nowMs);
  if (live.some((e) => e.source !== "staff_grant" && e.trial !== true)) return "paid";
  if (live.some((e) => e.source !== "staff_grant" && e.trial === true)) return "trial";
  if (live.length > 0) return "complimentary";
  return "free";
}

export const ALLOWANCE_COVERS =
  "AI features: coach and nutrition-coach chat, programme generation and check-ins, meal ideas, food photo and description scans, receipt and tracker scans, exercise alternatives and workout reviews";

export const UPGRADE_MESSAGE =
  "This AI feature is part of the App Subscription. Everything else in the app, including logging food and workouts, still works.";

export function allowanceMessage(kind: AiAllowanceKind, resetsAt: string | null, format: (iso: string) => string = (iso) => iso.slice(0, 10)): string {
  const tail = "Your subscription and everything else in the app are unaffected; only the AI features pause.";
  switch (kind) {
    case "trial":
      return `You've used the AI allowance included with your free trial. It doesn't renew during the trial, and your paid AI allowance starts when the trial becomes a paid plan. ${tail}`;
    case "paid":
      return `You've used your AI allowance. It is measured over a rolling 30 days: AI use older than 30 days stops counting${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
    case "staff":
      return "The team's shared AI allowance for this period is used up. Nothing else in the app is affected.";
    case "complimentary":
      return `You've used the AI allowance that comes with your complimentary access. It is measured over a rolling 30 days${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
    default:
      return `You've used the AI allowance included without a subscription. It is measured over a rolling 30 days${resetsAt ? `, so more is available from ${format(resetsAt)}` : ""}. ${tail}`;
  }
}

export const ALLOWANCE_UNAVAILABLE_MESSAGE = "AI features aren't available right now. Nothing else in the app is affected.";
export const TRIAL_AI_UNAVAILABLE_MESSAGE = "AI features aren't available on free trials right now. Your trial, your subscription and everything else in the app are unaffected.";

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
  | { ok: true; enforced: boolean; kind: MemberAllowanceKind; remainingUsd: number | null }
  | { ok: false; reason: "reached"; kind: MemberAllowanceKind; resetsAt: string | null; message: string }
  | { ok: false; reason: "upgrade"; kind: "free"; message: string }
  | { ok: false; reason: "unavailable"; kind: MemberAllowanceKind; message: string };

// The cheap pre-check each route makes so a member over their allowance gets a clear answer before any work. It is NOT the guarantee: the atomic reservation is.
export function checkAiAllowance(userId: string, nowMs: number = Date.now()): AllowanceResult {
  const kind = allowanceKindFor(userId, nowMs);
  if (!aiAllowanceEnforced()) return { ok: true, enforced: false, kind, remainingUsd: null };
  const budget = aiAllowanceBudgets()[kind];
  if (budget === null) return { ok: false, reason: "unavailable", kind, message: ALLOWANCE_UNAVAILABLE_MESSAGE };
  if (kind === "free" && budget === 0) return { ok: false, reason: "upgrade", kind, message: UPGRADE_MESSAGE };

  const spent = aiSpendUsd(findAiUsageLogsByUserId(userId), userId, kind, windowMsFor(kind), nowMs);
  if (spent < budget) return { ok: true, enforced: true, kind, remainingUsd: budget - spent };
  return { ok: false, reason: "reached", kind, resetsAt: resetsAtFor(userId, kind, budget, 0, nowMs), message: allowanceMessage(kind, resetsAtFor(userId, kind, budget, 0, nowMs)) };
}
