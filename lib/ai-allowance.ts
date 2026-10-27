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
// THE NUMBERS ARE NOT IN THE CODE. They are the owner's, in the environment, in EUROS (the owner runs the business in euros):
//   per member: AI_ALLOWANCE_FREE_EUR  AI_ALLOWANCE_TRIAL_EUR  AI_ALLOWANCE_PAID_EUR  AI_ALLOWANCE_COMPLIMENTARY_EUR
//   shared:     AI_TRIAL_POOL_EUR  AI_PAID_POOL_EUR  AI_COMPLIMENTARY_POOL_EUR  AI_STAFF_EUR  AI_APP_CEILING_EUR
// Anthropic bills in US dollars and every call is costed in USD, so each euro budget is converted ONCE, here, at AI_USD_PER_EUR (default 1.05). The rate is
// deliberately below the market rate: a lower rate turns each euro into fewer dollars, so a weaker euro can never let spending pass the euro figure. The older
// *_USD names are still read when the *_EUR one is unset (tests and any setup made before this change).
// A value of 0 is valid and means "none". Unset means NOT SET. If NONE are set, nothing is enforced (the behaviour before this existed: development). If any
// is set, enforcement is ON and anything whose budget is unset is refused (fail closed, code "ai_allowance_unavailable"). The model must also have a known
// price. A store purchase cannot be started until all nine are set, the ceiling is at least the paid pool, and the model is priced (aiAllowanceConfigured).

import { configuredAiModel } from "@/lib/ai-model";
import { ratesForKnownModel } from "@/lib/ai-usage";
import { aiSpendUsd, aiTrialHeadroom, findAiUsageLogsByUserId, findDigitalEntitlementsByUserId, findProfileByUserId, reserveTrialSlot, type AiAllowanceKind, type TrialHeadroomConfig } from "@/lib/db";
import { describeDigitalPlan, isDigitalEntitlementLive, liveDigitalEntitlements, type DigitalPlanSummary } from "@/lib/digital-entitlement";

/** The four groups a MEMBER can be in ("staff" is the shared pool for staff-run features, not a member group). */
export type MemberAllowanceKind = Exclude<AiAllowanceKind, "staff">;

export const AI_ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_ALLOWANCE_CODE = "ai_allowance_reached";
export const AI_ALLOWANCE_UNAVAILABLE_CODE = "ai_allowance_unavailable";
/** A member in the free group whose budget is 0: the feature is part of the subscription. A friendly upgrade message, not an error about spending. */
export const AI_UPGRADE_CODE = "ai_upgrade_required";

// Setting names without their currency suffix: "<name>_EUR" is read first, then "<name>_USD".
const ENV: Record<MemberAllowanceKind, string> = {
  free: "AI_ALLOWANCE_FREE",
  trial: "AI_ALLOWANCE_TRIAL",
  paid: "AI_ALLOWANCE_PAID",
  complimentary: "AI_ALLOWANCE_COMPLIMENTARY",
};

export const ALLOWANCE_KINDS = Object.keys(ENV) as MemberAllowanceKind[];
const ENV_STAFF = "AI_STAFF";
const ENV_CEILING = "AI_APP_CEILING";
const ENV_TRIAL_POOL = "AI_TRIAL_POOL";
const ENV_PAID_POOL = "AI_PAID_POOL";
const ENV_COMPLIMENTARY_POOL = "AI_COMPLIMENTARY_POOL";

/** Conservative planning rate for AI budgets (US dollars per euro). Below the market rate on purpose: see the header. */
export const DEFAULT_AI_USD_PER_EUR = 1.05;

function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The rate euro budgets are converted at. An unset or implausible value (outside 0.5 to 2) falls back to the conservative default. */
export function aiUsdPerEur(): number {
  const n = parseBudget(process.env.AI_USD_PER_EUR);
  return n !== null && n >= 0.5 && n <= 2 ? n : DEFAULT_AI_USD_PER_EUR;
}

/** One budget, in USD for the metering: the euro setting converted, or the older dollar setting when no euro one is set. */
function budgetUsd(name: string): number | null {
  const eur = parseBudget(process.env[`${name}_EUR`]);
  if (eur !== null) return eur * aiUsdPerEur();
  return parseBudget(process.env[`${name}_USD`]);
}

export function aiAllowanceBudgets(): Record<MemberAllowanceKind, number | null> {
  return { free: budgetUsd(ENV.free), trial: budgetUsd(ENV.trial), paid: budgetUsd(ENV.paid), complimentary: budgetUsd(ENV.complimentary) };
}

