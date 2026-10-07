// Tenant-scope classification of every datastore collection and every module-level cache.
//
// This is documentation that fails the build. The collection table is typed against
// DatabaseCollectionName, so adding a collection to lib/db.ts without classifying it here is a
// compile error. __tests__/lib/resource-scope.test.ts additionally checks that each named
// ownership field really exists on the record type, and that every module-level cache found in
// lib/ appears in MODULE_CACHE_SCOPE.
//
// Kinds:
//   identity          the account record; gymId on it is the tenant anchor for everything else.
//   gym-direct        carries its own gymId (null = primary gym).
//   gym-via-parent    no gymId of its own; tenant is its parent's. Read through the parent.
//   user-owned        owned by one account; tenant is that account's gymId. A read or write by id
//                     must first prove the OWNER is the session user or is in the staff user's gym.
//   money-provenance  immutable ownerGym provenance stamp (gym | platform | unresolved). It records
//                     whose money it is; it is NOT an access control. Access is platform-only.
//   global-shared     one platform-wide copy by design; every gym reads the same rows.
//   platform-only     platform operator data; no gym role may read it.
//   credential        single-use or bearer secrets bound to a user; never listed or returned.
//
// docs/tenant-context-and-authorization-2026-10.md explains the reasoning behind each choice.

import type { DatabaseCollectionName } from "./db";

export type CollectionScopeKind =
  | "identity"
  | "gym-direct"
  | "gym-via-parent"
  | "user-owned"
  | "money-provenance"
  | "global-shared"
  | "platform-only"
  | "credential";

export interface CollectionScope {
  kind: CollectionScopeKind;
  /** The record field that carries the ownership, or the parent path for gym-via-parent. */
  owner?: string;
  note?: string;
}

const user = (owner = "userId", note?: string): CollectionScope => ({ kind: "user-owned", owner, ...(note ? { note } : {}) });
const gym = (note?: string): CollectionScope => ({ kind: "gym-direct", owner: "gymId", ...(note ? { note } : {}) });
const parent = (owner: string, note?: string): CollectionScope => ({ kind: "gym-via-parent", owner, ...(note ? { note } : {}) });
const shared = (note: string): CollectionScope => ({ kind: "global-shared", note });
const platform = (note: string): CollectionScope => ({ kind: "platform-only", note });
const credential = (owner = "userId"): CollectionScope => ({ kind: "credential", owner });

export const COLLECTION_SCOPE = {
  users: { kind: "identity", owner: "gymId", note: "One gym per account. Multi-gym membership is out of scope and not representable." },
  profiles: user(),
  resetTokens: credential(),
  mobileHandoffTokens: credential(),
  follows: user("followerId", "Both ends are checked to share a gym before a follow is created."),
  communityPrivacy: user(),
  workoutComments: user("userId", "Community feed is gym-scoped on read via the author's gym."),
  workoutLikes: user(),
  commentReports: user("reporterId", "Resolution is gated on the reporter's gym."),
  emailChangeRequests: user(),
  invites: parent("invitedByStaffId", "Tenant is the inviting staff member's gym; redemption checks it."),
  programmes: user(),
  trainingPrograms: user(),
  workoutTemplates: user(),
  gymProfiles: user("userId", "A member's own equipment profiles, not a tenant. The name is historical."),
  nutritionTargets: user(),
  foodEntries: user(),
  customFoods: user("ownerUserId"),
  commonFoods: shared("Shared food catalogue."),
  brandedFoods: shared("Shared food catalogue."),
  foodModerationRequests: user("userId", "Queue is shared moderation work: owner decision pending (audit 12.2)."),
  foodSubmissions: user("userId", "Queue is shared moderation work: owner decision pending (audit 12.2)."),
  foodIdentificationOverrides: user(),
  foodFavorites: user(),
  workoutSessions: user(),
  exercises: shared("Shared exercise catalogue; any gym's staff can mutate it (audit 12.2, owner decision pending)."),
  aiMessages: user(),
  bodyWeightLogs: user(),
  bodyFatLogs: user(),
  classes: gym(),
  classSeries: gym(),
  classWorkouts: parent("classId", "Tenant is the class's gym."),
  classWorkoutTemplates: parent("createdByStaffId", "Tenant is the creating staff member's gym."),
  classCategories: gym(),
  deletedCategoryLabels: shared("Display-name lookup for deleted category slugs."),
  bookings: user(),
  noShows: user(),
  attendanceWatchlist: user(),
  coachNotes: user("userId", "Staff-written, member-owned; staff access is same-gym only."),
  membershipCategories: gym(),
  membershipPackages: parent("categoryId", "Tenant is the category's gym, except deliveryChannel app_only (platform-global App Subscription)."),
  gyms: { kind: "gym-direct", owner: "id", note: "The tenant record itself. Moderation is exact-role platform_operator." },
  membershipBillingOptions: parent("packageId", "Tenant is the package's tenant."),
  subscriptions: user("userId", "One row per user. ownerGym is provenance, not access control."),
  googlePlayPurchases: user("userId", "Purchase-token ownership record; first valid binding wins."),
  iapEvents: user("userId", "Append-only audit log of App Subscription transitions. userId is null for an event with no resolvable account. Not exposed to any gym role yet; a reader must authorise through the owner's gym or the platform. Kept after account deletion (owner decision 6 is open)."),
  iapNotifications: platform("Pub/Sub message-id dedupe for provider notifications. No tenant, no user."),
  purchases: user("userId", "ownerGym is provenance, not access control."),
  paymentEvents: { kind: "money-provenance", owner: "ownerGym", note: "Webhook idempotency ledger. Platform-only reads." },
  passLedger: user("userId", "ownerGym is provenance, not access control."),
  pendingCancellationCredits: user(),
  recoveryLogs: user(),
  waterLogs: user(),
  messages: user("memberId", "Thread belongs to the member; staff access is same-gym only."),
  notifications: user(),
  waitlistEntries: user(),
  jobRuns: platform("Housekeeping run history."),
  aiRedirectEvents: platform("Anonymous AI-redirect telemetry, no user or gym."),
  revenueEvents: { kind: "money-provenance", owner: "ownerGym", note: "Platform finance only." },
  aiUsageLogs: user(),
  financeLedgerEntries: { kind: "money-provenance", owner: "ownerGym", note: "finance.view is exact-role platform_operator (audit 12.5)." },
  cycleSettings: user(),
  cyclePrivacyPreferences: user(),
  pregnancyStatus: user(),
  weeklyTrainingSchedules: user(),
  pushSubscriptions: credential(),
  expoPushTokens: credential(),
  contactInquiries: platform("Anonymous inbox for the platform operator."),
  emailSettings: platform("Singleton transactional-email toggles."),
  financeSettings: platform("Singleton platform finance settings."),
  readinessAlertSettings: platform("Singleton readiness-alert settings."),
  bugReports: user("userId", "Staff triage is same-gym only."),
  recipes: user(),
  shoppingListItems: user(),
} as const satisfies Record<DatabaseCollectionName, CollectionScope>;

