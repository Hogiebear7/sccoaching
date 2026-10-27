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
  | "aiNutritionCoachChat";

// Every gated feature is a DIGITAL feature. Listed individually, not as one boolean, so a feature that should follow the
// gym Membership instead (none today) has to be added here on purpose.
const FEATURE_REQUIRES: Record<MemberFeature, "digital" | "gymMembership"> = {
  workoutGenerate: "digital",
  trackerImport: "digital",
  workoutReview: "digital",
  foodSearch: "digital",
  unlimitedCustomFoods: "digital",
  nutritionMoreTools: "digital",
  gymProfiles: "digital",
  notifications: "digital",
  aiCoachChat: "digital",
  aiNutritionCoachChat: "digital",
};

export function hasAccess(access: MemberAccess, feature: MemberFeature): boolean {
  return access[FEATURE_REQUIRES[feature]];
}

// Surfaces that belong to the gym Membership and nothing else (human coach messaging, staff visibility into member data).
export function hasGymMembership(access: MemberAccess): boolean {
  return access.gymMembership;
}

// Free tier's custom-food/quick-add cap — enforced both server-side
// (food/custom/create route) and, softer, client-side for an early heads-up
// before the member fills out the whole form.
export const FREE_CUSTOM_FOOD_LIMIT = 10;