/** The shared pools (all users together) and the app-wide emergency ceiling. */
export function aiPoolBudgets(): { staff: number | null; ceiling: number | null; trial: number | null; paid: number | null; complimentary: number | null } {
  return {
    staff: budgetUsd(ENV_STAFF),
    ceiling: budgetUsd(ENV_CEILING),
    trial: budgetUsd(ENV_TRIAL_POOL),
    paid: budgetUsd(ENV_PAID_POOL),
    complimentary: budgetUsd(ENV_COMPLIMENTARY_POOL),
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

/** How long a claim on trial capacity is held for a member who has not finished the store checkout. Long enough for a slow sheet, short enough that abandoned ones free up. */
export const TRIAL_SLOT_TTL_MS = 30 * 60 * 1000;
export const TRIALS_UNAVAILABLE_MESSAGE = "Free trials are temporarily unavailable. Please try again later.";

function trialHeadroomConfig(): TrialHeadroomConfig | null {
  if (!aiAllowanceConfigured()) return null;
  const pools = aiPoolBudgets();
  return {
    perTrialUsd: aiAllowanceBudgets().trial as number,
    trialPoolUsd: pools.trial as number,
    paidPoolUsd: pools.paid as number,
    ceilingUsd: pools.ceiling as number,
    isLiveEntitlement: (e, nowMs) => isDigitalEntitlementLive(e, nowMs),
  };
}

/**
 * Claims one trial's worth of capacity BEFORE our purchase flow starts (called from purchase-context when the app says it is starting a trial). Atomic across
 * processes and holding no lock during the store's sheet: see reserveTrialSlot. Refused means the app must not start a trial purchase. In development, with nothing
 * configured, there is no AI limit to protect and the claim is simply granted.
 *
 * LIMIT, stated plainly: this controls OUR flow only. The stores decide eligibility and can start a trial outside it (the App Store or Play Store page, an offer code, a
 * promotional link, a restore on another device). Such a confirmed trial is never rejected; it is honoured (see the trial branch of beginAiCall in lib/ai-metering.ts).
 */
export function reserveTrialStart(userId: string, nowMs: number = Date.now()): { ok: true } | { ok: false; reason: "not_configured" | "pool_full" | "ceiling_reached" } {
  if (!aiAllowanceEnforced()) return { ok: true };
  const cfg = trialHeadroomConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };
  const slot = reserveTrialSlot({ ...cfg, userId, ttlMs: TRIAL_SLOT_TTL_MS, nowMs });
  return slot.ok ? { ok: true } : { ok: false, reason: slot.reason };
}

/**
 * Whether a NEW free trial could be honoured with its intended AI allowance right now. The store, not this server, starts a trial, so this cannot stop one; it
 * decides whether the app may REPRESENT the trial (and its AI) as available. Capacity counts what the trial pool and the ceiling still hold after the AI each
 * LIVE trial is still entitled to (so many trials started at once cannot oversell the pool), and must fit one more full trial allowance. Advisory, not a
 * reservation: the reservation in reserveAiBudget stays the hard guarantee. With nothing configured (development) there is no AI limit to protect.
 */
export function trialCapacity(nowMs: number = Date.now()): TrialCapacity {
  if (!aiAllowanceEnforced()) return { available: true };
  const cfg = trialHeadroomConfig();
  if (!cfg) return { available: false, reason: "not_configured" };
  const headroom = aiTrialHeadroom(cfg, nowMs);
  return headroom.ok ? { available: true } : { available: false, reason: headroom.reason };
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

// Owner decision 2026-10-27: members never see that AI has a limit (no "allowance", no amounts, no counters). When one is reached the message
// reads as a short pause with the time it ends, and says the rest of the app is unaffected. The limit itself is disclosed once, as fair use, in the
// subscription terms.
const AI_PAUSE_TAIL = "Everything else in the app works as normal.";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });

export function allowanceMessage(kind: AiAllowanceKind, resetsAt: string | null, format: (iso: string) => string = shortDate): string {
  switch (kind) {
    case "trial":
      return `You've made the most of AI coaching during your free trial. It'll be ready again when your subscription starts. ${AI_PAUSE_TAIL}`;
    case "staff":
      return "AI drafting will be ready again soon. Nothing else in the app is affected.";
    default:
      return `AI coaching will be ready again ${resetsAt ? `on ${format(resetsAt)}` : "soon"}. ${AI_PAUSE_TAIL}`;
  }
}

