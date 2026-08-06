import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID, randomBytes, createHash } from "crypto";

import type {
  CyclePrivacyPreferencesRecord,
  CycleSettingsRecord,
  ProfileRecord,
  UserRecord,
  UserRole,
} from "@/lib/profile-schema";
import { isStaffRole } from "@/lib/permissions";
import { getConfiguredDataDir } from "@/lib/app-config";

export type StoredUser = UserRecord & { passwordHash: string };

interface ResetTokenRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export type ProgrammeStatus = "active" | "paused" | "completed";

export interface ProgrammeRecord {
  id: string;
  userId: string;
  title: string;
  phase: string | null;
  focus: string | null;
  status: ProgrammeStatus;
  startDate: string | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExerciseSection =
  | "upper_push"
  | "upper_pull"
  | "lower_push"
  | "lower_pull"
  | "core"
  | "cardio";

export interface ExerciseRecord {
  id: string;
  name: string;
  section: ExerciseSection;
  /** What the exercise is / what it trains — shown in the member library. */
  description?: string | null;
  /** Coaching cues, one thought per line — shown in the member library. */
  cues?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Snapshot stored inline on each session row so historical records remain
// readable even if the library exercise is later renamed or deleted.
export interface WorkoutExerciseEntry {
  exerciseId: string | null;
  name: string;
  /** Shared/summary weight. When setDetails is present, per-set values win. */
  weight: string | null;
  reps: number | null;
  sets: number | null;
  /** Rate of perceived exertion 1-10 — used by class workout recording. */
  rpe?: number | null;
  /** Reps in reserve 0-5 — member self-logged effort ("how many more could
      you have done"), distinct from staff-recorded rpe above. */
  rir?: number | null;
  /** Per-set weight/reps when they differ between sets. Length matches the
      performed sets; null/absent = the shared weight/reps applied to all. */
  setDetails?: { weight: string | null; reps: number | null }[] | null;
  notes: string | null;
}

export interface WorkoutRunEntry {
  distance: number | null;
  distanceUnit: "km";
  durationSecs: number | null;
  reps: number | null;
  sets: number | null;
  notes: string | null;
}

export interface WorkoutSessionRecord {
  id: string;
  userId: string;
  date: string;
  title: string;
  durationMins: number | null;
  notes: string | null;
  exercises: WorkoutExerciseEntry[];
  runs: WorkoutRunEntry[];
  /** Set when this session was synced from a class workout. Member edits
      are allowed until the end of the class's calendar day; after that
      only staff re-sync changes it. */
  classId?: string | null;
  /** Staff member who recorded/synced the class result. */
  recordedByStaffId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// The workout content staff record for a class: a template of exercises
// (with default loading) plus session-level notes. Per-member RESULTS are
// not stored here — they sync into each member's own WorkoutSessionRecord,
// keyed by (classId, userId), so member history is the single source of
// performed work.
export interface ClassWorkoutRecord {
  classId: string;
  notes: string | null;
  exercises: WorkoutExerciseEntry[];
  updatedByStaffId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRecord {
  id: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Which AI surface this message belongs to — keeps the general AI Coach
      (Messages tab) and the Nutrition Coach (Nutrition tab) as separate
      conversations. Absent on rows written before this field existed;
      those are treated as "coach" (see findAiMessagesByUserId). */
  channel?: "coach" | "nutrition";
}

export interface BodyWeightLogRecord {
  id: string;
  userId: string;
  date: string;
  weightKg: number;
  createdAt: string;
}

// ClassCategory is a string alias for category slugs. Valid values are the
// slug fields of ClassCategoryRecord rows currently in the DB.
export type ClassCategory = string;

export interface ClassCategoryRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

// Seeded into fresh installs only. Existing DBs already have their own
// category rows and are not affected by changes here.
const DEFAULT_CLASS_CATEGORIES: ClassCategoryRecord[] = [
  { id: "cat_general", slug: "general", name: "General", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_strength", slug: "strength", name: "Strength", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_cardio", slug: "cardio", name: "Cardio", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_mother_and_baby", slug: "mother_and_baby", name: "Mother & Baby", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_semi_private_pt", slug: "semi_private_pt", name: "Semi-Private PT", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_parent_and_baby", slug: "parent_and_baby", name: "Parent and Baby Classes", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
];

export interface ClassRecord {
  id: string;
  title: string;
  category: ClassCategory;
  coachUserId: string;
  date: string;
  startTime: string;
  durationMins: number;
  capacity: number;
  /** Set when this occurrence was generated from a recurring series.
      Occurrences stay ordinary classes — bookings, waitlists, attendance
      and deletion all work exactly as for one-off classes. */
  seriesId?: string | null;
  /** Optional cover image — a small JPEG/PNG/WebP data URL (staff-uploaded) or
      a built-in cover path (see lib/class-covers). Null/undefined → the
      ClassImageSlot placeholder is used. */
  imageUrl?: string | null;
  /** Optional alt text for the cover. Null/blank = decorative (image ignored
      by screen readers); a value = meaningful (used as the img alt). */
  imageAlt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// A recurring weekly schedule that GENERATES ClassRecord occurrences on a
// rolling horizon (see lib/class-series.ts) rather than materialising an
// unbounded run of rows. The series itself is never bookable.
export interface ClassSeriesRecord {
  id: string;
  title: string;
  category: ClassCategory;
  coachUserId: string;
  /** JS weekday numbers (0 = Sunday … 6 = Saturday). At least one. */
  weekdays: number[];
  startTime: string;
  durationMins: number;
  capacity: number;
  /** First date occurrences may be generated for (ISO date). */
  startDate: string;
  /** Last generatable date; null = repeats indefinitely. */
  endDate: string | null;
  /** Dates staff removed (occurrence deleted or moved) — generation must
      never bring these back. */
  skippedDates: string[];
  /** false = stopped: existing occurrences stay, nothing new generates. */
  isActive: boolean;
  /** Optional cover image (data URL or built-in path) propagated to generated
      occurrences. */
  imageUrl?: string | null;
  /** Optional cover alt text propagated to generated occurrences. */
  imageAlt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRecord {
  id: string;
  classId: string;
  userId: string;
  attendedAt: string | null;
  createdAt: string;
}

// FIFO queue for a full class. Position is implied by createdAt order.
//
// Lifecycle: queued → offered → accepted | rejected | expired
//            queued | offered → removed (member withdrew)
// Terminal states (accepted, rejected, expired, removed) are retained for
// audit purposes and purged by the cleanup job once the class has started.
export type WaitlistOfferState =
  | "queued"    // waiting in FIFO line, no slot held
  | "offered"   // provisional offer extended, one slot held against capacity
  | "accepted"  // member accepted; a BookingRecord was created
  | "rejected"  // member explicitly declined
  | "expired"   // offer window elapsed without a response
  | "removed";  // member withdrew from the waitlist

export interface WaitlistEntryRecord {
  id: string;
  classId: string;
  userId: string;
  offerState: WaitlistOfferState;
  offerExpiresAt: string | null;      // ISO — set when state is "offered"
  warningNotifiedAt: string | null;   // set once a window-narrowing warning is sent
  resolvedAt: string | null;          // ISO timestamp when terminal state was reached
  createdAt: string;
}

export interface CoachNoteRecord {
  userId: string;
  notes: string;
  updatedByStaffId: string;
  updatedAt: string;
}

export type BillingInterval = "monthly" | "quarterly" | "annual";

// The internal, plan-shaped ENTITLEMENT view a subscription resolves to.
// No longer a stored record — it is produced by membership-entitlement.ts
// from a catalog package (+ billing option). The name is retained so the
// deep entitlement engine (allowance math, booking consumption, waitlist,
// renewal, member/staff views) reads one stable shape.
export interface MembershipPlanRecord {
  id: string;
  name: string;
  description: string | null;
  // Denominated in EUR cents.
  priceCents: number;
  billingInterval: BillingInterval;
  // Sessions a member can book per billing period. null = unlimited.
  monthlySessionAllowance: number | null;
  // Class categories this entitlement is allowed to book. Empty means
  // unrestricted (can book any category).
  allowedCategories: ClassCategory[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// "none" means no real payment provider is wired up, or the member's plan
// was activated manually by staff — see lib/billing.ts.
export type BillingProvider = "none" | "stripe" | "revolut";

// "pending" = a checkout was created with the provider but payment hasn't
// been confirmed yet (webhook hasn't fired). Only a provider webhook (or a
// staff manual override) should ever move a subscription to "active".
export type SubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "canceled" | "paused";

// A manual class-pass credit granted by staff on top of the plan's monthly
// allowance (goodwill, catch-up, promo, correction). Grants apply to the
// current billing period only — they are cleared whenever a fresh period
// begins, alongside sessionsUsedThisPeriod.
export interface ExtraSessionGrant {
  id: string;
  amount: number;
  note: string | null;
  grantedByUserId: string;
  createdAt: string;
}

export interface SubscriptionRecord {
  userId: string;
  /** Catalog package this subscription entitles. Entitlement is derived from
      the package (see membership-entitlement.ts). */
  packageId?: string | null;
  /** Catalog billing option that was purchased (recurring). */
  billingOptionId?: string | null;
  /** In-flight switch to a different recurring option/package. Held here so
      the member stays ACTIVE on their current membership (the fields above)
      until the new payment is confirmed. On confirmation these promote to the
      active fields and the previous provider subscription is cancelled — no
      duplicate active subscription, no double billing, no proration. Cleared
      when the switch completes or its checkout goes stale. */
  pendingPackageId?: string | null;
  pendingBillingOptionId?: string | null;
  /** Stripe Checkout session id of the in-flight switch — the webhook finds
      the switch by this. */
  pendingSetupOrderId?: string | null;
  /** When the switch checkout was started, for staleness/abandon cleanup. */
  pendingStartedAt?: string | null;
  status: SubscriptionStatus;
  /** Set only while status is "paused" — the pause auto-resumes once this
      passes (see lib/jobs/resume-paused-memberships.ts). Null otherwise. */
  pausedUntil: string | null;
  /** The status this subscription had immediately before being paused, so
      resuming restores it exactly rather than assuming "active". */
  statusBeforePause: SubscriptionStatus | null;
  provider: BillingProvider;
  providerCustomerId: string | null;
  // Revolut subscription ID (for subscription-based billing). Legacy records
  // created before the subscription flow may hold a Revolut order ID instead.
  providerSubscriptionId: string | null;
  // Revolut setup order ID — the one-time order Revolut creates as part of
  // subscription setup for the first payment checkout. Kept separate so
  // providerSubscriptionId always holds the subscription ID that webhook
  // SUBSCRIPTION_* events carry, not the transient setup order ID.
  providerSetupOrderId: string | null;
  currentPeriodEnd: string | null;
  // Timestamp of the last webhook event actually applied to this record.
  // Revolut doesn't guarantee webhook delivery order — comparing incoming
  // events against this prevents a late/out-of-order event from regressing
  // a more current status. Null until the first webhook event lands.
  lastWebhookEventAt: string | null;
  // Sessions consumed against the plan's monthlySessionAllowance during the
  // current billing period. Reset to 0 whenever a fresh period begins (see
  // app/api/billing/webhook/route.ts and the staff manual-override route).
  sessionsUsedThisPeriod: number;
  // Staff-granted extra class passes for the current billing period. Cleared
  // whenever a fresh period begins, alongside sessionsUsedThisPeriod.
  extraSessionGrants: ExtraSessionGrant[];
  // Set by the notify-lapsed-memberships job the first time it messages a
  // member about a lapsed period, so it doesn't re-notify on every run.
  // Reset to null whenever a fresh period begins, alongside sessionsUsedThisPeriod.
  periodLapsedNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Commerce: purchases, pass products, webhook + entitlement ledgers ──
//
// Design invariants (see docs/payments-architecture.md):
//  - PurchaseRecord is the internal order spine: one row per checkout
//    attempt, linked to the provider by providerOrderId. Provider state is
//    never the entitlement source of truth — a webhook flips the purchase
//    status, and entitlements are derived from OUR records.
//  - PaymentEventRecord is the webhook dedupe/audit ledger: a logical event
//    key is recorded exactly once; replays are acknowledged but not applied.
//  - PassLedgerEntryRecord is append-only. Balances are sums over entries;
//    corrections are compensating entries, never mutations.

// ── Membership catalog (Category → Package → Billing Option) ──────────
// A three-level storefront that sits ON TOP of the entitlement engine:
//  - Category groups packages for browsing (app-only concept).
//  - Package is the sellable unit and the ENTITLEMENT (allowance + class
//    access). Maps to a Stripe Product.
//  - BillingOption is a price/cadence for that package. Maps to a Stripe
//    Price. One package has many options; we never duplicate packages per
//    interval. Entitlement lives on the package, never on the option.
export interface MembershipCategoryRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PackageType = "membership" | "pass" | "top_up";
export type SessionAllowanceType = "unlimited" | "fixed_count" | "single_use";

export interface MembershipPackageRecord {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  packageType: PackageType;
  sessionAllowanceType: SessionAllowanceType;
  /** Total sessions for fixed_count; null for unlimited; typically 1 for
      single_use. */
  sessionAllowanceCount: number | null;
  /** Class categories this package can book. Empty = all (unrestricted). */
  eligibleClassTypes: ClassCategory[];
  visible: boolean;
  sortOrder: number;
  stripeProductId: string | null;
  /** Optional cover image — a small data URL or a built-in cover path — shown
      on the landing featured cards. Null/undefined → placeholder. */
  imageUrl?: string | null;
  /** Optional cover alt text. Null/blank = decorative; a value = meaningful. */
  imageAlt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BillingType = "recurring" | "one_time";

export interface MembershipBillingOptionRecord {
  id: string;
  packageId: string;
  name: string;
  billingType: BillingType;
  /** Recurring cadence; null for one_time. */
  intervalUnit: "month" | "year" | null;
  /** e.g. 1 monthly, 3 quarterly, 1 annual; null for one_time. */
  intervalCount: number | null;
  amountCents: number;
  currency: string;
  visible: boolean;
  sortOrder: number;
  /** Stripe Price id. When set, checkout uses it; else it falls back to
      inline price_data derived from this record (see lib/billing.ts). */
  stripePriceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseKind = "membership" | "pass_pack";
export type PurchaseStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";

export interface PurchaseRecord {
  id: string;
  userId: string;
  kind: PurchaseKind;
  /** Catalog MembershipPackageRecord.id for one-time (pass/top-up) buys.
      Historical trial rows may reference a now-removed legacy product id. */
  productId: string;
  /** Denormalized human label so audit rows survive product renames. */
  description: string;
  amountCents: number;
  status: PurchaseStatus;
  provider: BillingProvider;
  providerOrderId: string | null;
  /** Provider payment reference (Stripe PaymentIntent) — how refund events
      are correlated back to a purchase. Set from the completed webhook. */
  providerPaymentRef: string | null;
  /** Hosted checkout URL, kept so duplicate submits re-use it. */
  checkoutUrl: string | null;
  /** Duplicate-submit protection: one open purchase per key. */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEventRecord {
  /** Logical event key, e.g. "ORDER_COMPLETED:<providerOrderId>". */
  key: string;
  provider: BillingProvider;
  type: string;
  entityId: string | null;
  receivedAt: string;
}

export type PassLedgerReason =
  | "purchase"
  | "refund_reversal"
  | "consume"
  | "consume_reversal"
  | "staff_adjust";

export interface PassLedgerEntryRecord {
  id: string;
  userId: string;
  /** Positive credits, negative debits. Balance = sum of deltas. */
  delta: number;
  reason: PassLedgerReason;
  /** Provenance for purchase-driven entries. */
  purchaseId: string | null;
  /** Provenance for booking-driven entries (consume / consume_reversal) —
      what makes double-consumption and double-reversal detectable. */
  bookingId: string | null;
  /** For purchase credits only: when these passes stop being usable
      (stamped from the product's validityDays at credit time). Null or
      absent = the credit never expires. */
  expiresAt?: string | null;
  note: string | null;
  createdAt: string;
}

export interface RecoveryLogRecord {
  id: string;
  userId: string;
  date: string;
  sleepHours: number | null;
  /** 1–10, higher is better. Entries written before the scale change were
      1–5 and are doubled on read (see normalizeRecoveryScale). */
  sleepQuality: number | null;
  /** 1–10, higher is more sore. Same legacy normalization as sleepQuality. */
  soreness: number | null;
  /** Still 1–5 (1=fresh, 5=exhausted) — deliberately unchanged. */
  fatigue: number | null;
  /** Marks entries recorded on the 1–10 scale. Absent = legacy 1–5. */
  scale10?: boolean;
  trainingDurationMins: number | null;
  rpe: number | null;
  goal: string | null;
  notes: string | null;
  readinessScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  memberId: string;
  senderId: string;
  senderRole: "member" | "staff";
  body: string;
  readAt: string | null;
  createdAt: string;
}

// A lead submitted through the public marketing site's contact form.
// Unauthenticated by design — anyone can submit, so this is never linked to
// a userId. Staff read these manually for now; no UI surfaces them yet.
export interface ContactInquiryRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | "message"
  | "membership"
  | "class_reminder"
  | "cancellation"
  | "waitlist_offer"
  | "waitlist_timeout";

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  linkHref: string | null;
  dedupeKey: string | null;
  createdAt: string;
}

// Durable observability signal for the AI Coach / AI Nutrition Coach
// boundary — records when one coach's reply appears (via the same regex
// heuristic already used at each call site) to redirect a member to the
// other. Deliberately minimal: no userId, no message text, no other
// identifiers — this exists to answer "how often does this happen" in
// aggregate, not "which member asked what." See docs/ai-coach-routing.md.
export type AiRedirectDirection = "coach_to_nutrition" | "nutrition_to_coach";

export interface AiRedirectEventRecord {
  id: string;
  direction: AiRedirectDirection;
  createdAt: string;
}

// A real payment amount actually received for a recurring membership
// renewal — the data this app was missing entirely before the Finances tab
// (see docs/finances.md). One-off pass/top-up purchases already carry their
// own amountCents on PurchaseRecord; this record exists only to cover the
// gap on the recurring side, where the Stripe/Revolut webhooks previously
// updated subscription status without ever recording what was charged.
// Append-only and NEVER pruned — unlike JobRunRecord/AiRedirectEventRecord,
// this is financial history, not operational telemetry, so nothing here is
// capped or dropped.
export type RevenueSource = "membership_renewal";

export interface RevenueEventRecord {
  id: string;
  userId: string;
  packageId: string | null;
  billingOptionId: string | null;
  amountCents: number;
  currency: string;
  provider: BillingProvider;
  /** Dedupe key together with provider — Stripe invoice id, or Revolut order
      id. Guards against double-counting when a provider fires more than one
      event type for the same underlying charge. */
  providerRef: string;
  source: RevenueSource;
  receivedAt: string;
}

export type JobStatus = "success" | "error";

// One row per individual job execution within a run (see lib/jobs/). Kept
// small and durable so staff/devs can see what ran and what happened
// without needing external logging infrastructure.
export interface JobRunRecord {
  id: string;
  jobName: string;
  status: JobStatus;
  summary: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: "cron" | "manual";
}

// Staff-controlled on/off switches for the OPTIONAL operational transactional
// emails only. Billing-/account-critical emails (membership lapse, low pass
// balance) and time-sensitive waitlist emails are deliberately NOT modelled
// here — they must always send and are never gated by these toggles.
export type TransactionalEmailType =
  | "bookingConfirmation"
  | "bookingCancellation"
  | "classCancelled"
  | "classReminder";

export const TRANSACTIONAL_EMAIL_TYPES: TransactionalEmailType[] = [
  "bookingConfirmation",
  "bookingCancellation",
  "classCancelled",
  "classReminder",
];

export type TransactionalEmailSettings = Record<TransactionalEmailType, boolean>;

// Defaults mirror current behaviour: every optional email is ON.
export const DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS: TransactionalEmailSettings = {
  bookingConfirmation: true,
  bookingCancellation: true,
  classCancelled: true,
  classReminder: true,
};

// ── TRIAL-ONLY: bug reporting ───────────────────────────────────────────
// Lets anyone signed in during the trial period submit a bug (text +
// screenshots) from Settings; staff triage it at /staff/bug-reports. This
// whole feature is meant to be deleted before full launch — see
// docs/bug-reports.md for the exact removal checklist covering every file
// this touches.
export type BugReportStatus = "open" | "resolved";

export interface BugReportRecord {
  id: string;
  userId: string;
  description: string;
  /** Data URLs — same validation as class cover images (lib/image-upload.ts
      isValidImageDataUrl): jpeg/png/webp, capped size. Capped at 3 per report. */
  screenshots: string[];
  status: BugReportStatus;
  createdAt: string;
  updatedAt: string;
}

// Staff-configured settings for the Finances tab (singleton). taxRatePercent
// is a manually-entered estimate rate, not a computed liability — this app
// has no expense tracking, so it can only ever show gross revenue × a rate
// the admin_manager types in themselves. null = not set (no estimate shown).
export interface FinanceSettings {
  taxRatePercent: number | null;
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  taxRatePercent: null,
};

interface Database {
  users: StoredUser[];
  profiles: ProfileRecord[];
  resetTokens: ResetTokenRecord[];
  programmes: ProgrammeRecord[];
  workoutSessions: WorkoutSessionRecord[];
  exercises: ExerciseRecord[];
  aiMessages: AiMessageRecord[];
  bodyWeightLogs: BodyWeightLogRecord[];
  classes: ClassRecord[];
  classSeries: ClassSeriesRecord[];
  classWorkouts: ClassWorkoutRecord[];
  classCategories: ClassCategoryRecord[];
  // slug → display name for categories that have been deleted. Populated by
  // deleteClassCategory so historical class/plan records still render a
  // human-readable label rather than a raw slug.
  deletedCategoryLabels: Record<string, string>;
  bookings: BookingRecord[];
  coachNotes: CoachNoteRecord[];
  membershipCategories: MembershipCategoryRecord[];
  membershipPackages: MembershipPackageRecord[];
  membershipBillingOptions: MembershipBillingOptionRecord[];
  subscriptions: SubscriptionRecord[];
  purchases: PurchaseRecord[];
  paymentEvents: PaymentEventRecord[];
  passLedger: PassLedgerEntryRecord[];
  recoveryLogs: RecoveryLogRecord[];
  messages: MessageRecord[];
  notifications: NotificationRecord[];
  waitlistEntries: WaitlistEntryRecord[];
  jobRuns: JobRunRecord[];
  aiRedirectEvents: AiRedirectEventRecord[];
  revenueEvents: RevenueEventRecord[];
  cycleSettings: CycleSettingsRecord[];
  cyclePrivacyPreferences: CyclePrivacyPreferencesRecord[];
  pushSubscriptions: PushSubscriptionRecord[];
  contactInquiries: ContactInquiryRecord[];
  // Optional-email toggles (singleton). Missing keys default to ON via readDb.
  emailSettings: TransactionalEmailSettings;
  financeSettings: FinanceSettings;
  // TRIAL-ONLY — see BugReportRecord above and docs/bug-reports.md.
  bugReports: BugReportRecord[];
}

// DATA_DIR defaults to a folder inside the deployed code, which is fine for
// local dev — but on a host that replaces the whole code directory on every
// deploy (e.g. Hostinger's per-release .builds/versions/<id> layout), that
// default silently wipes every member/booking/etc. on the next push. Set the
// DATA_DIR env var to an absolute path outside the deploy-managed tree (a
// sibling of the release folders, not inside one) to persist real data.
const configuredDataDir = getConfiguredDataDir();
const DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

// Deployment constraint (see docs/launch-checklist.md §6): this datastore is
// one JSON file with synchronous read/write, correct for a single persistent
// Node process and unsafe for serverless/multi-instance deployments (writes
// can be lost, concurrent instances can clobber each other, and a serverless
// filesystem is typically ephemeral). `VERCEL` is set by Vercel's platform
// for every deployment mode, so this can't distinguish a correctly-configured
// persistent setup from the (more common) default serverless one — hence a
// warning, not a hard failure, with an explicit opt-out for the former case.
if (process.env.VERCEL && !process.env.ACKNOWLEDGE_SERVERLESS_DEPLOYMENT) {
  console.warn(
    "[lib/db] Running on Vercel with a JSON-file datastore (data/db.json). " +
      "Vercel's default deployment mode runs ephemeral, per-invocation serverless " +
      "functions — writes may not persist and concurrent instances can corrupt " +
      "this file. This app requires a single, persistent Node process (next start " +
      "behind a process manager, with data/ on a persisted, backed-up volume) — " +
      "see docs/launch-checklist.md §6. If this deployment is deliberately " +
      "persistent, set ACKNOWLEDGE_SERVERLESS_DEPLOYMENT=true to silence this warning."
  );
}

// Sleep quality and soreness moved from a 1-5 to a 1-10 scale. Legacy
// entries (no scale10 flag) double on read — 1,2,3,4,5 -> 2,4,6,8,10 — so
// every reader sees one consistent scale. Stored readinessScore values
// are untouched: they were computed on the scale in force at the time.
export function normalizeRecoveryScale(log: RecoveryLogRecord): RecoveryLogRecord {
  if (log.scale10) return log;
  return {
    ...log,
    sleepQuality: log.sleepQuality === null ? null : Math.min(10, log.sleepQuality * 2),
    soreness: log.soreness === null ? null : Math.min(10, log.soreness * 2),
    scale10: true,
  };
}

function readDb(): Database {
  if (!existsSync(DB_PATH)) {
    return {
      users: [],
      profiles: [],
      resetTokens: [],
      programmes: [],
      workoutSessions: [],
      exercises: [],
      aiMessages: [],
      bodyWeightLogs: [],
      classes: [],
      classSeries: [],
      classWorkouts: [],
      classCategories: DEFAULT_CLASS_CATEGORIES,
      deletedCategoryLabels: {},
      bookings: [],
      coachNotes: [],
      membershipCategories: [],
      membershipPackages: [],
      membershipBillingOptions: [],
      subscriptions: [],
      purchases: [],
      paymentEvents: [],
      passLedger: [],
      recoveryLogs: [],
      messages: [],
      notifications: [],
      waitlistEntries: [],
      jobRuns: [],
      aiRedirectEvents: [],
      revenueEvents: [],
      cycleSettings: [],
      cyclePrivacyPreferences: [],
      pushSubscriptions: [],
      contactInquiries: [],
      emailSettings: { ...DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS },
      financeSettings: { ...DEFAULT_FINANCE_SETTINGS },
      bugReports: [],
    };
  }

  const raw = readFileSync(DB_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Database>;

  return {
    users: (parsed.users ?? []).map((user) => ({
      ...user,
      // Migrate the legacy single elevated role to the top of the new
      // hierarchy so the existing account can manage staff. Members unchanged.
      role: user.role === "staff" ? "admin_manager" : user.role ?? "member",
    })),
    profiles: (parsed.profiles ?? []).map((p) => ({
      ...p,
      dateOfBirth: p.dateOfBirth ?? null,
      menopauseSupportEnabled: p.menopauseSupportEnabled ?? false,
      reminderTimingsMins: p.reminderTimingsMins ?? null,
      emailNotificationsEnabled: p.emailNotificationsEnabled ?? true,
      pushNotificationsEnabled: p.pushNotificationsEnabled ?? false,
      preferredUnits: p.preferredUnits ?? "metric",
      programmeEnabled: p.programmeEnabled ?? false,
      drinkSettings: p.drinkSettings ?? null,
      drinkSettingsUpdatedAt: p.drinkSettingsUpdatedAt ?? null,
      // Dietary requirements — default to a safe, unrestricted baseline for
      // members created before these fields existed.
      dietaryPreference: p.dietaryPreference ?? "standard",
      allergies: p.allergies ?? [],
      intolerancesOrMedical: p.intolerancesOrMedical ?? [],
      dietaryNotes: p.dietaryNotes ?? null,
      dashboardTourCompleted: p.dashboardTourCompleted ?? false,
    })),
    resetTokens: parsed.resetTokens ?? [],
    programmes: parsed.programmes ?? [],
    workoutSessions: (parsed.workoutSessions ?? []).map((s) => ({
      ...s,
      exercises: s.exercises ?? [],
      runs: s.runs ?? [],
    })),
    exercises: parsed.exercises ?? [],
    aiMessages: parsed.aiMessages ?? [],
    bodyWeightLogs: parsed.bodyWeightLogs ?? [],
    classes: (parsed.classes ?? []).map((c) => ({ ...c, category: c.category ?? "general", imageUrl: c.imageUrl ?? null, imageAlt: c.imageAlt ?? null })),
    classSeries: parsed.classSeries ?? [],
    classWorkouts: parsed.classWorkouts ?? [],
    // Seed built-in categories if the DB predates this field.
    // One-way migration: rows with isActive === false (previously archived) are
    // treated as deleted so they no longer appear in selection UIs.
    classCategories: (parsed.classCategories ?? DEFAULT_CLASS_CATEGORIES).filter(
      (c) => (c as { isActive?: boolean }).isActive !== false
    ),
    deletedCategoryLabels: parsed.deletedCategoryLabels ?? {},
    bookings: parsed.bookings ?? [],
    coachNotes: parsed.coachNotes ?? [],
    membershipCategories: parsed.membershipCategories ?? [],
    membershipPackages: (parsed.membershipPackages ?? []).map((pkg) => ({
      ...pkg,
      eligibleClassTypes: pkg.eligibleClassTypes ?? [],
      imageUrl: pkg.imageUrl ?? null,
      imageAlt: pkg.imageAlt ?? null,
    })),
    membershipBillingOptions: (parsed.membershipBillingOptions ?? []).map((o) => ({
      ...o,
      currency: o.currency ?? "eur",
    })),
    subscriptions: (parsed.subscriptions ?? []).map((s) => ({
      ...s,
      providerSetupOrderId: s.providerSetupOrderId ?? null,
      sessionsUsedThisPeriod: s.sessionsUsedThisPeriod ?? 0,
      extraSessionGrants: s.extraSessionGrants ?? [],
      periodLapsedNotifiedAt: s.periodLapsedNotifiedAt ?? null,
    })),
    purchases: (parsed.purchases ?? []).map((p) => ({
      ...p,
      providerPaymentRef: p.providerPaymentRef ?? null,
    })),
    paymentEvents: parsed.paymentEvents ?? [],
    passLedger: (parsed.passLedger ?? []).map((e) => ({
      ...e,
      bookingId: e.bookingId ?? null,
    })),
    recoveryLogs: (parsed.recoveryLogs ?? []).map(normalizeRecoveryScale),
    messages: (parsed.messages ?? []).map((m) => ({ ...m, readAt: m.readAt ?? null })),
    notifications: (parsed.notifications ?? []).map((n) => ({
      ...n,
      readAt: n.readAt ?? null,
      linkHref: n.linkHref ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })),
    waitlistEntries: (parsed.waitlistEntries ?? []).map((e) => ({
      ...e,
      offerState: e.offerState ?? "queued",
      offerExpiresAt: e.offerExpiresAt ?? null,
      warningNotifiedAt: e.warningNotifiedAt ?? null,
      resolvedAt: e.resolvedAt ?? null,
    })),
    jobRuns: parsed.jobRuns ?? [],
    aiRedirectEvents: parsed.aiRedirectEvents ?? [],
    revenueEvents: parsed.revenueEvents ?? [],
    cycleSettings: parsed.cycleSettings ?? [],
    cyclePrivacyPreferences: parsed.cyclePrivacyPreferences ?? [],
    pushSubscriptions: (parsed.pushSubscriptions ?? []).map((s) => ({
      ...s,
      userAgent: s.userAgent ?? null,
    })),
    contactInquiries: parsed.contactInquiries ?? [],
    // Merge over defaults so any missing (or future) key stays ON.
    emailSettings: { ...DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS, ...(parsed.emailSettings ?? {}) },
    financeSettings: { ...DEFAULT_FINANCE_SETTINGS, ...(parsed.financeSettings ?? {}) },
    bugReports: parsed.bugReports ?? [],
  };
}

function writeDb(db: Database) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ─── Transactional email toggles (staff-controlled, optional emails only) ──────

export function getTransactionalEmailSettings(): TransactionalEmailSettings {
  return readDb().emailSettings;
}

export function saveTransactionalEmailSettings(settings: TransactionalEmailSettings): void {
  const db = readDb();
  db.emailSettings = settings;
  writeDb(db);
}

// True unless a staff member has explicitly switched this optional email off.
export function isTransactionalEmailEnabled(type: TransactionalEmailType): boolean {
  return readDb().emailSettings[type] !== false;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findUserByEmail(email: string): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => user.id === id);
}

// Any elevated (staff) user — coach, admin, or admin_manager.
export function findStaffUsers(): StoredUser[] {
  const db = readDb();
  return db.users.filter((user) => isStaffRole(user.role));
}

// Used as the attributed sender for system-generated messages that aren't
// tied to a specific coach (e.g. a lapsed-membership notice from a job).
export function findAnyStaffUser(): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => isStaffRole(user.role));
}

export function findMembers(): StoredUser[] {
  const db = readDb();
  return db.users.filter((user) => user.role === "member");
}

// How many users currently hold a given role.
export function countUsersByRole(role: UserRole): number {
  return readDb().users.filter((user) => user.role === role).length;
}

// How many NON-archived users hold a given role — the guard behind "can't
// remove/demote the last admin_manager" (an archived one can't sign in, so it
// doesn't count as coverage).
export function countActiveUsersByRole(role: UserRole): number {
  return readDb().users.filter((user) => user.role === role && !user.archivedAt).length;
}

export function createUser(email: string, passwordHash: string): StoredUser {
  return createUserWithRole(email, passwordHash, "member");
}

// Creates a user with an explicit role (elevated staff or member). Callers are
// responsible for authorization + validation.
export function createUserWithRole(
  email: string,
  passwordHash: string,
  role: UserRole
): StoredUser {
  const db = readDb();
  const now = new Date().toISOString();

  const user: StoredUser = {
    id: randomUUID(),
    email,
    passwordHash,
    role,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  db.users.push(user);
  writeDb(db);

  return user;
}

// Changes a user's role. Returns false if the user doesn't exist. Authorization
// and last-admin_manager safety live in the route, not here.
export function updateUserRole(userId: string, role: UserRole): boolean {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;
  user.role = role;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  return true;
}

// Soft-deactivation toggle. Archived accounts can't sign in; nothing else is
// touched so bookings, purchases and the pass ledger stay intact.
export function setUserArchived(userId: string, archived: boolean): boolean {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;

  user.archivedAt = archived ? new Date().toISOString() : null;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  return true;
}

// Member-owned collections keyed by the member's user id. Kept as one list so
// hard-delete (below) and the delete-non-staff script stay in sync about what
// "owned by a member" means.
const MEMBER_OWNED_COLLECTIONS = [
  "profiles", "resetTokens", "programmes", "workoutSessions", "aiMessages",
  "bodyWeightLogs", "bookings", "subscriptions", "recoveryLogs", "waitlistEntries",
  "cycleSettings", "cyclePrivacyPreferences", "pushSubscriptions", "notifications",
  "purchases", "passLedger", "coachNotes",
] as const;

// PERMANENT, irreversible deletion of a user and every record they own. This is
// the hard delete behind archived-member cleanup — it removes the member's
// subscription row (and pass ledger, purchases, etc.), which is what frees a
// membership package/billing option to be deleted. Authorization + the
// "archived member only" rule live in the route, not here. Returns per-table
// counts of what was removed. Staff-owned/global data (classes, exercises,
// catalog, categories, payment events) is untouched.
export function deleteUserAndOwnedRecords(userId: string): Record<string, number> {
  const db = readDb();
  const summary: Record<string, number> = {};

  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== userId);
  summary.users = before - db.users.length;

  for (const key of MEMBER_OWNED_COLLECTIONS) {
    const arr = db[key] as { userId: string }[];
    const n = arr.filter((r) => r.userId === userId).length;
    if (n > 0) {
      (db[key] as { userId: string }[]) = arr.filter((r) => r.userId !== userId);
      summary[key] = n;
    }
  }

  // Message threads are keyed by the member (memberId); this removes the whole
  // conversation, including any staff replies within it.
  const msgBefore = db.messages.length;
  db.messages = db.messages.filter((m) => m.memberId !== userId);
  const msgRemoved = msgBefore - db.messages.length;
  if (msgRemoved > 0) summary.messages = msgRemoved;

  writeDb(db);
  return summary;
}

export function updateUserPassword(userId: string, passwordHash: string) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return;

  user.passwordHash = passwordHash;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
}

export function updateUserEmail(userId: string, email: string): boolean {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;

  const emailTaken = db.users.some(
    (u) => u.id !== userId && u.email.toLowerCase() === email.toLowerCase()
  );
  if (emailTaken) return false;

  user.email = email;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  return true;
}

export function findProfileByUserId(userId: string): ProfileRecord | undefined {
  const db = readDb();
  return db.profiles.find((profile) => profile.userId === userId);
}

export function saveProfile(profile: ProfileRecord) {
  const db = readDb();
  const index = db.profiles.findIndex((p) => p.userId === profile.userId);

  if (index === -1) {
    db.profiles.push(profile);
  } else {
    db.profiles[index] = profile;
  }

  writeDb(db);
}

export function findProgrammeByUserId(userId: string): ProgrammeRecord | undefined {
  const db = readDb();
  return db.programmes.find((programme) => programme.userId === userId);
}

export function saveProgramme(programme: ProgrammeRecord) {
  const db = readDb();
  const index = db.programmes.findIndex((p) => p.userId === programme.userId);

  if (index === -1) {
    db.programmes.push(programme);
  } else {
    db.programmes[index] = programme;
  }

  writeDb(db);
}

export function findWorkoutSessionsByUserId(userId: string): WorkoutSessionRecord[] {
  const db = readDb();
  return db.workoutSessions
    .filter((session) => session.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function saveWorkoutSession(session: WorkoutSessionRecord) {
  const db = readDb();
  const index = db.workoutSessions.findIndex((s) => s.id === session.id);

  if (index === -1) {
    db.workoutSessions.push(session);
  } else {
    db.workoutSessions[index] = session;
  }

  writeDb(db);
}

export function findClasses(): ClassRecord[] {
  const db = readDb();
  return db.classes.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  );
}

export function findClassById(id: string): ClassRecord | undefined {
  const db = readDb();
  return db.classes.find((classRecord) => classRecord.id === id);
}

export function saveClass(classRecord: ClassRecord) {
  const db = readDb();
  const index = db.classes.findIndex((c) => c.id === classRecord.id);

  if (index === -1) {
    db.classes.push(classRecord);
  } else {
    db.classes[index] = classRecord;
  }

  writeDb(db);
}

export function findClassSeries(): ClassSeriesRecord[] {
  const db = readDb();
  return db.classSeries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findClassSeriesById(id: string): ClassSeriesRecord | undefined {
  const db = readDb();
  return db.classSeries.find((series) => series.id === id);
}

export function saveClassSeries(series: ClassSeriesRecord) {
  const db = readDb();
  const index = db.classSeries.findIndex((sr) => sr.id === series.id);
  if (index === -1) db.classSeries.push(series);
  else db.classSeries[index] = series;
  writeDb(db);
}

// Generation dedupe key: one occurrence per (series, date).
export function findClassBySeriesAndDate(seriesId: string, date: string): ClassRecord | undefined {
  const db = readDb();
  return db.classes.find((c) => c.seriesId === seriesId && c.date === date);
}

export function findClassesBySeriesId(seriesId: string): ClassRecord[] {
  const db = readDb();
  return db.classes.filter((c) => c.seriesId === seriesId);
}
// Physical deletion — callers are responsible for unwinding bookings and
// waitlist entries first (see /api/staff/classes/delete).
export function deleteClass(id: string) {
  const db = readDb();
  db.classes = db.classes.filter((classRecord) => classRecord.id !== id);
  writeDb(db);
}

export function findClassWorkoutByClassId(classId: string): ClassWorkoutRecord | undefined {
  const db = readDb();
  return db.classWorkouts.find((w) => w.classId === classId);
}

export function saveClassWorkout(workout: ClassWorkoutRecord) {
  const db = readDb();
  const index = db.classWorkouts.findIndex((w) => w.classId === workout.classId);
  if (index === -1) db.classWorkouts.push(workout);
  else db.classWorkouts[index] = workout;
  writeDb(db);
}

// Sync key for class-recorded results: one session per member per class.
export function findWorkoutSessionByUserAndClass(
  userId: string,
  classId: string
): WorkoutSessionRecord | undefined {
  const db = readDb();
  return db.workoutSessions.find((s) => s.userId === userId && s.classId === classId);
}

export function findWorkoutSessionById(id: string): WorkoutSessionRecord | undefined {
  const db = readDb();
  return db.workoutSessions.find((s) => s.id === id);
}

export function findClassCategories(): ClassCategoryRecord[] {
  const db = readDb();
  return db.classCategories.sort((a, b) => a.name.localeCompare(b.name));
}

export function findClassCategoryById(id: string): ClassCategoryRecord | undefined {
  const db = readDb();
  return db.classCategories.find((c) => c.id === id);
}

export function findClassCategoryBySlug(slug: string): ClassCategoryRecord | undefined {
  const db = readDb();
  return db.classCategories.find((c) => c.slug === slug);
}

export function saveClassCategory(category: ClassCategoryRecord) {
  const db = readDb();
  const index = db.classCategories.findIndex((c) => c.id === category.id);
  if (index === -1) {
    db.classCategories.push(category);
  } else {
    db.classCategories[index] = category;
  }
  writeDb(db);
}

export function deleteClassCategory(id: string) {
  const db = readDb();
  const toDelete = db.classCategories.find((c) => c.id === id);
  if (toDelete) {
    db.deletedCategoryLabels = { ...db.deletedCategoryLabels, [toDelete.slug]: toDelete.name };
  }
  db.classCategories = db.classCategories.filter((c) => c.id !== id);
  writeDb(db);
}

export function findDeletedCategoryLabels(): Record<string, string> {
  const db = readDb();
  return db.deletedCategoryLabels;
}

// Reference counts behind a safe class-type delete. A class type is referenced
// by its SLUG on classes (ClassRecord.category) and on packages
// (MembershipPackageRecord.eligibleClassTypes) — deleting one that's still in
// use would orphan those references, so the route blocks it.
export function countClassesByCategorySlug(slug: string): number {
  return readDb().classes.filter((c) => c.category === slug).length;
}

export function countPackagesByEligibleClassType(slug: string): number {
  return readDb().membershipPackages.filter((p) => p.eligibleClassTypes.includes(slug)).length;
}

export function findBookingsByClassId(classId: string): BookingRecord[] {
  const db = readDb();
  return db.bookings.filter((booking) => booking.classId === classId);
}

export function findBookingsByUserId(userId: string): BookingRecord[] {
  const db = readDb();
  return db.bookings.filter((booking) => booking.userId === userId);
}

export function findBookingById(id: string): BookingRecord | undefined {
  const db = readDb();
  return db.bookings.find((booking) => booking.id === id);
}

export function deleteBooking(id: string) {
  const db = readDb();
  db.bookings = db.bookings.filter((booking) => booking.id !== id);
  writeDb(db);
}

export function updateBookingAttendance(id: string, attended: boolean): boolean {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) return false;

  booking.attendedAt = attended ? new Date().toISOString() : null;
  writeDb(db);
  return true;
}

export function createBooking(booking: BookingRecord) {
  const db = readDb();
  db.bookings.push(booking);
  writeDb(db);
}

export function findCoachNoteByUserId(userId: string): CoachNoteRecord | undefined {
  const db = readDb();
  return db.coachNotes.find((note) => note.userId === userId);
}

export function saveCoachNote(note: CoachNoteRecord) {
  const db = readDb();
  const index = db.coachNotes.findIndex((n) => n.userId === note.userId);

  if (index === -1) {
    db.coachNotes.push(note);
  } else {
    db.coachNotes[index] = note;
  }

  writeDb(db);
}

export function findSubscriptionByUserId(userId: string): SubscriptionRecord | undefined {
  const db = readDb();
  return db.subscriptions.find((subscription) => subscription.userId === userId);
}

export function findSubscriptionByProviderOrderId(
  providerOrderId: string
): SubscriptionRecord | undefined {
  const db = readDb();
  return db.subscriptions.find(
    (subscription) => subscription.providerSubscriptionId === providerOrderId
  );
}

export function saveSubscription(subscription: SubscriptionRecord) {
  const db = readDb();
  const index = db.subscriptions.findIndex((s) => s.userId === subscription.userId);

  if (index === -1) {
    db.subscriptions.push(subscription);
  } else {
    db.subscriptions[index] = subscription;
  }

  writeDb(db);
}

export function findRecoveryLogsByUserId(userId: string): RecoveryLogRecord[] {
  const db = readDb();
  return db.recoveryLogs
    .filter((log) => log.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function findRecoveryLogByUserIdAndDate(
  userId: string,
  date: string
): RecoveryLogRecord | undefined {
  const db = readDb();
  return db.recoveryLogs.find((log) => log.userId === userId && log.date === date);
}

export function saveRecoveryLog(log: RecoveryLogRecord) {
  const db = readDb();
  const index = db.recoveryLogs.findIndex(
    (l) => l.userId === log.userId && l.date === log.date
  );

  if (index === -1) {
    db.recoveryLogs.push(log);
  } else {
    db.recoveryLogs[index] = log;
  }

  writeDb(db);
}

export function findMessagesByMemberId(memberId: string): MessageRecord[] {
  const db = readDb();
  return db.messages
    .filter((message) => message.memberId === memberId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createMessage(message: MessageRecord) {
  const db = readDb();
  db.messages.push(message);
  writeDb(db);
}

export interface MessageThreadSummary {
  memberId: string;
  lastMessage: MessageRecord;
  unreadFromMemberCount: number;
}

// One row per member who has ever messaged/been messaged, newest thread
// first — the staff-facing inbox (previously the only way to notice a new
// member message was to open that member's profile and scroll down).
export function findMessageThreadSummaries(): MessageThreadSummary[] {
  const db = readDb();
  const byMember = new Map<string, MessageRecord[]>();

  for (const message of db.messages) {
    const list = byMember.get(message.memberId);
    if (list) list.push(message);
    else byMember.set(message.memberId, [message]);
  }

  const summaries: MessageThreadSummary[] = [];
  for (const [memberId, thread] of byMember) {
    thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    summaries.push({
      memberId,
      lastMessage: thread[thread.length - 1],
      unreadFromMemberCount: thread.filter((m) => m.senderRole === "member" && m.readAt === null)
        .length,
    });
  }

  return summaries.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
}

export function countUnreadMessagesForStaff(): number {
  const db = readDb();
  return db.messages.filter((m) => m.senderRole === "member" && m.readAt === null).length;
}

// Called when staff open a member's thread — mirrors markAllNotificationsRead.
export function markMemberMessagesReadByStaff(memberId: string) {
  const db = readDb();
  const now = new Date().toISOString();
  let changed = false;
  for (const m of db.messages) {
    if (m.memberId === memberId && m.senderRole === "member" && m.readAt === null) {
      m.readAt = now;
      changed = true;
    }
  }
  if (changed) writeDb(db);
}

// Active states — the entry is still relevant to capacity and queue position.
// Terminal states (accepted, rejected, expired, removed) are kept for audit
// and purged later by the cleanup job.
const ACTIVE_OFFER_STATES: WaitlistOfferState[] = ["queued", "offered"];

// FIFO order — first to join is first in line for a spot offer.
// Returns only active (queued | offered) entries; terminal entries are
// excluded so members can re-join after a rejection or expiry.
export function findWaitlistEntriesByClassId(classId: string): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries
    .filter(
      (entry) => entry.classId === classId && ACTIVE_OFFER_STATES.includes(entry.offerState)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Active entries for a user (queued or offered only).
export function findWaitlistEntriesByUserId(userId: string): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries.filter(
    (entry) => entry.userId === userId && ACTIVE_OFFER_STATES.includes(entry.offerState)
  );
}

// Active entry for a specific class + user (excludes terminal states so
// members can re-join after a rejection or expiry).
export function findWaitlistEntryByClassAndUser(
  classId: string,
  userId: string
): WaitlistEntryRecord | undefined {
  const db = readDb();
  return db.waitlistEntries.find(
    (entry) =>
      entry.classId === classId &&
      entry.userId === userId &&
      ACTIVE_OFFER_STATES.includes(entry.offerState)
  );
}

// Look up any entry by id regardless of state (needed for the respond endpoint).
export function findWaitlistEntryById(id: string): WaitlistEntryRecord | undefined {
  const db = readDb();
  return db.waitlistEntries.find((entry) => entry.id === id);
}

export function createWaitlistEntry(entry: WaitlistEntryRecord) {
  const db = readDb();
  db.waitlistEntries.push(entry);
  writeDb(db);
}

// In-place update for state transitions (queued → offered → terminal).
export function saveWaitlistEntry(entry: WaitlistEntryRecord) {
  const db = readDb();
  const index = db.waitlistEntries.findIndex((e) => e.id === entry.id);
  if (index === -1) {
    db.waitlistEntries.push(entry);
  } else {
    db.waitlistEntries[index] = entry;
  }
  writeDb(db);
}

// Physical deletion — only used by the cleanup job to purge terminal records
// for classes that have already started.
export function deleteWaitlistEntry(id: string) {
  const db = readDb();
  db.waitlistEntries = db.waitlistEntries.filter((entry) => entry.id !== id);
  writeDb(db);
}

// Returns ALL entries across all states — used by the cleanup job so it can
// purge terminal records for past classes.
export function findAllWaitlistEntries(): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries;
}

export function findAllSubscriptions(): SubscriptionRecord[] {
  const db = readDb();
  return db.subscriptions;
}

// Purges reset tokens past their expiry, independent of consumeResetToken's
// lazy on-read cleanup — useful as an explicit periodic housekeeping job.
// Returns the number removed.
export function purgeExpiredResetTokens(): number {
  const db = readDb();
  const now = new Date().toISOString();
  const before = db.resetTokens.length;

  db.resetTokens = db.resetTokens.filter((entry) => entry.expiresAt > now);

  writeDb(db);
  return before - db.resetTokens.length;
}

export function createContactInquiry(input: {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}): ContactInquiryRecord {
  const db = readDb();
  const record: ContactInquiryRecord = {
    id: randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  };

  db.contactInquiries.push(record);
  writeDb(db);

  return record;
}

export function findContactInquiries(): ContactInquiryRecord[] {
  const db = readDb();
  return db.contactInquiries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createResetToken(userId: string): { token: string; expiresAt: string } {
  const db = readDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  db.resetTokens.push({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  writeDb(db);

  return { token, expiresAt };
}

export function consumeResetToken(token: string): string | undefined {
  const db = readDb();
  const now = new Date().toISOString();

  // Drop expired tokens before checking the submitted one.
  db.resetTokens = db.resetTokens.filter((entry) => entry.expiresAt > now);

  const tokenHash = hashToken(token);
  const match = db.resetTokens.find((entry) => entry.tokenHash === tokenHash);

  if (!match) {
    writeDb(db);
    return undefined;
  }

  const { userId } = match;

  // A successful reset invalidates every other outstanding token for this user.
  db.resetTokens = db.resetTokens.filter((entry) => entry.userId !== userId);

  writeDb(db);

  return userId;
}

const MAX_STORED_JOB_RUNS = 200;

export function createJobRun(run: JobRunRecord) {
  const db = readDb();
  db.jobRuns.push(run);

  // Keep storage bounded — this is operational history, not an audit log.
  if (db.jobRuns.length > MAX_STORED_JOB_RUNS) {
    db.jobRuns = db.jobRuns.slice(db.jobRuns.length - MAX_STORED_JOB_RUNS);
  }

  writeDb(db);
}

export function findRecentJobRuns(limit: number): JobRunRecord[] {
  const db = readDb();
  return [...db.jobRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

// AI coach-routing redirect events — same append-only, capped-array shape as
// jobRuns above. Deliberately minimal (see AiRedirectEventRecord) and
// deliberately not an audit log: only the direction and a timestamp, kept
// bounded, for later aggregate review (see scripts/ai-redirect-summary.mjs).
const MAX_STORED_AI_REDIRECT_EVENTS = 1000;

export function createAiRedirectEvent(event: AiRedirectEventRecord): void {
  const db = readDb();
  db.aiRedirectEvents.push(event);

  if (db.aiRedirectEvents.length > MAX_STORED_AI_REDIRECT_EVENTS) {
    db.aiRedirectEvents = db.aiRedirectEvents.slice(
      db.aiRedirectEvents.length - MAX_STORED_AI_REDIRECT_EVENTS
    );
  }

  writeDb(db);
}

export function findAllAiRedirectEvents(): AiRedirectEventRecord[] {
  return readDb().aiRedirectEvents;
}

// Revenue ledger — deliberately append-only with NO cap (see
// RevenueEventRecord). createRevenueEvent is idempotent per (provider,
// providerRef): callers should check findRevenueEventByProviderRef first so
// a webhook retry, or a second event type for the same charge, can't
// double-record the same payment.
export function createRevenueEvent(event: RevenueEventRecord): void {
  const db = readDb();
  db.revenueEvents.push(event);
  writeDb(db);
}

export function findRevenueEventByProviderRef(
  provider: BillingProvider,
  providerRef: string
): RevenueEventRecord | undefined {
  return readDb().revenueEvents.find(
    (e) => e.provider === provider && e.providerRef === providerRef
  );
}

export function findAllRevenueEvents(): RevenueEventRecord[] {
  return readDb().revenueEvents;
}

export function getFinanceSettings(): FinanceSettings {
  return readDb().financeSettings;
}

export function saveFinanceSettings(settings: FinanceSettings): void {
  const db = readDb();
  db.financeSettings = settings;
  writeDb(db);
}

// ── TRIAL-ONLY: bug reports — see docs/bug-reports.md ──────────────────
const MAX_STORED_BUG_REPORTS = 300;

export function createBugReport(report: BugReportRecord): void {
  const db = readDb();
  db.bugReports.push(report);
  if (db.bugReports.length > MAX_STORED_BUG_REPORTS) {
    db.bugReports = db.bugReports.slice(db.bugReports.length - MAX_STORED_BUG_REPORTS);
  }
  writeDb(db);
}

export function findAllBugReports(): BugReportRecord[] {
  return [...readDb().bugReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findBugReportById(id: string): BugReportRecord | undefined {
  return readDb().bugReports.find((r) => r.id === id);
}

export function saveBugReport(report: BugReportRecord): void {
  const db = readDb();
  const index = db.bugReports.findIndex((r) => r.id === report.id);
  if (index !== -1) db.bugReports[index] = report;
  writeDb(db);
}

export function deleteBugReport(id: string): void {
  const db = readDb();
  db.bugReports = db.bugReports.filter((r) => r.id !== id);
  writeDb(db);
}

export function findCycleSettingsByUserId(userId: string): CycleSettingsRecord | undefined {
  const db = readDb();
  return db.cycleSettings.find((s) => s.userId === userId);
}

export function saveCycleSettings(settings: CycleSettingsRecord) {
  const db = readDb();
  const index = db.cycleSettings.findIndex((s) => s.userId === settings.userId);
  if (index === -1) {
    db.cycleSettings.push(settings);
  } else {
    db.cycleSettings[index] = settings;
  }
  writeDb(db);
}

export function findCyclePrivacyByUserId(userId: string): CyclePrivacyPreferencesRecord | undefined {
  const db = readDb();
  return db.cyclePrivacyPreferences.find((p) => p.userId === userId);
}

export function saveCyclePrivacy(prefs: CyclePrivacyPreferencesRecord) {
  const db = readDb();
  const index = db.cyclePrivacyPreferences.findIndex((p) => p.userId === prefs.userId);
  if (index === -1) {
    db.cyclePrivacyPreferences.push(prefs);
  } else {
    db.cyclePrivacyPreferences[index] = prefs;
  }
  writeDb(db);
}

// Exercise library

export function findExercises(): ExerciseRecord[] {
  const db = readDb();
  return [...db.exercises].sort(
    (a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)
  );
}

export function findExerciseById(id: string): ExerciseRecord | undefined {
  const db = readDb();
  return db.exercises.find((e) => e.id === id);
}

export function saveExercise(exercise: ExerciseRecord) {
  const db = readDb();
  const index = db.exercises.findIndex((e) => e.id === exercise.id);
  if (index === -1) {
    db.exercises.push(exercise);
  } else {
    db.exercises[index] = exercise;
  }
  writeDb(db);
}

// Historical workout rows store their own exerciseId+name snapshot, so
// there is no integrity risk from hard-deleting a library exercise.
export function deleteExercise(id: string) {
  const db = readDb();
  db.exercises = db.exercises.filter((e) => e.id !== id);
  writeDb(db);
}

// AI chat messages (member-facing, deferred to Slice 3)

export function findAiMessagesByUserId(
  userId: string,
  channel: "coach" | "nutrition" = "coach"
): AiMessageRecord[] {
  const db = readDb();
  return db.aiMessages
    .filter((m) => m.userId === userId && (m.channel ?? "coach") === channel)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createAiMessage(message: AiMessageRecord) {
  const db = readDb();
  db.aiMessages.push(message);
  writeDb(db);
}

// Bodyweight logs (member-facing, deferred to Slice 7)

export function findBodyWeightLogsByUserId(userId: string): BodyWeightLogRecord[] {
  const db = readDb();
  return db.bodyWeightLogs
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function saveBodyWeightLog(log: BodyWeightLogRecord) {
  const db = readDb();
  const index = db.bodyWeightLogs.findIndex((l) => l.id === log.id);
  if (index === -1) {
    db.bodyWeightLogs.push(log);
  } else {
    db.bodyWeightLogs[index] = log;
  }
  writeDb(db);
}

const MAX_STORED_NOTIFICATIONS = 500;

export function findNotificationsByUserId(userId: string): NotificationRecord[] {
  const db = readDb();
  return db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findUnreadNotificationCount(userId: string): number {
  const db = readDb();
  return db.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
}

export function createNotification(notification: NotificationRecord) {
  const db = readDb();
  db.notifications.push(notification);

  if (db.notifications.length > MAX_STORED_NOTIFICATIONS) {
    // Keep the most recent records per user — cull oldest globally
    db.notifications = db.notifications
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_STORED_NOTIFICATIONS);
  }

  writeDb(db);
}

export function markNotificationRead(id: string, userId: string): boolean {
  const db = readDb();
  const n = db.notifications.find((x) => x.id === id && x.userId === userId);
  if (!n) return false;
  n.readAt = new Date().toISOString();
  writeDb(db);
  return true;
}

export function markAllNotificationsRead(userId: string) {
  const db = readDb();
  const now = new Date().toISOString();
  db.notifications.forEach((n) => {
    if (n.userId === userId && n.readAt === null) {
      n.readAt = now;
    }
  });
  writeDb(db);
}

export function findNotificationByDedupeKey(
  userId: string,
  dedupeKey: string
): NotificationRecord | undefined {
  const db = readDb();
  return db.notifications.find((n) => n.userId === userId && n.dedupeKey === dedupeKey);
}

export function findAllBookings(): BookingRecord[] {
  const db = readDb();
  return db.bookings;
}

// ─── Push subscriptions ────────────────────────────────────────────────────────

// Upsert by (userId, endpoint): updates keys + updatedAt for an existing
// endpoint instead of inserting a duplicate row.
export function savePushSubscription(sub: PushSubscriptionRecord): void {
  const db = readDb();
  const existing = db.pushSubscriptions.find(
    (s) => s.userId === sub.userId && s.endpoint === sub.endpoint
  );
  if (existing) {
    existing.p256dh = sub.p256dh;
    existing.auth = sub.auth;
    existing.userAgent = sub.userAgent;
    existing.updatedAt = sub.updatedAt;
  } else {
    db.pushSubscriptions.push(sub);
  }
  writeDb(db);
}

export function findPushSubscriptionsByUserId(userId: string): PushSubscriptionRecord[] {
  const db = readDb();
  return db.pushSubscriptions.filter((s) => s.userId === userId);
}

// Scoped to userId so a user can only remove their own subscriptions.
export function deletePushSubscriptionByEndpoint(userId: string, endpoint: string): void {
  const db = readDb();
  db.pushSubscriptions = db.pushSubscriptions.filter(
    (s) => !(s.userId === userId && s.endpoint === endpoint)
  );
  writeDb(db);
}

// ── Catalog helpers ───────────────────────────────────────────────────
export function findMembershipCategories(): MembershipCategoryRecord[] {
  return readDb().membershipCategories.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findMembershipCategoryById(id: string): MembershipCategoryRecord | undefined {
  return readDb().membershipCategories.find((c) => c.id === id);
}

export function saveMembershipCategory(category: MembershipCategoryRecord) {
  const db = readDb();
  const i = db.membershipCategories.findIndex((c) => c.id === category.id);
  if (i === -1) db.membershipCategories.push(category);
  else db.membershipCategories[i] = category;
  writeDb(db);
}

export function deleteMembershipCategory(id: string) {
  const db = readDb();
  db.membershipCategories = db.membershipCategories.filter((c) => c.id !== id);
  writeDb(db);
}

export function findMembershipPackages(): MembershipPackageRecord[] {
  return readDb().membershipPackages.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findMembershipPackagesByCategoryId(categoryId: string): MembershipPackageRecord[] {
  return findMembershipPackages().filter((p) => p.categoryId === categoryId);
}

export function findMembershipPackageById(id: string): MembershipPackageRecord | undefined {
  return readDb().membershipPackages.find((p) => p.id === id);
}

export function saveMembershipPackage(pkg: MembershipPackageRecord) {
  const db = readDb();
  const i = db.membershipPackages.findIndex((p) => p.id === pkg.id);
  if (i === -1) db.membershipPackages.push(pkg);
  else db.membershipPackages[i] = pkg;
  writeDb(db);
}

export function deleteMembershipPackage(id: string) {
  const db = readDb();
  db.membershipPackages = db.membershipPackages.filter((p) => p.id !== id);
  writeDb(db);
}

export function findMembershipBillingOptions(): MembershipBillingOptionRecord[] {
  return readDb().membershipBillingOptions.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findMembershipBillingOptionsByPackageId(
  packageId: string
): MembershipBillingOptionRecord[] {
  return findMembershipBillingOptions().filter((o) => o.packageId === packageId);
}

export function findMembershipBillingOptionById(
  id: string
): MembershipBillingOptionRecord | undefined {
  return readDb().membershipBillingOptions.find((o) => o.id === id);
}

export function saveMembershipBillingOption(option: MembershipBillingOptionRecord) {
  const db = readDb();
  const i = db.membershipBillingOptions.findIndex((o) => o.id === option.id);
  if (i === -1) db.membershipBillingOptions.push(option);
  else db.membershipBillingOptions[i] = option;
  writeDb(db);
}

export function deleteMembershipBillingOption(id: string) {
  const db = readDb();
  db.membershipBillingOptions = db.membershipBillingOptions.filter((o) => o.id !== id);
  writeDb(db);
}

// Reference guards for safe deletes.
export function countPackagesByCategoryId(categoryId: string): number {
  return readDb().membershipPackages.filter((p) => p.categoryId === categoryId).length;
}

export function countBillingOptionsByPackageId(packageId: string): number {
  return readDb().membershipBillingOptions.filter((o) => o.packageId === packageId).length;
}

export function countSubscriptionsByPackageId(packageId: string): number {
  return readDb().subscriptions.filter((s) => s.packageId === packageId).length;
}

// How many purchases (any status, incl. pending/failed) reference this
// catalog package. Any reference means the package's name/pricing is
// load-bearing for purchase history, so it must be hidden rather than deleted.
export function countPurchasesByProductId(productId: string): number {
  return readDb().purchases.filter((p) => p.productId === productId).length;
}

export function findPurchaseById(id: string): PurchaseRecord | undefined {
  return readDb().purchases.find((p) => p.id === id);
}

export function findPurchaseByProviderOrderId(orderId: string): PurchaseRecord | undefined {
  return readDb().purchases.find((p) => p.providerOrderId === orderId);
}

export function findPurchaseByIdempotencyKey(key: string): PurchaseRecord | undefined {
  return readDb().purchases.find((p) => p.idempotencyKey === key);
}

export function findPurchasesByUserId(userId: string): PurchaseRecord[] {
  return readDb()
    .purchases.filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findAllPurchases(): PurchaseRecord[] {
  return readDb().purchases;
}

export function savePurchase(purchase: PurchaseRecord) {
  const db = readDb();
  const index = db.purchases.findIndex((p) => p.id === purchase.id);
  if (index === -1) db.purchases.push(purchase);
  else db.purchases[index] = purchase;
  writeDb(db);
}

// Webhook replay protection: true if this logical event was already applied.
export function hasPaymentEvent(key: string): boolean {
  return readDb().paymentEvents.some((e) => e.key === key);
}

export function recordPaymentEvent(event: PaymentEventRecord) {
  const db = readDb();
  if (db.paymentEvents.some((e) => e.key === event.key)) return;
  db.paymentEvents.push(event);
  writeDb(db);
}

export function appendPassLedgerEntry(entry: PassLedgerEntryRecord) {
  const db = readDb();
  db.passLedger.push(entry);
  writeDb(db);
}

export function findPassLedgerByUserId(userId: string): PassLedgerEntryRecord[] {
  return readDb().passLedger.filter((e) => e.userId === userId);
}

export function findPassLedgerByPurchaseId(purchaseId: string): PassLedgerEntryRecord[] {
  return readDb().passLedger.filter((e) => e.purchaseId === purchaseId);
}

export function findPassLedgerByBookingId(bookingId: string): PassLedgerEntryRecord[] {
  return readDb().passLedger.filter((e) => e.bookingId === bookingId);
}

export function findPurchaseByProviderPaymentRef(ref: string): PurchaseRecord | undefined {
  return readDb().purchases.find((p) => p.providerPaymentRef === ref);
}

export function findSubscriptionBySetupOrderId(
  setupOrderId: string
): SubscriptionRecord | undefined {
  return readDb().subscriptions.find(
    (subscription) => subscription.providerSetupOrderId === setupOrderId
  );
}

// A subscription with an in-flight switch whose checkout session matches —
// how the webhook promotes a confirmed switch onto the active membership.
export function findSubscriptionByPendingSetupOrderId(
  sessionId: string
): SubscriptionRecord | undefined {
  return readDb().subscriptions.find((subscription) => subscription.pendingSetupOrderId === sessionId);
}
