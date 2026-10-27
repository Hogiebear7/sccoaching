// Member-facing feature gating — the counterpart to lib/permissions.ts's staff role/capability system.
//
// Two INDEPENDENT things can be true of a member (owner decision D1, 2026-10-15):
//
//   gymMembership — a paid gym Membership (classes, passes, human coach messaging). Sold by the gym, outside the app stores.
//   digital       — the App-only digital plan: AI chat, workout generation, food search, tracker import and the other
//                   features below. Sold through Google Play or the App Store, or granted by staff as a complimentary
//                   entitlement. A gym Membership does NOT include it.
//
// This replaces the earlier three-value tier ("free" | "app_subscription" | "membership"), which ranked a Membership equal
// to the App Subscription for every digital feature. That ranking is exactly what the owner decision removed, and keeping a
// single ranked value would have let it come back by accident. The two flags cannot be compared with each other.
//
// Mirrored byte-for-byte in sc-coaching-mobile/src/lib/member-access.ts (same "ported pure logic" pattern already used for
// gramsForServing/nutritionForGrams) so the client never shows something the server would actually reject. The server is
// the authority: this module only answers "given these two flags", and the flags themselves are computed server-side by
// lib/membership-entitlement.ts from verified records.

export interface MemberAccess {
  /** A live digital entitlement: a verified store subscription still inside its paid period, or a staff grant. */
  digital: boolean;
  /** A live paid gym Membership. */
  gymMembership: boolean;
}

export const NO_ACCESS: MemberAccess = { digital: false, gymMembership: false };

export type MemberFeature =
  | "workoutGenerate"
  | "trackerImport"
  | "workoutReview"
  | "foodSearch"
  | "unlimitedCustomFoods"
  | "nutritionMoreTools"
  | "gymProfiles"
  | "notifications"
  | "aiCoachChat"
  | "aiNutritionCoachChat"
  | "unlimitedSavedWorkouts"
  | "unlimitedSavedMeals"
  | "programmes"
  | "weeklyPlanner"
  | "calorieTargets"
  | "fullHistory"
  | "cyclePhaseGuidance"
  | "communityLeaderboards"
  | "coachMessaging";

// What each feature needs (owner decisions 2026-10-27). "free" = everyone: logging (with food search and custom foods) and notifications stay
// on the Free tier, because nothing in them costs the owner money per use. "digital" = the App subscription (or a staff grant). "gymMembership" =
// the paid gym Membership, whose only in-app extra is direct coach messaging. Listed one by one so a feature's tier is always a deliberate choice.
const FEATURE_REQUIRES: Record<MemberFeature, "free" | "digital" | "gymMembership"> = {
  workoutGenerate: "digital",
  trackerImport: "digital",
  workoutReview: "digital",
  foodSearch: "free",
  unlimitedCustomFoods: "free",
  nutritionMoreTools: "digital",
  gymProfiles: "digital",
  notifications: "free",
  aiCoachChat: "digital",
  aiNutritionCoachChat: "digital",
  unlimitedSavedWorkouts: "digital",
  unlimitedSavedMeals: "digital",
  programmes: "digital",
  weeklyPlanner: "digital",
  calorieTargets: "digital",
  fullHistory: "digital",
  cyclePhaseGuidance: "digital",
  communityLeaderboards: "digital",
  coachMessaging: "gymMembership",
};

export function hasAccess(access: MemberAccess, feature: MemberFeature): boolean {
  const needs = FEATURE_REQUIRES[feature];
  return needs === "free" ? true : access[needs];
}

// Surfaces that belong to the gym Membership and nothing else (human coach messaging, staff visibility into member data).
export function hasGymMembership(access: MemberAccess): boolean {
  return access.gymMembership;
}

// Free tier's custom-food/quick-add cap. Custom foods are now free and unlimited (a barcode miss must never stop logging), so the gate in
// food/custom/create always passes; the constant stays for apps that still show it.
export const FREE_CUSTOM_FOOD_LIMIT = 10;

// Free-tier allowances (owner decisions 2026-10-27): enough to build the habit, with a clear point to upgrade. Enforced on the server.
export const FREE_SAVED_WORKOUT_LIMIT = 3;
export const FREE_SAVED_MEAL_LIMIT = 5;
export const FREE_HISTORY_DAYS = 7;

/** The first date (YYYY-MM-DD) a Free member's history and trends reach back to: today and the 6 days before. */
export function freeHistoryStartDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (FREE_HISTORY_DAYS - 1));
  return d.toISOString().slice(0, 10);
}