/** Staff paused AI for this member (profile.aiPausedAt). */
export const AI_PAUSED_CODE = "ai_paused";
export const AI_PAUSED_MESSAGE = "AI features are paused on your account. Please contact the gym.";
export function isAiPausedFor(userId: string): boolean {
  return !!findProfileByUserId(userId)?.aiPausedAt;
}

/** The share of a member's allowance usable in any rolling 24 hours (owner decision 2026-10-27: a third). AI_DAILY_SHARE overrides it (0 to 1). */
export const DEFAULT_AI_DAILY_SHARE = 1 / 3;
export function aiDailyShare(): number {
  const n = parseBudget(process.env.AI_DAILY_SHARE);
  return n !== null && n > 0 && n <= 1 ? n : DEFAULT_AI_DAILY_SHARE;
}
export const DAILY_LIMIT_MESSAGE = "AI coaching will be ready again tomorrow. Everything else in the app works as normal.";

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
  | { ok: false; reason: "unavailable"; kind: MemberAllowanceKind; message: string }
  | { ok: false; reason: "paused"; kind: MemberAllowanceKind; message: string };

// The cheap pre-check each route makes so a member over their allowance gets a clear answer before any work. It is NOT the guarantee: the atomic reservation is.
export function checkAiAllowance(userId: string, nowMs: number = Date.now()): AllowanceResult {
  const kind = allowanceKindFor(userId, nowMs);
  if (isAiPausedFor(userId)) return { ok: false, reason: "paused", kind, message: AI_PAUSED_MESSAGE };
  if (!aiAllowanceEnforced()) return { ok: true, enforced: false, kind, remainingUsd: null };
  const budget = aiAllowanceBudgets()[kind];
  if (budget === null) return { ok: false, reason: "unavailable", kind, message: ALLOWANCE_UNAVAILABLE_MESSAGE };
  if (kind === "free" && budget === 0) return { ok: false, reason: "upgrade", kind, message: UPGRADE_MESSAGE };

  const logs = findAiUsageLogsByUserId(userId);
  const spent = aiSpendUsd(logs, userId, kind, windowMsFor(kind), nowMs);
  if (spent < budget && aiSpendUsd(logs, userId, kind, 24 * 60 * 60 * 1000, nowMs) >= budget * aiDailyShare()) {
    return { ok: false, reason: "reached", kind, resetsAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(), message: DAILY_LIMIT_MESSAGE };
  }
  if (spent < budget) return { ok: true, enforced: true, kind, remainingUsd: budget - spent };
  return { ok: false, reason: "reached", kind, resetsAt: resetsAtFor(userId, kind, budget, 0, nowMs), message: allowanceMessage(kind, resetsAtFor(userId, kind, budget, 0, nowMs)) };
}

/** A member's AI allowance as staff see it, in EUROS (converted at the budgets' own rate, so it matches the settings). */
export interface MemberAllowanceStatus {
  kind: MemberAllowanceKind;
  /** The member's live App Subscription for staff to see (a store plan first, then a staff grant with its optional end), or null. */
  plan: DigitalPlanSummary | null;
  paused: boolean;
  /** Null when allowances are not enforced or this group's budget is not set. */
  budgetEur: number | null;
  /** Spent in this group's window (30 days, or the whole trial). */
  spentEur: number;
  dailyCapEur: number | null;
  spentTodayEur: number;
}

export function memberAllowanceStatus(userId: string, nowMs: number = Date.now()): MemberAllowanceStatus {
  const kind = allowanceKindFor(userId, nowMs);
  const rate = aiUsdPerEur();
  const budget = aiAllowanceEnforced() ? aiAllowanceBudgets()[kind] : null;
  const logs = findAiUsageLogsByUserId(userId);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    kind,
    plan: describeDigitalPlan(findDigitalEntitlementsByUserId(userId), nowMs),
    paused: isAiPausedFor(userId),
    budgetEur: budget === null ? null : round(budget / rate),
    spentEur: round(aiSpendUsd(logs, userId, kind, windowMsFor(kind), nowMs) / rate),
    dailyCapEur: budget === null ? null : round((budget * aiDailyShare()) / rate),
    spentTodayEur: round(aiSpendUsd(logs, userId, kind, 24 * 60 * 60 * 1000, nowMs) / rate),
  };
}