// Every module-level cache or long-lived in-memory structure under lib/. A cache must be one of:
//  - global:  holds nothing tenant- or user-specific (config, a client, a credential).
//  - keyed:   every key carries the tenant or the user, and a hit is only ever returned after the
//             caller's authorization has already passed.
export type ModuleCacheClass = "global" | "keyed";

export interface ModuleCacheScope {
  file: string;
  symbol: string;
  cacheClass: ModuleCacheClass;
  note: string;
}

export const MODULE_CACHE_SCOPE: readonly ModuleCacheScope[] = [
  { file: "lib/ai.ts", symbol: "cachedClient", cacheClass: "global", note: "Anthropic SDK client. Holds the platform API key, no tenant data." },
  { file: "lib/app-config.ts", symbol: "cached", cacheClass: "global", note: "Parsed deployment configuration. Read once at first use." },
  { file: "lib/exercise-library/admin-client.ts", symbol: "cached", cacheClass: "global", note: "Supabase service client for the shared exercise library." },
  { file: "lib/providers/google-play.ts", symbol: "cachedToken", cacheClass: "global", note: "Google service-account access token. Platform credential, identical for every tenant." },
  { file: "lib/rate-limit.ts", symbol: "buckets", cacheClass: "keyed", note: "Keys are built by callers from the user id, the gym id, the client IP or a lower-cased email, never from a bare shared value." },
] as const;

// Module-level `new Map(` / `new Set(` constants that are static lookup tables built from literals
// at import time and never written afterwards. They hold no request data. The scan in
// resource-scope.test.ts ignores exactly these.
export const STATIC_LOOKUP_CONSTANTS: readonly { file: string; symbol: string }[] = [
  { file: "lib/ai-context.ts", symbol: "DIETARY_LABEL" },
  { file: "lib/class-covers.ts", symbol: "BUILTIN_COVER_SRCS" },
  { file: "lib/class-covers.ts", symbol: "BUILTIN_DEFAULT_ALTS" },
  { file: "lib/countries.ts", symbol: "COUNTRY_VALUES" },
  { file: "lib/iap/entitlement-conflict.ts", symbol: "LIVE_STATUSES" },
  { file: "lib/nutrition-data.ts", symbol: "DIET_LABEL" },
  { file: "lib/permissions.ts", symbol: "PLATFORM_ONLY_CAPABILITIES" },
  { file: "lib/profile-options.ts", symbol: "ALLERGEN_VALUES" },
  { file: "lib/profile-options.ts", symbol: "INTOLERANCE_VALUES" },
  { file: "lib/workout-helper.ts", symbol: "BODYWEIGHT_ONLY" },
  { file: "lib/workout-helper.ts", symbol: "TIMED" },
] as const;
