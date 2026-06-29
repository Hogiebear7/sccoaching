import type { CycleRegularity, Gender, PrimaryGoal } from "./profile-schema";

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