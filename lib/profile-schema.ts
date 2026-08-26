import type { DrinkSettings } from "./drink-settings";

export type Gender = "Male" | "Female" | "Other";

export type PrimaryGoal =
  | "Weight Loss"
  | "Build Muscle"
  | "Maintenance"
  | "Injury Recovery"
  | "Sports Performance"
  | "General Health"
  | "Improve Fitness"
  | "Improve Mobility";

export type CycleRegularity = "Regular" | "Irregular" | "Unsure";

// Structured dietary requirements. Preference is a single choice that ranks
// food suggestions; allergies + intolerances/medical are HARD exclusions the
// nutrition engine must never violate (see lib/nutrition-recommendations.ts).
export type DietaryPreference = "standard" | "vegetarian" | "pescetarian" | "vegan";

export type CycleEventType = "period_start" | "period_end" | "symptom" | "note";

// Staff roles are hierarchical (coach < admin < admin_manager); see
// lib/permissions.ts for what each can do. "staff" is a legacy alias for a
// full admin that older data may still carry — readDb migrates it to
// "admin_manager" on read (see lib/db.ts).
export type UserRole = "member" | "coach" | "admin" | "admin_manager" | "staff";

export type MeasurementUnits = "metric" | "imperial";

export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  // Soft-deactivation: an archived account can't sign in and is hidden from
  // the default staff member list, but all history (bookings, purchases,
  // ledger) stays intact and auditable. Optional so pre-existing records
  // without the field read as "not archived".
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileRecord {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string | null;
  gender: Gender;
  primaryGoal: PrimaryGoal;
  sportPlayed: string | null;
  currentWeightKg: number | null;
  // Optional so records created before this field existed stay valid;
  // readers should treat null/undefined as "not set" (see db.ts
  // normalization). Unlike currentWeightKg, height isn't synced from a
  // logging feature — it's a single directly-editable value.
  heightCm?: number | null;
  additionalInfo: string | null;
  // In-case-of-emergency contact — collected at signup, editable from
  // Profile, visible to staff on the member detail page. The second
  // contact is entirely optional; the first is asked for but stored as
  // nullable like other pre-existing-record-compatible fields (see db.ts
  // normalization) rather than enforced at the type level.
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContact2Name: string | null;
  emergencyContact2Phone: string | null;
  // Up to 5 exercise names the member has chosen to feature on their
  // Personal Bests card (Workouts tab), in the order they picked them.
  // Synced from mobile via /api/profile/pinned-exercises. Optional/null for
  // records created before this field existed (see db.ts normalization).
  pinnedExercises?: string[] | null;
  // Up to 3 exercises pinned for quick-view on the Workouts tab's
  // Progression chart — a separate, smaller list from pinnedExercises
  // (Personal Bests), since a member may want different exercises featured
  // in each place. See /api/profile/pinned-progression-exercises.
  pinnedProgressionExercises?: string[] | null;
  cycleTrackingEligible: boolean;
  cycleTrackingEnabled: boolean;
  menopauseSupportEnabled: boolean;
  reminderTimingsMins: number[] | null;
  emailNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  // Optional so records created before this field existed stay valid;
  // readers should treat null/undefined as "metric" (see db.ts normalization).
  preferredUnits?: MeasurementUnits;
  // How long the automatic rest timer counts down for after a set is marked
  // complete during workout logging (Workouts tab), in seconds. Also used as
  // the default when a member manually opens the rest timer. Optional for
  // backward compatibility; readers treat undefined as 90 (see db.ts
  // normalization).
  restTimerSeconds?: number;
  // Programme tab access — off by default, enabled per member by staff.
  // Optional for the same backwards-compatibility reason; treat undefined
  // as false (see db.ts normalization).
  programmeEnabled?: boolean;
  // Last-saved Sports Performance Drink calculator settings (Nutrition tab).
  // Synced from the client so they follow the member across devices, ground
  // the AI coach server-side, and are visible to staff. Optional/null for
  // records created before this field existed (see db.ts normalization).
  drinkSettings?: DrinkSettings | null;
  // When drinkSettings was last synced — shown to staff so they know how
  // current the member's setup is. Null until the first sync.
  drinkSettingsUpdatedAt?: string | null;
  // Dietary requirements. All optional for backward compatibility — readers
  // treat undefined as: preference "standard", empty allergen/intolerance
  // lists, no notes (see db.ts normalization).
  dietaryPreference?: DietaryPreference;
  /** Allergen keys (see ALLERGEN_OPTIONS). Hard exclusions. */
  allergies?: string[];
  /** Intolerance/medical keys (see INTOLERANCE_OPTIONS). Hard exclusions. */
  intolerancesOrMedical?: string[];
  dietaryNotes?: string | null;
  // Profile photo as a small data URL (client downsizes before upload; the
  // API enforces mime and size). Null/undefined = initials avatar.
  avatarDataUrl?: string | null;
  // Accent palette preset id (see lib/palettes.ts). Undefined = default teal.
  palette?: string;
  // Whole-app theme preset id (lib/palettes.ts THEME_OPTIONS). Undefined =
  // default midnight.
  theme?: string;
  onboardingCompleted: boolean;
  // First-login dashboard walkthrough — separate from onboardingCompleted
  // (which just marks the signup wizard as finished). Optional for backward
  // compatibility; readers treat undefined as "not yet seen" (see db.ts
  // normalization).
  dashboardTourCompleted?: boolean;
  // The gym profile (see GymProfileRecord in lib/db.ts) currently used to
  // filter the exercise library and shape workout generation. null = no
  // active profile, meaning unfiltered ("show all exercises"). Optional for
  // backward compatibility; readers treat undefined as null (see db.ts
  // normalization).
  activeGymProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CycleSettingsRecord {
  userId: string;
  lastPeriodStartDate: string | null;
  averageCycleLengthDays: number | null;
  periodLengthDays: number | null;
  regularity: CycleRegularity | null;
  privateNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CyclePrivacyPreferencesRecord {
  userId: string;
  shareCurrentPhaseWithCoach: boolean;
  shareExactDatesWithCoach: boolean;
  shareNotesWithCoach: boolean;
  createdAt: string;
  updatedAt: string;
}

// Private by default, same as cycle tracking — dueDate is derived once from
// the "currently N weeks along" value the member entered (see
// lib/pregnancy.ts's computeDueDate), not asked for directly, since most
// members think in "how far along am I" rather than an LMP/due date.
// shareWithCoach only becomes settable client-side once 12+ weeks along
// (see lib/pregnancy.ts's COACH_SHARE_UNLOCK_WEEKS) — stored regardless so
// a member who unshares later doesn't lose the underlying pregnancy data.
export interface PregnancyStatusRecord {
  userId: string;
  isPregnant: boolean;
  dueDate: string | null;
  shareWithCoach: boolean;
  createdAt: string;
  updatedAt: string;
}

// A member's recurring weekly training pattern — the sport/gym/other
// sessions they typically do on each day, distinct from a structured
// TrainingProgram (workout-by-workout plan) and from Schedule bookings
// (specific dated classes). Exists so non-gym training load (a football
// practice, a running club) is visible to the nutrition AI coach and to
// staff, since it never otherwise touches the app's workout-logging data.
export type TrainingDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // matches Date#getDay(), 0 = Sunday
export type TrainingActivityType = "gym" | "sport" | "cardio" | "rest" | "other";
export type TrainingTimeOfDay = "morning" | "afternoon" | "evening";
export type TrainingIntensity = "light" | "moderate" | "heavy";

export interface WeeklyTrainingSession {
  id: string;
  dayOfWeek: TrainingDayOfWeek;
  label: string;
  activityType: TrainingActivityType;
  timeOfDay: TrainingTimeOfDay | null;
  intensity: TrainingIntensity | null;
  notes: string | null;
  /** true = repeats every week (the original, only behavior this had).
      false = a one-off for the specific week named by weekOf — once that
      week is over it's filtered out wherever sessions are read (see
      lib/weekly-training.ts), not deleted. */
  recurring: boolean;
  /** Monday (ISO date) of the week a one-off session belongs to. Only
      meaningful when recurring is false; null for recurring sessions. */
  weekOf: string | null;
}

export interface WeeklyTrainingScheduleRecord {
  userId: string;
  sessions: WeeklyTrainingSession[];
  updatedAt: string;
}

export interface CycleLogEntryRecord {
  id: string;
  userId: string;
  eventType: CycleEventType;
  eventDate: string;
  note: string | null;
  createdAt: string;
}

export interface SignupAccountValues {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignupProfileValues {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender | "";
  primaryGoal: PrimaryGoal | "";
  sportPlayed: string;
  currentWeightKg: string;
  heightCm: string;
  additionalInfo: string;
  // In-case-of-emergency contact. Name + phone are asked for; the second
  // contact is fully optional.
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContact2Name: string;
  emergencyContact2Phone: string;
  // Dietary requirements — all optional at signup.
  dietaryPreference: DietaryPreference | "";
  allergies: string[];
  intolerancesOrMedical: string[];
  dietaryNotes: string;
  // Accent palette preset id (lib/palettes.ts) — always set; defaults to teal.
  palette: string;
  // Whole-app theme preset id — always set; defaults to midnight.
  theme: string;
}

export interface SignupCycleValues {
  cycleTrackingEnabled: boolean;
  menopauseSupportEnabled: boolean;
  lastPeriodStartDate: string;
  averageCycleLengthDays: string;
  periodLengthDays: string;
  regularity: CycleRegularity | "";
  privateNotes: string;
  shareCurrentPhaseWithCoach: boolean;
  shareExactDatesWithCoach: boolean;
  shareNotesWithCoach: boolean;
}

export interface SignupFormValues
  extends SignupAccountValues,
    SignupProfileValues,
    SignupCycleValues {}

export const DEFAULT_SIGNUP_VALUES: SignupFormValues = {
  email: "",
  password: "",
  confirmPassword: "",
  fullName: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  primaryGoal: "",
  sportPlayed: "",
  currentWeightKg: "",
  heightCm: "",
  additionalInfo: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContact2Name: "",
  emergencyContact2Phone: "",
  dietaryPreference: "",
  allergies: [],
  intolerancesOrMedical: [],
  dietaryNotes: "",
  palette: "teal",
  theme: "midnight",
  cycleTrackingEnabled: false,
  menopauseSupportEnabled: false,
  lastPeriodStartDate: "",
  averageCycleLengthDays: "",
  periodLengthDays: "",
  regularity: "",
  privateNotes: "",
  shareCurrentPhaseWithCoach: false,
  shareExactDatesWithCoach: false,
  shareNotesWithCoach: false,
};

export function isSportsPerformanceGoal(goal: PrimaryGoal | ""): boolean {
  return goal === "Sports Performance";
}

export function isFemaleGender(gender: Gender | ""): boolean {
  return gender === "Female";
}

export function shouldShowSportPlayed(
  values: Pick<SignupFormValues, "primaryGoal">
): boolean {
  return isSportsPerformanceGoal(values.primaryGoal);
}

export function shouldShowCycleTracking(
  values: Pick<SignupFormValues, "gender">
): boolean {
  return isFemaleGender(values.gender);
}

export function shouldShowCycleFields(
  values: Pick<SignupFormValues, "gender" | "cycleTrackingEnabled">
): boolean {
  return isFemaleGender(values.gender) && values.cycleTrackingEnabled;
}