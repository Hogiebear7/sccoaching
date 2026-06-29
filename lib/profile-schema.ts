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

export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileRecord {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  gender: Gender;
  primaryGoal: PrimaryGoal;
  sportPlayed: string | null;
  currentWeightKg: number | null;
  additionalInfo: string | null;
  cycleTrackingEligible: boolean;
  cycleTrackingEnabled: boolean;
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
  gender: Gender | "";
  primaryGoal: PrimaryGoal | "";
  sportPlayed: string;
  currentWeightKg: string;
  additionalInfo: string;
}

export interface SignupCycleValues {
  cycleTrackingEnabled: boolean;
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
  gender: "",
  primaryGoal: "",
  sportPlayed: "",
  currentWeightKg: "",
  additionalInfo: "",
  cycleTrackingEnabled: false,
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