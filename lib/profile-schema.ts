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

export type CycleEventType = "period_start" | "period_end" | "symptom" | "note";

export type UserRole = "member" | "staff";

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
  additionalInfo: string | null;
  cycleTrackingEligible: boolean;
  cycleTrackingEnabled: boolean;
  menopauseSupportEnabled: boolean;
  reminderTimingsMins: number[] | null;
  emailNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  // Optional so records created before this field existed stay valid;
  // readers should treat null/undefined as "metric" (see db.ts normalization).
  preferredUnits?: MeasurementUnits;
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
  onboardingCompleted: boolean;
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
  additionalInfo: string;
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
  additionalInfo: "",
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