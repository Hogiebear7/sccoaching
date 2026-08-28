import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID, randomBytes, createHash } from "crypto";

import type {
  CyclePrivacyPreferencesRecord,
  CycleSettingsRecord,
  PregnancyStatusRecord,
  ProfileRecord,
  UserRecord,
  UserRole,
  WeeklyTrainingScheduleRecord,
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

// A member requesting a change of their account email — the new address is
// only ever applied once they click the link sent TO THAT NEW ADDRESS (never
// the old one), which is what actually proves they control it. Same
// tokenHash-only-on-disk discipline as ResetTokenRecord.
interface EmailChangeRequestRecord {
  tokenHash: string;
  userId: string;
  newEmail: string;
  expiresAt: string;
  createdAt: string;
}

export type InviteStatus = "pending" | "redeemed" | "expired" | "revoked";

// Staff-issued invite granting a specific tier on redemption (see
// lib/member-access.ts). Looked up by tokenHash, same pattern as
// ResetTokenRecord — the raw token only ever exists in the emailed link.
export interface InviteRecord {
  id: string;
  email: string;
  tier: "app_subscription" | "membership";
  tokenHash: string;
  status: InviteStatus;
  invitedByStaffId: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
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
// "standard" is the default/omitted case. The rest describe how a set (or a
// whole exercise, when no per-set breakdown is given) was actually
// performed — member self-logged, not prescribed.
export type WorkoutSetType = "standard" | "warmup" | "dropset" | "myoset" | "failure" | "partial";

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
  setDetails?: {
    weight: string | null;
    reps: number | null;
    setType?: WorkoutSetType | null;
    /** Per-side reps for a unilateral set (perSide true) — reps is null when
        these are used, and vice versa. */
    repsRight?: number | null;
    repsLeft?: number | null;
  }[] | null;
  /** Applies when setDetails isn't used (or as this exercise's default set
      type) — e.g. "this whole exercise was to failure". */
  setType?: WorkoutSetType | null;
  /** Exercises sharing the same non-null group id within one session were
      performed back-to-back as a superset — member self-tagged, not a
      separate record. Order within the session implies the pairing order. */
  supersetGroup?: string | null;
  /** True when reps/weight were performed per side (unilateral exercise —
      e.g. single-arm row), rather than combined across both sides. */
  perSide?: boolean | null;
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
  /** Overall session RPE (1-10) and free-text notes from the post-workout
      "How did that feel?" prompt — distinct from any per-exercise rir/rpe.
      Feeds the workout review and the AI report. */
  sessionRpe?: number | null;
  feelingNotes?: string | null;
  /** Cached AI-generated session review paragraph (lib/workout-review.ts +
      generateWorkoutReview) — generated once on first request, not
      regenerated on every fetch. Cleared implicitly by never being set;
      there's no invalidation since the underlying session data driving it
      doesn't change after logging. */
  reviewText?: string | null;
  reviewGeneratedAt?: string | null;
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

// ── Training programs — staff-assigned, MacroFactor-style day blocks ───────
// A program is a named set of day templates (Workout A/B/C/D, rest days,
// etc.) a coach assigns to one member. The member works through days in
// order via currentDayIndex, which advances each time they mark the current
// day complete — it does not lock to calendar dates, matching the reference
// app's "just do the next one" model rather than a rigid weekly schedule.
export type ProgramDayType = "workout" | "rest";
export type TrainingProgramStatus = "active" | "archived";

export interface PrescribedSet {
  reps: string | null;
  weight: string | null;
  setType: WorkoutSetType | null;
}

export interface PrescribedExercise {
  /** Stable within the program day — lets the member UI track per-exercise
      completion without depending on array position. */
  id: string;
  exerciseId: string | null;
  name: string;
  muscleTags: string[];
  targetSets: number | null;
  /** e.g. "8-10" or "AMRAP" — free text since prescriptions aren't always a
      single number. Used when sets (per-set breakdown) isn't given. */
  targetReps: string | null;
  targetWeight: string | null;
  setType: WorkoutSetType | null;
  sets: PrescribedSet[] | null;
  /** Exercises sharing the same non-null group id within one day are
      prescribed as a superset. */
  supersetGroup: string | null;
  notes: string | null;
}

export interface ProgramDayRecord {
  id: string;
  label: string;
  type: ProgramDayType;
  exercises: PrescribedExercise[];
}

export interface TrainingProgramRecord {
  id: string;
  userId: string;
  name: string;
  status: TrainingProgramStatus;
  days: ProgramDayRecord[];
  /** Index into days[] the member should do next. Advances (with wraparound)
      each time the current day is marked complete. */
  currentDayIndex: number;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Workout templates — member-owned reusable workouts (the "Library"). A
// member builds these themselves to start a familiar session quickly;
// distinct from TrainingProgramRecord above, which is staff-assigned.
// archivedAt !== null hides it from the Library but keeps it browsable in
// the Archive screen rather than losing it outright.
export interface WorkoutTemplateRecord {
  id: string;
  userId: string;
  name: string;
  exercises: PrescribedExercise[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Shopping list + saved recipes — member-owned, flat (no aisle/category
// grouping by design). Both an item and a recipe ingredient keep displayText
// (what the member actually sees/typed) alongside normalizedName/quantity/
// unit as best-effort structure, never ONLY a flat string — this is what
// lets "add ingredients from a saved recipe" merge sensibly against what's
// already on the list, and leaves room for a future pantry/food-planning
// feature to match against normalizedName without a re-migration.
export interface RecipeIngredientEntry {
  displayText: string;
  normalizedName: string | null;
  quantity: number | null;
  unit: string | null;
}

export interface RecipeRecord {
  id: string;
  userId: string;
  title: string;
  ingredients: RecipeIngredientEntry[];
  notes: string | null;
  // "meal-suggest" = saved from a What Can I Make? suggestion (provenance
  // for the ingredient parsing quality — those strings were AI-generated
  // prose, not user-typed, so quantity/unit parsing is best-effort at best).
  source: "meal-suggest" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingListItemRecord {
  id: string;
  userId: string;
  displayText: string;
  normalizedName: string | null;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  // Which saved recipe this was added from, if any — provenance only, not
  // used to cascade-delete on recipe removal (a shopping list item outlives
  // the recipe it came from).
  sourceRecipeId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A member's declared equipment setup (see lib/equipment-catalog.ts for the
// slugs equipmentSlugs references) — used to filter the exercise library
// and shape workout generation. Distinct from ExerciseLibraryRecord, which
// lives in Supabase; this is per-member mutable data, so it follows the
// JSON-store convention used everywhere else in this file instead.
export interface GymProfileRecord {
  id: string;
  userId: string;
  name: string;
  icon: string | null;
  equipmentSlugs: string[];
  /** Slug of the GYM_PROFILE_PRESETS entry this was created from, if any —
      purely informational (e.g. for a "based on Home Gym" hint); editing
      equipmentSlugs afterward doesn't clear it. */
  presetSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Nutrition diary — member food logging against a target ─────────────────
// One target per member (overwritten on adjustment, not versioned — the
// "since" date is just updatedAt); diary entries are the member's own
// manually-logged meals, no external food database involved.
//
// mode governs where calories/proteinG/carbsG/fatG come from:
//  - "manual": the numbers on this record are the target, staff-set.
//  - "disabled": no target shown to the member at all; numbers are ignored.
//  - "auto": numbers are ignored — the target is computed fresh by
//    lib/nutrition-target-data.ts (adaptive TDEE or cold-start estimate).
// No record at all for a member also means "auto" — it's the default for
// everyone until a coach explicitly overrides or disables it. mode is
// optional so pre-existing records (all staff-set before this field
// existed) read as "manual" (see normalization below).
export type NutritionTargetMode = "auto" | "manual" | "disabled";

export interface NutritionTargetRecord {
  id: string;
  userId: string;
  mode?: NutritionTargetMode;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  setByStaffId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodEntryRecord {
  id: string;
  userId: string;
  date: string;
  mealType: MealType;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: string;
  /** Present when this entry was logged from the food catalog rather than
      typed in free-hand — lets "log again" / History resolve back to the
      source food and its per-100g nutrition rather than just the snapshot. */
  foodId?: string | null;
  foodDomain?: FoodDomain | null;
  servingLabel?: string | null;
  servingGrams?: number | null;
  quantity?: number | null;
}

// ── Food catalog — normalizes every source (member-created, generic/
// "common", vendor/"branded") into ONE internal schema so the app and its
// API consumers never see a raw vendor payload. Nutrition is always stored
// per 100g; a serving is just a labelled gram conversion layered on top, so
// "log 1.5 servings" and "log 150g" both reduce to the same gram math.
// "History" is deliberately NOT a stored domain here — it's a derived view
// over a user's own FoodEntryRecord log (see getFoodHistory in
// lib/food-catalog.ts) rather than a catalog record, matching how MacroFactor
// treats recency as a ranking signal, not a food source.
export type FoodDomain = "custom" | "common" | "branded";

// Where a record's data actually came from — distinct from `domain` (which
// UI group it renders in). A branded record can be admin-curated OR sourced
// from Open Food Facts; a custom food is always user-authored.
export type FoodProvenance = "user" | "open_food_facts" | "admin" | "usda_seed";

export interface FoodServing {
  label: string;
  grams: number;
}

export interface FoodNutrition100g {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  saturatedFatG: number | null;
}

export interface FoodRecord {
  id: string;
  domain: FoodDomain;
  name: string;
  brandName: string | null;
  barcode: string | null;
  /** A real product photo — only ever set from an Open Food Facts payload
      (branded domain); null for common/custom foods, which fall back to a
      keyword-matched icon on the client instead. */
  imageUrl: string | null;
  nutrition100g: FoodNutrition100g;
  defaultServing: FoodServing;
  servings: FoodServing[];
  provenance: FoodProvenance;
  /** External id this was normalized from — an Open Food Facts barcode/
      product id, an admin user id, or null for plain user-authored foods. */
  sourceRef: string | null;
  verified: boolean;
  /** Region scoping — ISO 3166-1 alpha-2 for admin/manual entries and for
      OFF-sourced records whose country tag has a known mapping (see
      normalizeOffCountryTag in lib/food-catalog.ts); an OFF country tag with
      no mapping is left in OFF's own raw format (e.g. "en:atlantis") rather
      than dropped, since it's still useful for eyeballing even though it
      won't match a member's alpha-2 country for search-ranking purposes.
      null when the record isn't region-scoped. */
  region: string | null;
  /** Set only for domain "custom" — who owns/can edit this food. */
  ownerUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Last time this was (re)fetched from its external source — drives the
      branded-cache staleness check; null for custom/common records. */
  fetchedAt: string | null;
}

// A member's standing correction for the AI photo-identification tool: "when
// you say X, I actually mean Y" — e.g. the vision model keeps calling their
// usual carton "Milk" when it's actually oat milk. Applied as a deterministic
// post-processing swap right after identifyFoodPhoto returns (see
// applyFoodIdentificationOverrides in lib/food-identification-override.ts),
// never as a change to the vision prompt itself — no added AI cost, and the
// underlying photo call stays exactly as accurate/inaccurate as it always
// was for every other member.
export interface FoodIdentificationOverrideRecord {
  id: string;
  userId: string;
  /** Normalized (trimmed/lowercased/whitespace-collapsed) form of the AI's
      originally-identified name — the match key. See normalizeTriggerLabel
      in lib/food-identification-override.ts; never store a raw, un-normalized
      label here or lookups will silently miss on casing/whitespace. */
  triggerLabel: string;
  preferredFood: {
    name: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    servingDescription: string;
  };
  createdAt: string;
}

// A member flags a barcode/food that couldn't be found (barcode lookup
// exhausted, or a bad search result) for staff review — the seed for keeping
// the common/branded catalog honest over time.
export type FoodModerationStatus = "open" | "resolved" | "dismissed";

export interface FoodModerationRequest {
  id: string;
  userId: string;
  barcode: string | null;
  queryText: string | null;
  note: string | null;
  status: FoodModerationStatus;
  resolvedFoodId: string | null;
  resolvedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Tracks a member's opt-in request to publish their own custom food
// publicly via Open Food Facts. Only created once a food passes eligibility
// (lib/food-submission.ts) and the member has explicitly consented — goes
// through internal staff review before any live OFF write is attempted.
// This repo has no OFF producer credentials, so "approved" is currently the
// terminal state in practice; "submitted_to_open_food_facts"/"failed" are
// real outcomes of a live write that only fire when isOffLiveWriteEnabled()
// is true (see lib/open-food-facts-client.ts) — the workflow is real and
// resumable once credentials exist, not simulated.
export type FoodSubmissionStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "submitted_to_open_food_facts"
  | "failed";

export interface FoodSubmissionRecord {
  id: string;
  userId: string;
  customFoodId: string;
  status: FoodSubmissionStatus;
  consentGiven: boolean;
  consentedAt: string | null;
  frontPhotoUrl: string | null;
  labelPhotoUrl: string | null;
  reviewedByStaffId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  offProductId: string | null;
  submittedAt: string | null;
  failureReason: string | null;
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

// Mirrors BodyWeightLogRecord exactly — same optional-metric-tracking
// pattern (see lib/body-fat.ts / lib/body-weight.ts for the resolver pair).
export interface BodyFatLogRecord {
  id: string;
  userId: string;
  date: string;
  bodyFatPct: number;
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
  // Set once the no-show detection job has evaluated this booking (whether
  // or not it turned out to be a no-show) — the idempotency guard that
  // stops a re-run from notifying the same missed class twice.
  noShowProcessedAt: string | null;
  createdAt: string;
}

// One row per detected no-show: a booking nobody checked in for, more than
// an hour after the class ended. monthKey ("YYYY-MM", from the class's
// calendar date) is what the miss-count/watchlist rules key off — a
// calendar-month reset, not a billing-cycle one (see docs discussion).
export interface NoShowRecord {
  id: string;
  classId: string;
  userId: string;
  classTitle: string;
  classDate: string;
  monthKey: string;
  createdAt: string;
}

// Staff-only flag: created once a member's no-show count for a calendar
// month reaches 2. Coaches can delete an entry (e.g. the member had a
// legitimate reason) — deleting it does not un-count the underlying
// NoShowRecords, and a later third miss in the same month does not
// recreate it, since the entry is only ever created on the miss that
// first crosses the threshold, not recomputed from live counts each run.
export interface WatchlistEntryRecord {
  id: string;
  userId: string;
  monthKey: string;
  missCount: number;
  addedAt: string;
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

// Tier/channel classification — added alongside the Finances rebuild so
// Tier 2 app-only subscriptions (sold through Apple/Google, not Stripe
// checkout) can be defined and reported on distinctly from Tier 1
// website/gym memberships and class passes. Purely descriptive: nothing in
// the checkout/entitlement engine branches on these fields today, so they
// default safely for every existing package (see readDb migration) and
// don't change how existing in-person/Stripe packages behave.
export type DeliveryChannel = "in_person" | "hybrid" | "app_only";
export type BillingChannel = "stripe_web" | "apple_iap" | "google_play" | "manual";
export type AccessType = "membership" | "pass" | "subscription" | "add_on";

export const DELIVERY_CHANNELS: DeliveryChannel[] = ["in_person", "hybrid", "app_only"];
export const BILLING_CHANNELS: BillingChannel[] = ["stripe_web", "apple_iap", "google_play", "manual"];
export const ACCESS_TYPES: AccessType[] = ["membership", "pass", "subscription", "add_on"];

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
  /** How this package is delivered. Existing packages migrate to "in_person". */
  deliveryChannel: DeliveryChannel;
  /** How this package is actually paid for. Existing packages migrate to
      "stripe_web" (matches current checkout behaviour). Tier 2 app-only
      subscriptions should use "apple_iap"/"google_play"/"manual" — the admin
      can define/display/report on them even though the actual purchase
      happens in the app store, not through this app's checkout. */
  billingChannel: BillingChannel;
  /** Coarser than packageType for reporting — migrates from packageType
      (membership→membership, pass→pass, top_up→add_on). */
  accessType: AccessType;
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

// A late cancellation (within the cancellation cutoff) forfeits the
// member's credit by default — but if the vacated spot gets filled before
// the class starts (a waitlist offer is accepted, or someone else books
// directly), the credit is restored after all. One record per late
// cancellation; "pending" until either resolved by a refill or left
// forfeited (the class starting with it still pending — no state change
// needed there, since forfeiture was already the default at cancel time).
export type PendingCancellationCreditStatus = "pending" | "refilled";

export interface PendingCancellationCreditRecord {
  id: string;
  classId: string;
  userId: string;
  /** The now-deleted booking this credit came from — kept for audit context only. */
  bookingId: string;
  creditSource: "pass" | "subscription";
  status: PendingCancellationCreditStatus;
  createdAt: string;
  resolvedAt: string | null;
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

// One row per member per date, ml accumulated across the day's quick-adds —
// mirrors RecoveryLogRecord's date-keyed upsert pattern (findByUserIdAndDate
// + save-replaces-existing-for-that-date), not a running log of individual
// drinks.
export interface WaterLogRecord {
  id: string;
  userId: string;
  date: string;
  ml: number;
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

// Native push (Expo push tokens — iOS/Android app), distinct from the web
// app's browser Web Push subscriptions above. Both are fanned out to by
// lib/push.ts's sendPush() so existing notification call sites (messages,
// bookings, etc.) reach native app users with no changes.
export interface ExpoPushTokenRecord {
  id: string;
  userId: string;
  token: string;
  deviceInfo: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | "message"
  | "membership"
  | "class_reminder"
  | "booking_confirmed"
  | "booking_cancelled"
  | "cancellation"
  | "waitlist_offer"
  | "waitlist_timeout"
  | "readiness_alert"
  | "cancellation_credit_restored"
  | "no_show";

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

// ── Business finance ledger ─────────────────────────────────────────────
// Everything money-related that ISN'T already captured by the Stripe/Revolut
// webhook pipeline above (RevenueEventRecord for renewals, PurchaseRecord for
// one-off pass/top-up buys — both left untouched, and merged in at read time
// by lib/finance.ts's buildFinanceLedgerLines). This ledger is where every
// EXPENSE lives, every FEE lives, and every income source with no webhook
// (Apple/Google app-store subscriptions, cash/manual payments, misc income,
// one-off corrections) lives. One shape for all three kinds rather than
// separate tables, because they share the same audit fields (date, amount,
// status, reference) and need to sit side-by-side in one filterable ledger —
// the kind-specific classification (incomeSource/incomeType vs expenseType
// vs feeType) is what actually differs, and exactly one of those three is
// set depending on `kind`.
//
// Rows are staff-entered (manual entry works today) but the shape already
// carries what an automated importer would need (sourceExternalId for
// dedupe, a real status enum including "pending"/"estimate") so a future
// App Store Server Notifications / Google Play RTDN / Stripe balance
// transaction importer can write into this same table without a redesign.
export type FinanceEntryKind = "income" | "expense" | "fee";

export type FinanceIncomeSource = "stripe" | "apple" | "google" | "revolut" | "manual_cash" | "other";
export type FinanceIncomeType = "tier1_membership" | "class_pass" | "tier2_app_subscription" | "misc_income";
export type FinanceExpenseType =
  | "payroll"
  | "contractor"
  | "software"
  | "rent"
  | "utilities"
  | "marketing"
  | "tax"
  | "misc";
export type FinanceFeeType = "stripe_fee" | "apple_fee" | "google_fee" | "tax_withheld" | "other_fee";
// "cleared" = money has actually moved (received or paid out) — the only
// status counted in money-in/out/net totals and forecasts. "estimate" is for
// a projected/provisional row (e.g. a bulk monthly fee estimate) that should
// be visible in the ledger but never silently treated as real money.
export type FinanceEntryStatus = "pending" | "cleared" | "refunded" | "disputed" | "failed" | "estimate";

export const FINANCE_INCOME_SOURCES: FinanceIncomeSource[] = [
  "stripe",
  "apple",
  "google",
  "revolut",
  "manual_cash",
  "other",
];
export const FINANCE_INCOME_TYPES: FinanceIncomeType[] = [
  "tier1_membership",
  "class_pass",
  "tier2_app_subscription",
  "misc_income",
];
export const FINANCE_EXPENSE_TYPES: FinanceExpenseType[] = [
  "payroll",
  "contractor",
  "software",
  "rent",
  "utilities",
  "marketing",
  "tax",
  "misc",
];
export const FINANCE_FEE_TYPES: FinanceFeeType[] = ["stripe_fee", "apple_fee", "google_fee", "tax_withheld", "other_fee"];
export const FINANCE_ENTRY_STATUSES: FinanceEntryStatus[] = [
  "pending",
  "cleared",
  "refunded",
  "disputed",
  "failed",
  "estimate",
];

export interface FinanceLedgerEntryRecord {
  id: string;
  kind: FinanceEntryKind;
  /** Set only when kind === "income". */
  incomeSource: FinanceIncomeSource | null;
  incomeType: FinanceIncomeType | null;
  /** Set only when kind === "expense". */
  expenseType: FinanceExpenseType | null;
  /** Set only when kind === "fee". */
  feeType: FinanceFeeType | null;
  status: FinanceEntryStatus;
  /** ISO date this entry is attributed to — the field range filters and
      forecasting operate on. Not necessarily "now"; staff can log a
      previous period's expense. */
  date: string;
  currency: string;
  /** The headline amount: what was charged (income), what was spent
      (expense), or the fee itself (fee). */
  grossAmountCents: number;
  /** A fee known/deducted at entry time — e.g. logging an Apple payout where
      Apple has already taken its cut, so gross and net are both known
      up-front. 0 when not applicable (most expense/fee rows, and income rows
      whose fee is tracked separately via a standalone "fee" kind row
      instead). Kept editable rather than derived so staff aren't forced to
      pick one mechanism. */
  feeAmountCents: number;
  /** grossAmountCents - feeAmountCents for income; equal to grossAmountCents
      for expense/fee rows (kept for a consistent read shape). */
  netAmountCents: number;
  /** Optional link back to a member (e.g. an Apple/Google subscriber, or
      whose renewal a fee/refund relates to). Null for business-wide rows
      (rent, payroll, software). */
  memberId: string | null;
  /** Optional link back to a catalog package, for Tier 2 app-subscription
      income or per-package expense attribution. */
  packageId: string | null;
  /** Optional link to another ledger entry this one relates to — e.g. a
      standalone fee row that offsets a specific income row. */
  relatedEntryId: string | null;
  /** Free-text reference — invoice number, payout ID, cheque number. */
  reference: string | null;
  /** External transaction id from a future automated importer (Apple/Google
      transaction id, Stripe balance transaction id) — reserved for dedupe
      once that ingestion exists. Null for every manually-entered row today. */
  sourceExternalId: string | null;
  notes: string | null;
  /** Staff member who entered this row. */
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
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
// balance) and time-sensitive waitlist-offer emails are deliberately NOT
// modelled here — they must always send and are never gated by these toggles.
//
// Booking cancellation, gym-cancelled classes, class reminders, and the
// waitlist-offer-expiring warning are push-only by policy (no email code
// path at all any more) — see sendPush call sites in booking cancel/delete
// routes, lib/jobs/send-class-reminders.ts, and
// lib/jobs/process-waitlist-offers.ts. Only these two plus the no-show email
// remain as actual emails for now.
export type TransactionalEmailType = "bookingConfirmation" | "noShow";

export const TRANSACTIONAL_EMAIL_TYPES: TransactionalEmailType[] = [
  "bookingConfirmation",
  "noShow",
];

export type TransactionalEmailSettings = Record<TransactionalEmailType, boolean>;

// Defaults mirror current behaviour: every optional email is ON.
export const DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS: TransactionalEmailSettings = {
  bookingConfirmation: true,
  noShow: true,
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

// Staff-configured settings for the Finances workspace (singleton).
//  - taxRatePercent: a manually-entered estimate rate. Still not a filing
//    figure — this app doesn't know the business's real tax treatment — but
//    now multiplies against net income (after expenses/fees), not gross.
//  - stripeFeePercent/stripeFeeFixedCents: an admin-entered estimate formula
//    (Stripe's own published rate, e.g. 1.5% + €0.25) used to DERIVE an
//    estimated Stripe fee figure against actual Stripe income for the
//    selected period. This app doesn't call the Stripe API for real
//    per-transaction fees, so this is explicitly an estimate, not a synced
//    value — see lib/finance-shared.ts estimateStripeFeeCents.
//  - cashPositionAnchorCents/cashPositionAnchorDate: a manually-entered
//    "balance as of this date" starting point. The app has no real bank
//    connection, so current cash position is always
//    anchor + ledger movements since the anchor date — an app-calculated
//    estimate, never a bank-synced value. null = no anchor set yet.
export interface FinanceSettings {
  taxRatePercent: number | null;
  stripeFeePercent: number | null;
  stripeFeeFixedCents: number | null;
  cashPositionAnchorCents: number | null;
  cashPositionAnchorDate: string | null;
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  taxRatePercent: null,
  stripeFeePercent: null,
  stripeFeeFixedCents: null,
  cashPositionAnchorCents: null,
  cashPositionAnchorDate: null,
};

// Staff-configured settings for alerting a coach before a session when a
// member's readiness score comes in low (singleton). Off by default — a
// gym that never checks it shouldn't start silently paging staff.
export interface ReadinessAlertSettings {
  enabled: boolean;
  /** 0-100 — a readiness score strictly below this triggers the alert. */
  threshold: number;
}

export const DEFAULT_READINESS_ALERT_SETTINGS: ReadinessAlertSettings = {
  enabled: false,
  threshold: 50,
};

interface Database {
  users: StoredUser[];
  profiles: ProfileRecord[];
  resetTokens: ResetTokenRecord[];
  emailChangeRequests: EmailChangeRequestRecord[];
  invites: InviteRecord[];
  programmes: ProgrammeRecord[];
  trainingPrograms: TrainingProgramRecord[];
  workoutTemplates: WorkoutTemplateRecord[];
  gymProfiles: GymProfileRecord[];
  nutritionTargets: NutritionTargetRecord[];
  foodEntries: FoodEntryRecord[];
  customFoods: FoodRecord[];
  commonFoods: FoodRecord[];
  brandedFoods: FoodRecord[];
  foodModerationRequests: FoodModerationRequest[];
  foodSubmissions: FoodSubmissionRecord[];
  foodIdentificationOverrides: FoodIdentificationOverrideRecord[];
  workoutSessions: WorkoutSessionRecord[];
  exercises: ExerciseRecord[];
  aiMessages: AiMessageRecord[];
  bodyWeightLogs: BodyWeightLogRecord[];
  bodyFatLogs: BodyFatLogRecord[];
  classes: ClassRecord[];
  classSeries: ClassSeriesRecord[];
  classWorkouts: ClassWorkoutRecord[];
  classWorkoutTemplates: ClassWorkoutTemplateRecord[];
  classCategories: ClassCategoryRecord[];
  // slug → display name for categories that have been deleted. Populated by
  // deleteClassCategory so historical class/plan records still render a
  // human-readable label rather than a raw slug.
  deletedCategoryLabels: Record<string, string>;
  bookings: BookingRecord[];
  noShows: NoShowRecord[];
  attendanceWatchlist: WatchlistEntryRecord[];
  coachNotes: CoachNoteRecord[];
  membershipCategories: MembershipCategoryRecord[];
  membershipPackages: MembershipPackageRecord[];
  membershipBillingOptions: MembershipBillingOptionRecord[];
  subscriptions: SubscriptionRecord[];
  purchases: PurchaseRecord[];
  paymentEvents: PaymentEventRecord[];
  passLedger: PassLedgerEntryRecord[];
  pendingCancellationCredits: PendingCancellationCreditRecord[];
  recoveryLogs: RecoveryLogRecord[];
  waterLogs: WaterLogRecord[];
  messages: MessageRecord[];
  notifications: NotificationRecord[];
  waitlistEntries: WaitlistEntryRecord[];
  jobRuns: JobRunRecord[];
  aiRedirectEvents: AiRedirectEventRecord[];
  revenueEvents: RevenueEventRecord[];
  financeLedgerEntries: FinanceLedgerEntryRecord[];
  cycleSettings: CycleSettingsRecord[];
  cyclePrivacyPreferences: CyclePrivacyPreferencesRecord[];
  pregnancyStatus: PregnancyStatusRecord[];
  weeklyTrainingSchedules: WeeklyTrainingScheduleRecord[];
  pushSubscriptions: PushSubscriptionRecord[];
  expoPushTokens: ExpoPushTokenRecord[];
  contactInquiries: ContactInquiryRecord[];
  // Optional-email toggles (singleton). Missing keys default to ON via readDb.
  emailSettings: TransactionalEmailSettings;
  financeSettings: FinanceSettings;
  readinessAlertSettings: ReadinessAlertSettings;
  // TRIAL-ONLY — see BugReportRecord above and docs/bug-reports.md.
  bugReports: BugReportRecord[];
  recipes: RecipeRecord[];
  shoppingListItems: ShoppingListItemRecord[];
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
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Longer than a password reset — this is a member deliberately checking a
// different inbox, not an urgent security action, so a tighter window would
// just cause avoidable "link expired" friction.
const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;

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
      emailChangeRequests: [],
      invites: [],
      programmes: [],
      trainingPrograms: [],
      workoutTemplates: [],
      gymProfiles: [],
      nutritionTargets: [],
      foodEntries: [],
      customFoods: [],
      commonFoods: [],
      brandedFoods: [],
      foodModerationRequests: [],
      foodSubmissions: [],
      foodIdentificationOverrides: [],
      workoutSessions: [],
      exercises: [],
      aiMessages: [],
      bodyWeightLogs: [],
      bodyFatLogs: [],
      classes: [],
      classSeries: [],
      classWorkouts: [],
      classWorkoutTemplates: [],
      classCategories: DEFAULT_CLASS_CATEGORIES,
      deletedCategoryLabels: {},
      bookings: [],
      noShows: [],
      attendanceWatchlist: [],
      coachNotes: [],
      membershipCategories: [],
      membershipPackages: [],
      membershipBillingOptions: [],
      subscriptions: [],
      purchases: [],
      paymentEvents: [],
      passLedger: [],
      pendingCancellationCredits: [],
      recoveryLogs: [],
      waterLogs: [],
      messages: [],
      notifications: [],
      waitlistEntries: [],
      jobRuns: [],
      aiRedirectEvents: [],
      revenueEvents: [],
      financeLedgerEntries: [],
      cycleSettings: [],
      cyclePrivacyPreferences: [],
      pregnancyStatus: [],
      weeklyTrainingSchedules: [],
      pushSubscriptions: [],
      expoPushTokens: [],
      contactInquiries: [],
      emailSettings: { ...DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS },
      financeSettings: { ...DEFAULT_FINANCE_SETTINGS },
      readinessAlertSettings: { ...DEFAULT_READINESS_ALERT_SETTINGS },
      bugReports: [],
      recipes: [],
      shoppingListItems: [],
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
      restTimerSeconds: p.restTimerSeconds ?? 90,
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
      activeGymProfileId: p.activeGymProfileId ?? null,
      emergencyContactName: p.emergencyContactName ?? null,
      emergencyContactPhone: p.emergencyContactPhone ?? null,
      emergencyContact2Name: p.emergencyContact2Name ?? null,
      emergencyContact2Phone: p.emergencyContact2Phone ?? null,
      pinnedExercises: p.pinnedExercises ?? null,
      pinnedProgressionExercises: p.pinnedProgressionExercises ?? null,
      heightCm: p.heightCm ?? null,
      bodyFatPct: p.bodyFatPct ?? null,
      goalWeightKg: p.goalWeightKg ?? null,
      goalBodyFatPct: p.goalBodyFatPct ?? null,
      goalTargetDate: p.goalTargetDate ?? null,
      trainingDaysPerWeek: p.trainingDaysPerWeek ?? null,
      secondaryGoal: p.secondaryGoal ?? null,
      country: p.country ?? null,
    })),
    resetTokens: parsed.resetTokens ?? [],
    emailChangeRequests: parsed.emailChangeRequests ?? [],
    invites: parsed.invites ?? [],
    programmes: parsed.programmes ?? [],
    trainingPrograms: parsed.trainingPrograms ?? [],
    workoutTemplates: parsed.workoutTemplates ?? [],
    gymProfiles: (parsed.gymProfiles ?? []).map((p) => ({ ...p, presetSlug: p.presetSlug ?? null })),
    // Every pre-existing record was an explicit staff-set target — default
    // to "manual" on read so its calories/macros keep meaning what they
    // always meant (see NutritionTargetRecord for the mode contract).
    nutritionTargets: (parsed.nutritionTargets ?? []).map((t) => ({ ...t, mode: t.mode ?? "manual" })),
    foodEntries: parsed.foodEntries ?? [],
    customFoods: parsed.customFoods ?? [],
    commonFoods: parsed.commonFoods ?? [],
    brandedFoods: parsed.brandedFoods ?? [],
    foodModerationRequests: parsed.foodModerationRequests ?? [],
    foodSubmissions: parsed.foodSubmissions ?? [],
    foodIdentificationOverrides: parsed.foodIdentificationOverrides ?? [],
    workoutSessions: (parsed.workoutSessions ?? []).map((s) => ({
      ...s,
      exercises: s.exercises ?? [],
      runs: s.runs ?? [],
    })),
    exercises: parsed.exercises ?? [],
    aiMessages: parsed.aiMessages ?? [],
    bodyWeightLogs: parsed.bodyWeightLogs ?? [],
    bodyFatLogs: parsed.bodyFatLogs ?? [],
    classes: (parsed.classes ?? []).map((c) => ({ ...c, category: c.category ?? "general", imageUrl: c.imageUrl ?? null, imageAlt: c.imageAlt ?? null })),
    classSeries: parsed.classSeries ?? [],
    classWorkouts: parsed.classWorkouts ?? [],
    classWorkoutTemplates: (parsed.classWorkoutTemplates ?? []).map((t) => ({
      ...t,
      exercises: (t.exercises ?? []).map((e) => ({
        ...e,
        supersetGroup: e.supersetGroup ?? null,
        perSide: e.perSide ?? false,
        repsRight: e.repsRight ?? null,
        repsLeft: e.repsLeft ?? null,
      })),
    })),
    // Seed built-in categories if the DB predates this field.
    // One-way migration: rows with isActive === false (previously archived) are
    // treated as deleted so they no longer appear in selection UIs.
    classCategories: (parsed.classCategories ?? DEFAULT_CLASS_CATEGORIES).filter(
      (c) => (c as { isActive?: boolean }).isActive !== false
    ),
    deletedCategoryLabels: parsed.deletedCategoryLabels ?? {},
    bookings: (parsed.bookings ?? []).map((b) => ({
      ...b,
      noShowProcessedAt: b.noShowProcessedAt ?? null,
    })),
    noShows: parsed.noShows ?? [],
    attendanceWatchlist: parsed.attendanceWatchlist ?? [],
    coachNotes: parsed.coachNotes ?? [],
    membershipCategories: parsed.membershipCategories ?? [],
    membershipPackages: (parsed.membershipPackages ?? []).map((pkg) => ({
      ...pkg,
      eligibleClassTypes: pkg.eligibleClassTypes ?? [],
      imageUrl: pkg.imageUrl ?? null,
      imageAlt: pkg.imageAlt ?? null,
      deliveryChannel: pkg.deliveryChannel ?? "in_person",
      billingChannel: pkg.billingChannel ?? "stripe_web",
      accessType: pkg.accessType ?? (pkg.packageType === "top_up" ? "add_on" : pkg.packageType === "pass" ? "pass" : "membership"),
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
    pendingCancellationCredits: parsed.pendingCancellationCredits ?? [],
    recoveryLogs: (parsed.recoveryLogs ?? []).map(normalizeRecoveryScale),
    waterLogs: parsed.waterLogs ?? [],
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
    financeLedgerEntries: parsed.financeLedgerEntries ?? [],
    cycleSettings: parsed.cycleSettings ?? [],
    cyclePrivacyPreferences: parsed.cyclePrivacyPreferences ?? [],
    pregnancyStatus: parsed.pregnancyStatus ?? [],
    weeklyTrainingSchedules: parsed.weeklyTrainingSchedules ?? [],
    pushSubscriptions: (parsed.pushSubscriptions ?? []).map((s) => ({
      ...s,
      userAgent: s.userAgent ?? null,
    })),
    expoPushTokens: parsed.expoPushTokens ?? [],
    contactInquiries: parsed.contactInquiries ?? [],
    // Merge over defaults so any missing (or future) key stays ON.
    emailSettings: { ...DEFAULT_TRANSACTIONAL_EMAIL_SETTINGS, ...(parsed.emailSettings ?? {}) },
    financeSettings: { ...DEFAULT_FINANCE_SETTINGS, ...(parsed.financeSettings ?? {}) },
    readinessAlertSettings: { ...DEFAULT_READINESS_ALERT_SETTINGS, ...(parsed.readinessAlertSettings ?? {}) },
    bugReports: parsed.bugReports ?? [],
    recipes: parsed.recipes ?? [],
    shoppingListItems: parsed.shoppingListItems ?? [],
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
  "cycleSettings", "cyclePrivacyPreferences", "pregnancyStatus", "pushSubscriptions", "expoPushTokens", "notifications",
  "purchases", "passLedger", "pendingCancellationCredits", "coachNotes", "weeklyTrainingSchedules",
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

export function findTrainingProgramById(id: string): TrainingProgramRecord | undefined {
  return readDb().trainingPrograms.find((p) => p.id === id);
}

export function findTrainingProgramsByUserId(userId: string): TrainingProgramRecord[] {
  return readDb()
    .trainingPrograms.filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findActiveTrainingProgramByUserId(userId: string): TrainingProgramRecord | undefined {
  return readDb().trainingPrograms.find((p) => p.userId === userId && p.status === "active");
}

export function findAllTrainingPrograms(): TrainingProgramRecord[] {
  return [...readDb().trainingPrograms].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveTrainingProgram(program: TrainingProgramRecord): void {
  const db = readDb();
  const index = db.trainingPrograms.findIndex((p) => p.id === program.id);
  if (index === -1) db.trainingPrograms.push(program);
  else db.trainingPrograms[index] = program;
  writeDb(db);
}

export function deleteTrainingProgram(id: string): void {
  const db = readDb();
  db.trainingPrograms = db.trainingPrograms.filter((p) => p.id !== id);
  writeDb(db);
}

export function findWorkoutTemplateById(id: string): WorkoutTemplateRecord | undefined {
  return readDb().workoutTemplates.find((t) => t.id === id);
}

export function findWorkoutTemplatesByUserId(userId: string): WorkoutTemplateRecord[] {
  return readDb()
    .workoutTemplates.filter((t) => t.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveWorkoutTemplate(template: WorkoutTemplateRecord): void {
  const db = readDb();
  const index = db.workoutTemplates.findIndex((t) => t.id === template.id);
  if (index === -1) db.workoutTemplates.push(template);
  else db.workoutTemplates[index] = template;
  writeDb(db);
}

export function deleteWorkoutTemplate(id: string): void {
  const db = readDb();
  db.workoutTemplates = db.workoutTemplates.filter((t) => t.id !== id);
  writeDb(db);
}

// ── Saved recipes ────────────────────────────────────────────────────────

export function findRecipeById(id: string): RecipeRecord | undefined {
  return readDb().recipes.find((r) => r.id === id);
}

export function findRecipesByUserId(userId: string): RecipeRecord[] {
  return readDb()
    .recipes.filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveRecipe(recipe: RecipeRecord): void {
  const db = readDb();
  const index = db.recipes.findIndex((r) => r.id === recipe.id);
  if (index === -1) db.recipes.push(recipe);
  else db.recipes[index] = recipe;
  writeDb(db);
}

export function deleteRecipe(id: string): void {
  const db = readDb();
  db.recipes = db.recipes.filter((r) => r.id !== id);
  writeDb(db);
}

// ── Shopping list ────────────────────────────────────────────────────────

export function findShoppingListItemsByUserId(userId: string): ShoppingListItemRecord[] {
  return readDb()
    .shoppingListItems.filter((i) => i.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findShoppingListItemById(id: string): ShoppingListItemRecord | undefined {
  return readDb().shoppingListItems.find((i) => i.id === id);
}

// Case-insensitive match on normalizedName (falling back to displayText when
// normalizedName isn't set) — the same key "add ingredients from a recipe"
// uses to decide whether it's adding a genuinely new item or just touching
// one that's already on the list.
export function findShoppingListItemByName(userId: string, name: string): ShoppingListItemRecord | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return readDb().shoppingListItems.find(
    (i) => i.userId === userId && (i.normalizedName ?? i.displayText).trim().toLowerCase() === key
  );
}

export function saveShoppingListItem(item: ShoppingListItemRecord): void {
  const db = readDb();
  const index = db.shoppingListItems.findIndex((i) => i.id === item.id);
  if (index === -1) db.shoppingListItems.push(item);
  else db.shoppingListItems[index] = item;
  writeDb(db);
}

export function deleteShoppingListItem(id: string): void {
  const db = readDb();
  db.shoppingListItems = db.shoppingListItems.filter((i) => i.id !== id);
  writeDb(db);
}

// ── Gym profiles ("Equipment Available") ────────────────────────────────

export function listGymProfilesForUser(userId: string): GymProfileRecord[] {
  return readDb()
    .gymProfiles.filter((p) => p.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getGymProfileById(userId: string, gymProfileId: string): GymProfileRecord | undefined {
  return readDb().gymProfiles.find((p) => p.id === gymProfileId && p.userId === userId);
}

export function createGymProfile(
  userId: string,
  input: { name: string; icon: string | null; equipmentSlugs: string[]; presetSlug: string | null }
): GymProfileRecord {
  const db = readDb();
  const now = new Date().toISOString();
  const record: GymProfileRecord = {
    id: randomUUID(),
    userId,
    name: input.name,
    icon: input.icon,
    equipmentSlugs: input.equipmentSlugs,
    presetSlug: input.presetSlug,
    createdAt: now,
    updatedAt: now,
  };
  db.gymProfiles.push(record);
  writeDb(db);
  return record;
}

export function updateGymProfile(
  userId: string,
  gymProfileId: string,
  patch: Partial<Pick<GymProfileRecord, "name" | "icon" | "equipmentSlugs">>
): GymProfileRecord | undefined {
  const db = readDb();
  const existing = db.gymProfiles.find((p) => p.id === gymProfileId && p.userId === userId);
  if (!existing) return undefined;
  Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
  writeDb(db);
  return existing;
}

export function deleteGymProfile(userId: string, gymProfileId: string): void {
  const db = readDb();
  db.gymProfiles = db.gymProfiles.filter((p) => !(p.id === gymProfileId && p.userId === userId));
  // Clear the active pointer if it pointed at the profile we just removed —
  // otherwise every filtered query would silently fall back to "not found"
  // for a member who never re-picks an active profile.
  const profile = db.profiles.find((pr) => pr.userId === userId);
  if (profile && profile.activeGymProfileId === gymProfileId) {
    profile.activeGymProfileId = null;
  }
  writeDb(db);
}

export function setActiveGymProfile(userId: string, gymProfileId: string | null): boolean {
  const db = readDb();
  if (gymProfileId !== null) {
    const exists = db.gymProfiles.some((p) => p.id === gymProfileId && p.userId === userId);
    if (!exists) return false;
  }
  const profile = db.profiles.find((p) => p.userId === userId);
  if (!profile) return false;
  profile.activeGymProfileId = gymProfileId;
  writeDb(db);
  return true;
}

export function getActiveGymProfile(userId: string): GymProfileRecord | null {
  const db = readDb();
  const activeId = db.profiles.find((p) => p.userId === userId)?.activeGymProfileId ?? null;
  if (!activeId) return null;
  return db.gymProfiles.find((p) => p.id === activeId && p.userId === userId) ?? null;
}

export function findNutritionTargetByUserId(userId: string): NutritionTargetRecord | undefined {
  return readDb().nutritionTargets.find((t) => t.userId === userId);
}

export function saveNutritionTarget(target: NutritionTargetRecord): void {
  const db = readDb();
  const index = db.nutritionTargets.findIndex((t) => t.userId === target.userId);
  if (index === -1) db.nutritionTargets.push(target);
  else db.nutritionTargets[index] = target;
  writeDb(db);
}

export function findFoodEntriesByUserId(userId: string): FoodEntryRecord[] {
  return readDb()
    .foodEntries.filter((e) => e.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findFoodEntryById(id: string): FoodEntryRecord | undefined {
  return readDb().foodEntries.find((e) => e.id === id);
}

export function saveFoodEntry(entry: FoodEntryRecord): void {
  const db = readDb();
  db.foodEntries.push(entry);
  writeDb(db);
}

export function deleteFoodEntry(id: string): void {
  const db = readDb();
  db.foodEntries = db.foodEntries.filter((e) => e.id !== id);
  writeDb(db);
}

// ── Food catalog CRUD — same shape across all three domains, so these are
// generic over the collection rather than duplicated per domain.
function foodCollection(db: Database, domain: FoodDomain): FoodRecord[] {
  if (domain === "custom") return db.customFoods;
  if (domain === "common") return db.commonFoods;
  return db.brandedFoods;
}

function setFoodCollection(db: Database, domain: FoodDomain, records: FoodRecord[]): void {
  if (domain === "custom") db.customFoods = records;
  else if (domain === "common") db.commonFoods = records;
  else db.brandedFoods = records;
}

export function findFoodById(domain: FoodDomain, id: string): FoodRecord | undefined {
  return foodCollection(readDb(), domain).find((f) => f.id === id);
}

export function findFoodByIdAnyDomain(id: string): FoodRecord | undefined {
  const db = readDb();
  return db.customFoods.find((f) => f.id === id) ?? db.commonFoods.find((f) => f.id === id) ?? db.brandedFoods.find((f) => f.id === id);
}

export function findCustomFoodsByUserId(userId: string): FoodRecord[] {
  return readDb().customFoods.filter((f) => f.ownerUserId === userId && !f.archivedAt);
}

export function findFoodByBarcode(domain: FoodDomain, barcode: string, ownerUserId?: string): FoodRecord | undefined {
  const records = foodCollection(readDb(), domain);
  return records.find((f) => f.barcode === barcode && !f.archivedAt && (domain !== "custom" || f.ownerUserId === ownerUserId));
}

export function findAllFoods(domain: FoodDomain): FoodRecord[] {
  return foodCollection(readDb(), domain).filter((f) => !f.archivedAt);
}

export function saveFood(record: FoodRecord): void {
  const db = readDb();
  const collection = foodCollection(db, record.domain);
  const index = collection.findIndex((f) => f.id === record.id);
  if (index === -1) collection.push(record);
  else collection[index] = record;
  setFoodCollection(db, record.domain, collection);
  writeDb(db);
}

export function deleteFood(domain: FoodDomain, id: string): void {
  const db = readDb();
  setFoodCollection(db, domain, foodCollection(db, domain).filter((f) => f.id !== id));
  writeDb(db);
}

export function findFoodIdentificationOverridesByUserId(userId: string): FoodIdentificationOverrideRecord[] {
  return readDb().foodIdentificationOverrides.filter((o) => o.userId === userId);
}

// Upsert keyed on (userId, triggerLabel) — one standing override per trigger
// per member, so re-saving "Always use this" for the same AI-identified name
// replaces the old preference rather than accumulating duplicates.
export function saveFoodIdentificationOverride(record: FoodIdentificationOverrideRecord): void {
  const db = readDb();
  const index = db.foodIdentificationOverrides.findIndex(
    (o) => o.userId === record.userId && o.triggerLabel === record.triggerLabel
  );
  if (index === -1) db.foodIdentificationOverrides.push(record);
  else db.foodIdentificationOverrides[index] = record;
  writeDb(db);
}

export function deleteFoodIdentificationOverride(id: string, userId: string): void {
  const db = readDb();
  db.foodIdentificationOverrides = db.foodIdentificationOverrides.filter((o) => !(o.id === id && o.userId === userId));
  writeDb(db);
}

export function createFoodModerationRequest(request: FoodModerationRequest): void {
  const db = readDb();
  db.foodModerationRequests.push(request);
  writeDb(db);
}

export function findAllFoodModerationRequests(): FoodModerationRequest[] {
  return [...readDb().foodModerationRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findFoodModerationRequestById(id: string): FoodModerationRequest | undefined {
  return readDb().foodModerationRequests.find((r) => r.id === id);
}

export function saveFoodModerationRequest(request: FoodModerationRequest): void {
  const db = readDb();
  const index = db.foodModerationRequests.findIndex((r) => r.id === request.id);
  if (index !== -1) db.foodModerationRequests[index] = request;
  writeDb(db);
}

export function createFoodSubmission(record: FoodSubmissionRecord): void {
  const db = readDb();
  db.foodSubmissions.push(record);
  writeDb(db);
}

export function findFoodSubmissionById(id: string): FoodSubmissionRecord | undefined {
  return readDb().foodSubmissions.find((s) => s.id === id);
}

export function findFoodSubmissionsByUserId(userId: string): FoodSubmissionRecord[] {
  return readDb()
    .foodSubmissions.filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findFoodSubmissionByCustomFoodId(customFoodId: string): FoodSubmissionRecord | undefined {
  // A custom food can only have one active submission at a time — the
  // create route enforces this; callers use it to show "already submitted".
  return readDb()
    .foodSubmissions.filter((s) => s.customFoodId === customFoodId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function findAllFoodSubmissions(): FoodSubmissionRecord[] {
  return [...readDb().foodSubmissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveFoodSubmission(record: FoodSubmissionRecord): void {
  const db = readDb();
  const index = db.foodSubmissions.findIndex((s) => s.id === record.id);
  if (index !== -1) db.foodSubmissions[index] = record;
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

export function deleteWorkoutSession(id: string): void {
  const db = readDb();
  db.workoutSessions = db.workoutSessions.filter((s) => s.id !== id);
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

export function markBookingNoShowProcessed(id: string): void {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) return;
  booking.noShowProcessedAt = new Date().toISOString();
  writeDb(db);
}

export function findNoShowsByUserId(userId: string): NoShowRecord[] {
  const db = readDb();
  return db.noShows.filter((n) => n.userId === userId);
}

export function findAllNoShows(): NoShowRecord[] {
  const db = readDb();
  return db.noShows;
}

export function createNoShow(record: NoShowRecord): void {
  const db = readDb();
  db.noShows.push(record);
  writeDb(db);
}

export function findAttendanceWatchlist(): WatchlistEntryRecord[] {
  const db = readDb();
  return db.attendanceWatchlist.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function findWatchlistEntryByUserAndMonth(
  userId: string,
  monthKey: string
): WatchlistEntryRecord | undefined {
  const db = readDb();
  return db.attendanceWatchlist.find((e) => e.userId === userId && e.monthKey === monthKey);
}

export function saveWatchlistEntry(record: WatchlistEntryRecord): void {
  const db = readDb();
  const index = db.attendanceWatchlist.findIndex((e) => e.id === record.id);
  if (index === -1) db.attendanceWatchlist.push(record);
  else db.attendanceWatchlist[index] = record;
  writeDb(db);
}

export function deleteWatchlistEntry(id: string): void {
  const db = readDb();
  db.attendanceWatchlist = db.attendanceWatchlist.filter((e) => e.id !== id);
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

export function findWaterLogByUserIdAndDate(userId: string, date: string): WaterLogRecord | undefined {
  const db = readDb();
  return db.waterLogs.find((log) => log.userId === userId && log.date === date);
}

export function saveWaterLog(log: WaterLogRecord) {
  const db = readDb();
  const index = db.waterLogs.findIndex((l) => l.userId === log.userId && l.date === log.date);

  if (index === -1) {
    db.waterLogs.push(log);
  } else {
    db.waterLogs[index] = log;
  }

  writeDb(db);
}

// The readiness trend chart only ever looks back 14 days, so anything older
// than that is dead weight with no UI that reads it — this keeps
// recoveryLogs from growing forever with rows nothing displays.
export function purgeOldRecoveryLogs(olderThanDays: number): number {
  const db = readDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const before = db.recoveryLogs.length;

  db.recoveryLogs = db.recoveryLogs.filter((log) => log.date >= cutoffISO);

  writeDb(db);
  return before - db.recoveryLogs.length;
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

// ─── Email change ───────────────────────────────────────────────────────

export function createEmailChangeToken(userId: string, newEmail: string): { token: string; expiresAt: string } {
  const db = readDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS).toISOString();

  // Requesting again supersedes any earlier outstanding request for this
  // user — only the most recent link should ever work.
  db.emailChangeRequests = db.emailChangeRequests.filter((entry) => entry.userId !== userId);

  db.emailChangeRequests.push({
    tokenHash: hashToken(token),
    userId,
    newEmail: newEmail.toLowerCase(),
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  writeDb(db);

  return { token, expiresAt };
}

// Validates the token and, if it's still live, swaps the account's email in
// the same write — returns the new email on success so the caller can
// confirm it back to the client without a second read.
export function consumeEmailChangeToken(token: string): string | undefined {
  const db = readDb();
  const now = new Date().toISOString();

  db.emailChangeRequests = db.emailChangeRequests.filter((entry) => entry.expiresAt > now);

  const tokenHash = hashToken(token);
  const match = db.emailChangeRequests.find((entry) => entry.tokenHash === tokenHash);

  if (!match) {
    writeDb(db);
    return undefined;
  }

  const { userId, newEmail } = match;
  db.emailChangeRequests = db.emailChangeRequests.filter((entry) => entry.userId !== userId);

  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    writeDb(db);
    return undefined;
  }

  user.email = newEmail;
  user.updatedAt = now;

  const profile = db.profiles.find((p) => p.userId === userId);
  if (profile) profile.email = newEmail;

  writeDb(db);

  return newEmail;
}

// ─── Tier invites ───────────────────────────────────────────────────────

export function createInvite(input: {
  email: string;
  tier: "app_subscription" | "membership";
  invitedByStaffId: string;
}): { invite: InviteRecord; token: string } {
  const db = readDb();
  const token = randomBytes(32).toString("hex");
  const now = new Date().toISOString();

  const invite: InviteRecord = {
    id: randomUUID(),
    email: input.email.toLowerCase(),
    tier: input.tier,
    tokenHash: hashToken(token),
    status: "pending",
    invitedByStaffId: input.invitedByStaffId,
    createdAt: now,
    expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString(),
    redeemedAt: null,
    redeemedByUserId: null,
  };

  db.invites.push(invite);
  writeDb(db);

  return { invite, token };
}

export function findInvites(): InviteRecord[] {
  return readDb().invites.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Marks any pending invite past its expiry as "expired" — lazy, on-read
// cleanup, same shape as consumeResetToken. Returns the number changed.
function expireStaleInvites(db: Database): boolean {
  const now = new Date().toISOString();
  let changed = false;
  db.invites = db.invites.map((invite) => {
    if (invite.status === "pending" && invite.expiresAt <= now) {
      changed = true;
      return { ...invite, status: "expired" as const };
    }
    return invite;
  });
  return changed;
}

// Looks up an invite by its raw (unhashed) token — used on the redemption
// page before the member has necessarily signed in/up. Returns the invite
// regardless of status, so the caller can show a clear "expired"/"already
// used" message rather than a generic not-found.
export function findInviteByToken(token: string): InviteRecord | undefined {
  const db = readDb();
  if (expireStaleInvites(db)) writeDb(db);
  return db.invites.find((invite) => invite.tokenHash === hashToken(token));
}

export function redeemInvite(inviteId: string, redeemedByUserId: string): InviteRecord | undefined {
  const db = readDb();
  expireStaleInvites(db);

  const invite = db.invites.find((i) => i.id === inviteId);
  if (!invite || invite.status !== "pending") {
    writeDb(db);
    return undefined;
  }

  invite.status = "redeemed";
  invite.redeemedAt = new Date().toISOString();
  invite.redeemedByUserId = redeemedByUserId;
  writeDb(db);

  return invite;
}

export function revokeInvite(inviteId: string): boolean {
  const db = readDb();
  const invite = db.invites.find((i) => i.id === inviteId);
  if (!invite || invite.status !== "pending") return false;

  invite.status = "revoked";
  writeDb(db);
  return true;
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

// Finance ledger — manual-entry rows (expenses, fees, and income sources
// with no webhook — see FinanceLedgerEntryRecord). Unlike the append-only
// revenue ledger above, these are staff-editable/deletable: a mistyped
// expense or a corrected date needs to be fixable, not compensated for with
// a reversing entry.
export function findAllFinanceLedgerEntries(): FinanceLedgerEntryRecord[] {
  return readDb().financeLedgerEntries;
}

export function findFinanceLedgerEntryById(id: string): FinanceLedgerEntryRecord | undefined {
  return readDb().financeLedgerEntries.find((e) => e.id === id);
}

export function saveFinanceLedgerEntry(entry: FinanceLedgerEntryRecord): void {
  const db = readDb();
  const i = db.financeLedgerEntries.findIndex((e) => e.id === entry.id);
  if (i === -1) db.financeLedgerEntries.push(entry);
  else db.financeLedgerEntries[i] = entry;
  writeDb(db);
}

export function deleteFinanceLedgerEntry(id: string): void {
  const db = readDb();
  db.financeLedgerEntries = db.financeLedgerEntries.filter((e) => e.id !== id);
  writeDb(db);
}

export function getReadinessAlertSettings(): ReadinessAlertSettings {
  return readDb().readinessAlertSettings;
}

export function saveReadinessAlertSettings(settings: ReadinessAlertSettings): void {
  const db = readDb();
  db.readinessAlertSettings = settings;
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

export function findWeeklyTrainingScheduleByUserId(userId: string): WeeklyTrainingScheduleRecord | undefined {
  const db = readDb();
  return db.weeklyTrainingSchedules.find((s) => s.userId === userId);
}

export function saveWeeklyTrainingSchedule(schedule: WeeklyTrainingScheduleRecord) {
  const db = readDb();
  const index = db.weeklyTrainingSchedules.findIndex((s) => s.userId === schedule.userId);
  if (index === -1) {
    db.weeklyTrainingSchedules.push(schedule);
  } else {
    db.weeklyTrainingSchedules[index] = schedule;
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

export function findPregnancyStatusByUserId(userId: string): PregnancyStatusRecord | undefined {
  const db = readDb();
  return db.pregnancyStatus.find((p) => p.userId === userId);
}

export function savePregnancyStatus(status: PregnancyStatusRecord) {
  const db = readDb();
  const index = db.pregnancyStatus.findIndex((p) => p.userId === status.userId);
  if (index === -1) {
    db.pregnancyStatus.push(status);
  } else {
    db.pregnancyStatus[index] = status;
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

// A reusable class workout — built once, assigned to one or more class
// categories, and loaded into a specific class's ClassWorkoutRecord from
// there (see /api/staff/classes/[classId]/workout). Distinct from
// ClassWorkoutRecord itself, which is the actual content for one dated
// class occurrence.
export interface ClassWorkoutTemplateExercise {
  exerciseId: string | null;
  name: string;
  weight: string;
  reps: number | null;
  sets: number | null;
  /** "ST1", "ST2", etc — exercises sharing a label are a superset, done
      back-to-back as one station. null = not part of one. */
  supersetGroup: string | null;
  /** True when reps differ per side (unilateral) — repsRight/repsLeft hold
      the split target and reps is null. */
  perSide: boolean;
  repsRight: number | null;
  repsLeft: number | null;
}

export interface ClassWorkoutTemplateRecord {
  id: string;
  name: string;
  categories: ClassCategory[];
  exercises: ClassWorkoutTemplateExercise[];
  notes: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
}

export function findClassWorkoutTemplates(): ClassWorkoutTemplateRecord[] {
  const db = readDb();
  return [...db.classWorkoutTemplates].sort((a, b) => a.name.localeCompare(b.name));
}

export function findClassWorkoutTemplateById(id: string): ClassWorkoutTemplateRecord | undefined {
  const db = readDb();
  return db.classWorkoutTemplates.find((t) => t.id === id);
}

export function saveClassWorkoutTemplate(template: ClassWorkoutTemplateRecord) {
  const db = readDb();
  const index = db.classWorkoutTemplates.findIndex((t) => t.id === template.id);
  if (index === -1) {
    db.classWorkoutTemplates.push(template);
  } else {
    db.classWorkoutTemplates[index] = template;
  }
  writeDb(db);
}

export function deleteClassWorkoutTemplate(id: string) {
  const db = readDb();
  db.classWorkoutTemplates = db.classWorkoutTemplates.filter((t) => t.id !== id);
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

// Body fat logs — mirrors the bodyWeightLogs functions above exactly.

export function findBodyFatLogsByUserId(userId: string): BodyFatLogRecord[] {
  const db = readDb();
  return db.bodyFatLogs
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function saveBodyFatLog(log: BodyFatLogRecord) {
  const db = readDb();
  const index = db.bodyFatLogs.findIndex((l) => l.id === log.id);
  if (index === -1) {
    db.bodyFatLogs.push(log);
  } else {
    db.bodyFatLogs[index] = log;
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

// ─── Expo (native) push tokens ─────────────────────────────────────────────

// Upsert by (userId, token): a device re-registering (e.g. after reinstall)
// just refreshes updatedAt rather than inserting a duplicate row.
export function saveExpoPushToken(record: ExpoPushTokenRecord): void {
  const db = readDb();
  const existing = db.expoPushTokens.find(
    (t) => t.userId === record.userId && t.token === record.token
  );
  if (existing) {
    existing.deviceInfo = record.deviceInfo;
    existing.updatedAt = record.updatedAt;
  } else {
    db.expoPushTokens.push(record);
  }
  writeDb(db);
}

export function findExpoPushTokensByUserId(userId: string): ExpoPushTokenRecord[] {
  const db = readDb();
  return db.expoPushTokens.filter((t) => t.userId === userId);
}

// Scoped to userId so a user can only remove their own tokens (used by the
// unregister-on-logout API route).
export function deleteExpoPushToken(userId: string, token: string): void {
  const db = readDb();
  db.expoPushTokens = db.expoPushTokens.filter(
    (t) => !(t.userId === userId && t.token === token)
  );
  writeDb(db);
}

// Unscoped — called from the send path when Expo reports a token as no
// longer valid (DeviceNotRegistered), regardless of which user owns it.
export function deleteExpoPushTokenByToken(token: string): void {
  const db = readDb();
  db.expoPushTokens = db.expoPushTokens.filter((t) => t.token !== token);
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

export function createPendingCancellationCredit(record: PendingCancellationCreditRecord): void {
  const db = readDb();
  db.pendingCancellationCredits.push(record);
  writeDb(db);
}

// Oldest-first, "pending" only — FIFO matches how the waitlist/booking queue
// itself is ordered, so the earliest unresolved late cancellation for a
// class is the one credited when a spot for it gets filled.
export function findPendingCancellationCreditsByClassId(classId: string): PendingCancellationCreditRecord[] {
  return readDb()
    .pendingCancellationCredits.filter((r) => r.classId === classId && r.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function savePendingCancellationCredit(record: PendingCancellationCreditRecord): void {
  const db = readDb();
  const index = db.pendingCancellationCredits.findIndex((r) => r.id === record.id);
  if (index === -1) db.pendingCancellationCredits.push(record);
  else db.pendingCancellationCredits[index] = record;
  writeDb(db);
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
