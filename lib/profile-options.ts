import type { CycleRegularity, DietaryPreference, Gender, PrimaryGoal } from "./profile-schema";

export interface SelectOption<T extends string> {
  label: string;
  value: T;
}

export const GENDER_OPTIONS: SelectOption<Gender>[] = [
  { label: "Male", value: "Male" },
  { label: "Female", value: "Female" },
  { label: "Other", value: "Other" },
];

export const PRIMARY_GOAL_OPTIONS: SelectOption<PrimaryGoal>[] = [
  { label: "Weight Loss", value: "Weight Loss" },
  { label: "Build Muscle", value: "Build Muscle" },
  { label: "Maintenance", value: "Maintenance" },
  { label: "Injury Recovery", value: "Injury Recovery" },
  { label: "Sports Performance", value: "Sports Performance" },
  { label: "General Health", value: "General Health" },
  { label: "Improve Fitness", value: "Improve Fitness" },
  { label: "Improve Mobility", value: "Improve Mobility" },
];

export const CYCLE_REGULARITY_OPTIONS: SelectOption<CycleRegularity>[] = [
  { label: "Regular", value: "Regular" },
  { label: "Irregular", value: "Irregular" },
  { label: "Unsure", value: "Unsure" },
];

// ── Dietary requirements ──────────────────────────────────────────────
// Preference is single-select and ranks food suggestions. Allergen +
// intolerance option `value`s are the canonical keys stored on the profile
// and matched against the food catalog's allergen tags — keep them in sync
// with lib/nutrition-recommendations.ts.

export const DIETARY_PREFERENCE_OPTIONS: SelectOption<DietaryPreference>[] = [
  { label: "No preference", value: "standard" },
  { label: "Vegetarian", value: "vegetarian" },
  { label: "Pescetarian", value: "pescetarian" },
  { label: "Vegan", value: "vegan" },
];

// Allergen keys (value) with member-friendly labels. `value` is what's stored
// and what the food catalog tags against.
export const ALLERGEN_OPTIONS: SelectOption<string>[] = [
  { label: "Peanuts", value: "peanuts" },
  { label: "Tree nuts", value: "tree_nuts" },
  { label: "Shellfish", value: "shellfish" },
  { label: "Fish", value: "fish" },
  { label: "Eggs", value: "eggs" },
  { label: "Milk / dairy", value: "milk" },
  { label: "Soy", value: "soy" },
  { label: "Sesame", value: "sesame" },
  { label: "Gluten", value: "gluten" },
];

export const INTOLERANCE_OPTIONS: SelectOption<string>[] = [
  { label: "Coeliac", value: "coeliac" },
  { label: "Lactose intolerant", value: "lactose_intolerant" },
];

export const DIETARY_NOTES_PLACEHOLDER =
  "Anything else about your diet — other allergies, dislikes, or preferences";

export const DIETARY_PREFERENCE_VALUES = DIETARY_PREFERENCE_OPTIONS.map((o) => o.value);
const ALLERGEN_VALUES = new Set(ALLERGEN_OPTIONS.map((o) => o.value));
const INTOLERANCE_VALUES = new Set(INTOLERANCE_OPTIONS.map((o) => o.value));

export interface SanitizedDietary {
  dietaryPreference: DietaryPreference;
  allergies: string[];
  intolerancesOrMedical: string[];
  dietaryNotes: string | null;
}

// Validates untrusted dietary input from signup / profile-update into a clean,
// storable shape: unknown preference → "standard"; allergen/intolerance lists
// filtered to known keys and de-duplicated; notes trimmed to null-or-string.
// Keeps the two API routes in sync and prevents junk keys reaching the food
// filter.
export function sanitizeDietaryFields(input: {
  dietaryPreference?: unknown;
  allergies?: unknown;
  intolerancesOrMedical?: unknown;
  dietaryNotes?: unknown;
}): SanitizedDietary {
  const pref =
    typeof input.dietaryPreference === "string" &&
    (DIETARY_PREFERENCE_VALUES as string[]).includes(input.dietaryPreference)
      ? (input.dietaryPreference as DietaryPreference)
      : "standard";

  const cleanList = (raw: unknown, allowed: Set<string>): string[] =>
    Array.isArray(raw)
      ? Array.from(new Set(raw.filter((v): v is string => typeof v === "string" && allowed.has(v))))
      : [];

  const notes =
    typeof input.dietaryNotes === "string" && input.dietaryNotes.trim()
      ? input.dietaryNotes.trim()
      : null;

  return {
    dietaryPreference: pref,
    allergies: cleanList(input.allergies, ALLERGEN_VALUES),
    intolerancesOrMedical: cleanList(input.intolerancesOrMedical, INTOLERANCE_VALUES),
    dietaryNotes: notes,
  };
}

export const CYCLE_TRACKING_BENEFIT_COPY =
  "Track patterns, symptoms, and phases to support training, recovery, and coach guidance.";

export const ADDITIONAL_INFO_PLACEHOLDER =
  "Any other info, injuries, preferences, or context we should know";

export const SIGNUP_STEP_TITLES = [
  "Account Setup",
  "Basic Profile",
  "Goals and Context",
  "Cycle Tracking",
  "Review",
] as const;