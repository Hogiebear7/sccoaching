"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DEFAULT_SIGNUP_VALUES,
  shouldShowCycleFields,
  shouldShowCycleTracking,
  shouldShowSportPlayed,
  type SignupFormValues,
} from "@/lib/profile-schema";
import {
  ADDITIONAL_INFO_PLACEHOLDER,
  CYCLE_REGULARITY_OPTIONS,
  CYCLE_TRACKING_BENEFIT_COPY,
  GENDER_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
} from "@/lib/profile-options";
import { BRAND_NAME } from "@/lib/content";
import { PALETTE_OPTIONS, THEME_OPTIONS } from "@/lib/palettes";

type FormErrors = Partial<Record<keyof SignupFormValues, string>>;

const PASSWORD_REQUIREMENTS_HINT =
  "Must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

function getPasswordStrengthError(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }

  return null;
}

export default function SignupPage() {
  const router = useRouter();
  const [values, setValues] = useState<SignupFormValues>(DEFAULT_SIGNUP_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const sportVisible = shouldShowSportPlayed(values);
  const cycleEligible = shouldShowCycleTracking(values);
  const cycleFieldsVisible = shouldShowCycleFields(values);

  const stepTitles = useMemo(() => {
    const baseSteps = [
      "Account Setup",
      "Basic Profile",
      "Goals and Context",
    ];

    if (cycleEligible) {
      baseSteps.push("Cycle Tracking");
    }

    baseSteps.push("Review");
    return baseSteps;
  }, [cycleEligible]);

  const totalSteps = stepTitles.length;

  const isAccountStep = step === 0;
  const isBasicProfileStep = step === 1;
  const isGoalsStep = step === 2;
  const isCycleStep = cycleEligible && step === 3;
  const isReviewStep = cycleEligible ? step === 4 : step === 3;

  useEffect(() => {
    if (step > totalSteps - 1) {
      setStep(totalSteps - 1);
    }
  }, [step, totalSteps]);

  const reviewData = useMemo(
    () => ({
      account: {
        email: values.email,
      },
      profile: {
        fullName: values.fullName,
        phone: values.phone,
        dateOfBirth: values.dateOfBirth || "—",
        gender: values.gender || "—",
        primaryGoal: values.primaryGoal || "—",
        sportPlayed: sportVisible ? values.sportPlayed || "—" : "Not applicable",
        currentWeightKg: values.currentWeightKg || "—",
        additionalInfo: values.additionalInfo || "—",
      },
      cycle: cycleEligible
        ? {
            enabled: values.cycleTrackingEnabled ? "Yes" : "No",
            menopauseSupport: values.menopauseSupportEnabled ? "Yes" : "No",
            lastPeriodStartDate:
              cycleFieldsVisible && values.lastPeriodStartDate
                ? values.lastPeriodStartDate
                : "—",
            averageCycleLengthDays:
              cycleFieldsVisible && values.averageCycleLengthDays
                ? values.averageCycleLengthDays
                : "—",
            periodLengthDays:
              cycleFieldsVisible && values.periodLengthDays
                ? values.periodLengthDays
                : "—",
            regularity:
              cycleFieldsVisible && values.regularity ? values.regularity : "—",
            privateNotes:
              cycleFieldsVisible && values.privateNotes
                ? values.privateNotes
                : "—",
            shareCurrentPhaseWithCoach:
              cycleFieldsVisible && values.shareCurrentPhaseWithCoach ? "Yes" : "No",
            shareExactDatesWithCoach:
              cycleFieldsVisible && values.shareExactDatesWithCoach ? "Yes" : "No",
            shareNotesWithCoach:
              cycleFieldsVisible && values.shareNotesWithCoach ? "Yes" : "No",
          }
        : null,
    }),
    [values, sportVisible, cycleEligible, cycleFieldsVisible]
  );

  function updateField<K extends keyof SignupFormValues>(
    key: K,
    value: SignupFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleTextChange(
    key: keyof SignupFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    updateField(key, e.target.value as SignupFormValues[typeof key]);
  }

  function handleCheckboxChange(key: keyof SignupFormValues, checked: boolean) {
    updateField(key, checked as SignupFormValues[typeof key]);
  }

  function validateStep(currentStep: number) {
    const nextErrors: FormErrors = {};

    if (currentStep === 0) {
      if (!values.email.trim()) nextErrors.email = "Email is required.";

      if (!values.password.trim()) {
        nextErrors.password = "Password is required.";
      } else {
        const passwordError = getPasswordStrengthError(values.password);
        if (passwordError) nextErrors.password = passwordError;
      }

      if (!values.confirmPassword.trim()) {
        nextErrors.confirmPassword = "Please confirm your password.";
      } else if (values.password !== values.confirmPassword) {
        nextErrors.confirmPassword = "Passwords do not match.";
      }
    }

    if (currentStep === 1) {
      if (!values.fullName.trim()) nextErrors.fullName = "Full name is required.";
      if (!values.phone.trim()) nextErrors.phone = "Phone number is required.";

      const dob = values.dateOfBirth.trim();
      const todayISO = new Date().toISOString().slice(0, 10);
      if (!dob) {
        nextErrors.dateOfBirth = "Date of birth is required.";
      } else if (Number.isNaN(new Date(dob).getTime()) || dob >= todayISO) {
        nextErrors.dateOfBirth = "Enter a valid date in the past.";
      }

      if (!values.gender) nextErrors.gender = "Please select a gender.";
    }

    if (currentStep === 2) {
      if (!values.primaryGoal) {
        nextErrors.primaryGoal = "Please select a primary goal.";
      }
      if (sportVisible && !values.sportPlayed.trim()) {
        nextErrors.sportPlayed = "Please enter the sport played.";
      }
    }

    if (cycleEligible && currentStep === 3 && values.cycleTrackingEnabled) {
      if (!values.lastPeriodStartDate.trim()) {
        nextErrors.lastPeriodStartDate = "Please enter the last period start date.";
      }
      if (!values.averageCycleLengthDays.trim()) {
        nextErrors.averageCycleLengthDays =
          "Please enter the average cycle length.";
      }
      if (!values.periodLengthDays.trim()) {
        nextErrors.periodLengthDays = "Please enter the period length.";
      }
      if (!values.regularity) {
        nextErrors.regularity = "Please select cycle regularity.";
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setStep((prev) => Math.min(prev + 1, totalSteps - 1));
  }

  function goBack() {
    setStep((prev) => Math.max(prev - 1, 0));
  }

  async function handleSubmit() {
    if (!validateStep(step)) return;

    setFormError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Signup failed. Please try again.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen px-4 py-10 text-zinc-100 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-80 before:bg-[radial-gradient(70%_100%_at_50%_0%,rgba(45,212,191,0.06),transparent)]">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            {/* Long brand name in a 280px column — tighter tracking keeps it on one line */}
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
              {BRAND_NAME}
            </p>
            <h1 className="text-display mt-3 text-[30px]">Create your account</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Set up your profile, goals, and optional cycle tracking preferences.
            </p>

            <div className="mt-6 space-y-3">
              {stepTitles.map((title, index) => {
                const active = index === step;
                const complete = index < step;

                return (
                  <div
                    key={title}
                    aria-current={active ? "step" : undefined}
                    className={`rounded-[10px] border px-4 py-3 transition ${
                      active
                        ? "border-primary bg-primary/10"
                        : complete
                        ? "border-zinc-700 bg-zinc-900"
                        : "border-zinc-800 bg-zinc-950"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : complete
                            ? "bg-zinc-200 text-black"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{title}</p>
                        <p className="text-xs text-zinc-500">
                          Step {index + 1} of {totalSteps}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 border-t border-zinc-800 pt-4">
              <Link
                href="/login"
                className="text-sm text-zinc-400 transition hover:text-zinc-200"
              >
                Already have an account?
              </Link>
            </div>
          </aside>

          <section className="panel-raised anim-rise p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                    Step {step + 1}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    {stepTitles[step]}
                  </h2>
                </div>
                <div className="text-sm text-zinc-500">
                  {step + 1} / {totalSteps}
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-[3px] bg-zinc-800">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
                />
              </div>

              {isAccountStep && (
                <fieldset className="space-y-4">
                  <legend className="mb-2 text-lg font-semibold text-zinc-50">
                    Account details
                  </legend>

                  <FormField label="Email" id="signup-email" error={errors.email}>
                    <input
                      id="signup-email"
                      type="email"
                      value={values.email}
                      onChange={(e) => handleTextChange("email", e)}
                      className={inputClass(errors.email)}
                      placeholder="you@example.com"
                    />
                  </FormField>

                  <FormField
                    label="Password"
                    id="signup-password"
                    hint={PASSWORD_REQUIREMENTS_HINT}
                    error={errors.password}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        disabled={!mounted}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    }
                  >
                    <input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      value={values.password}
                      onChange={(e) => handleTextChange("password", e)}
                      className={`${inputClass(errors.password)} pr-16`}
                      placeholder="Create a password"
                    />
                  </FormField>

                  <FormField
                    label="Confirm password"
                    id="signup-confirm-password"
                    error={errors.confirmPassword}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        disabled={!mounted}
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirm password"
                            : "Show confirm password"
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {showConfirmPassword ? "Hide" : "Show"}
                      </button>
                    }
                  >
                    <input
                      id="signup-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={values.confirmPassword}
                      onChange={(e) => handleTextChange("confirmPassword", e)}
                      className={`${inputClass(errors.confirmPassword)} pr-16`}
                      placeholder="Re-enter your password"
                    />
                  </FormField>
                </fieldset>
              )}

              {isBasicProfileStep && (
                <fieldset className="space-y-4">
                  <legend className="mb-2 text-lg font-semibold text-zinc-50">
                    Basic profile
                  </legend>

                  <FormField label="Full name" id="signup-full-name" error={errors.fullName}>
                    <input
                      id="signup-full-name"
                      type="text"
                      value={values.fullName}
                      onChange={(e) => handleTextChange("fullName", e)}
                      className={inputClass(errors.fullName)}
                      placeholder="Your full name"
                    />
                  </FormField>

                  <FormField label="Phone" id="signup-phone" error={errors.phone}>
                    <input
                      id="signup-phone"
                      type="tel"
                      value={values.phone}
                      onChange={(e) => handleTextChange("phone", e)}
                      className={inputClass(errors.phone)}
                      placeholder="+353 83 123 4567"
                    />
                  </FormField>

                  <FormField
                    label="Date of birth"
                    id="signup-dob"
                    error={errors.dateOfBirth}
                  >
                    <input
                      id="signup-dob"
                      type="date"
                      required
                      aria-required="true"
                      value={values.dateOfBirth}
                      onChange={(e) => handleTextChange("dateOfBirth", e)}
                      max={new Date().toISOString().slice(0, 10)}
                      className={inputClass(errors.dateOfBirth)}
                    />
                  </FormField>

                  <FormField label="Gender" id="signup-gender" error={errors.gender}>
                    <select
                      id="signup-gender"
                      required
                      aria-required="true"
                      value={values.gender}
                      onChange={(e) => handleTextChange("gender", e)}
                      className={inputClass(errors.gender)}
                    >
                      <option value="">Select gender</option>
                      {GENDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </fieldset>
              )}

              {isGoalsStep && (
                <fieldset className="space-y-4">
                  <legend className="mb-2 text-lg font-semibold text-zinc-50">
                    Goals and context
                  </legend>

                  <FormField label="Primary goal" id="signup-primary-goal" error={errors.primaryGoal}>
                    <select
                      id="signup-primary-goal"
                      required
                      aria-required="true"
                      value={values.primaryGoal}
                      onChange={(e) => handleTextChange("primaryGoal", e)}
                      className={inputClass(errors.primaryGoal)}
                    >
                      <option value="">Select a goal</option>
                      {PRIMARY_GOAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {sportVisible && (
                    <FormField label="Sport played" id="signup-sport-played" error={errors.sportPlayed}>
                      <input
                        id="signup-sport-played"
                        type="text"
                        value={values.sportPlayed}
                        onChange={(e) => handleTextChange("sportPlayed", e)}
                        className={inputClass(errors.sportPlayed)}
                        placeholder="e.g. Cricket, Football, Tennis"
                      />
                    </FormField>
                  )}

                  <FormField
                    label={
                      <>
                        Current weight (kg){" "}
                        <span className="text-xs font-normal text-zinc-500">
                          optional
                        </span>
                      </>
                    }
                    id="signup-weight"
                    error={errors.currentWeightKg}
                  >
                    <input
                      id="signup-weight"
                      type="number"
                      inputMode="decimal"
                      value={values.currentWeightKg}
                      onChange={(e) => handleTextChange("currentWeightKg", e)}
                      className={inputClass(errors.currentWeightKg)}
                      placeholder="e.g. 72"
                    />
                  </FormField>

                  <FormField
                    label="Additional information"
                    id="signup-additional-info"
                    error={errors.additionalInfo}
                  >
                    <textarea
                      id="signup-additional-info"
                      value={values.additionalInfo}
                      onChange={(e) => handleTextChange("additionalInfo", e)}
                      className={`${inputClass(errors.additionalInfo)} min-h-[120px] resize-y`}
                      placeholder={ADDITIONAL_INFO_PLACEHOLDER}
                    />
                  </FormField>

                  <div>
                    <p className="mb-1 text-sm font-medium text-zinc-200">App theme</p>
                    <p className="mb-3 text-xs text-zinc-500">
                      The overall background tint of your app. You can change it any time in
                      Settings.
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="App theme"
                      className="flex flex-wrap gap-2"
                    >
                      {THEME_OPTIONS.map((option) => {
                        const selected = values.theme === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() =>
                              setValues((prev) => ({ ...prev, theme: option.id }))
                            }
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              selected
                                ? "border-white/40 bg-white/[0.08] text-zinc-50"
                                : "border-white/[0.12] text-zinc-400 hover:border-white/30 hover:text-zinc-200"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="h-3.5 w-3.5 rounded-full ring-1 ring-white/25"
                              style={{ backgroundColor: option.swatch }}
                            />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-medium text-zinc-200">Accent colour</p>
                    <p className="mb-3 text-xs text-zinc-500">
                      Sets the colour of buttons and highlights in your app. You can change it
                      any time in Settings.
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="Accent colour palette"
                      className="flex flex-wrap gap-2"
                    >
                      {PALETTE_OPTIONS.map((option) => {
                        const selected = values.palette === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() =>
                              setValues((prev) => ({ ...prev, palette: option.id }))
                            }
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              selected
                                ? "border-white/40 bg-white/[0.08] text-zinc-50"
                                : "border-white/[0.12] text-zinc-400 hover:border-white/30 hover:text-zinc-200"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="h-3.5 w-3.5 rounded-full ring-1 ring-white/25"
                              style={{ backgroundColor: option.swatch }}
                            />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </fieldset>
              )}

              {isCycleStep && (
                <fieldset className="space-y-4">
                  <legend className="mb-2 text-lg font-semibold text-zinc-50">
                    Female health options
                  </legend>

                  <p className="text-sm text-zinc-400">
                    Both options below are independent — you can enable either, both, or neither.
                    You might want cycle tracking now, menopause support for relevant context,
                    or both, depending on where you are in your training journey.
                    All information is private to you unless you choose to share it.
                  </p>

                  <label className="flex items-start gap-3 rounded-[10px] border border-zinc-800 bg-zinc-950 p-4">
                    <input
                      type="checkbox"
                      checked={values.cycleTrackingEnabled}
                      onChange={(e) =>
                        handleCheckboxChange(
                          "cycleTrackingEnabled",
                          e.target.checked
                        )
                      }
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-100">
                        Enable cycle tracking
                      </span>
                      <span className="mt-1 block text-sm text-zinc-400">
                        {CYCLE_TRACKING_BENEFIT_COPY}
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-[10px] border border-zinc-800 bg-zinc-950 p-4">
                    <input
                      type="checkbox"
                      checked={values.menopauseSupportEnabled}
                      onChange={(e) =>
                        handleCheckboxChange("menopauseSupportEnabled", e.target.checked)
                      }
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-100">
                        Receive menopause support information
                      </span>
                      <span className="mt-1 block text-sm text-zinc-400">
                        Educational content on strength training, nutrition, and recovery
                        relevant to perimenopause and post-menopause. Visible only to you.
                      </span>
                    </span>
                  </label>

                  {cycleFieldsVisible && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        label="Last period start date"
                        id="signup-last-period"
                        error={errors.lastPeriodStartDate}
                      >
                        <input
                          id="signup-last-period"
                          type="date"
                          value={values.lastPeriodStartDate}
                          onChange={(e) =>
                            handleTextChange("lastPeriodStartDate", e)
                          }
                          className={inputClass(errors.lastPeriodStartDate)}
                        />
                      </FormField>

                      <FormField
                        label="Average cycle length (days)"
                        id="signup-avg-cycle-length"
                        error={errors.averageCycleLengthDays}
                      >
                        <input
                          id="signup-avg-cycle-length"
                          type="number"
                          value={values.averageCycleLengthDays}
                          onChange={(e) =>
                            handleTextChange("averageCycleLengthDays", e)
                          }
                          className={inputClass(
                            errors.averageCycleLengthDays
                          )}
                          placeholder="e.g. 28"
                        />
                      </FormField>

                      <FormField
                        label="Period length (days)"
                        id="signup-period-length"
                        error={errors.periodLengthDays}
                      >
                        <input
                          id="signup-period-length"
                          type="number"
                          value={values.periodLengthDays}
                          onChange={(e) =>
                            handleTextChange("periodLengthDays", e)
                          }
                          className={inputClass(errors.periodLengthDays)}
                          placeholder="e.g. 5"
                        />
                      </FormField>

                      <FormField label="Regularity" id="signup-regularity" error={errors.regularity}>
                        <select
                          id="signup-regularity"
                          value={values.regularity}
                          onChange={(e) => handleTextChange("regularity", e)}
                          className={inputClass(errors.regularity)}
                        >
                          <option value="">Select regularity</option>
                          {CYCLE_REGULARITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <div className="md:col-span-2">
                        <FormField
                          label="Private notes"
                          id="signup-private-notes"
                          error={errors.privateNotes}
                        >
                          <textarea
                            id="signup-private-notes"
                            value={values.privateNotes}
                            onChange={(e) =>
                              handleTextChange("privateNotes", e)
                            }
                            className={`${inputClass(
                              errors.privateNotes
                            )} min-h-[110px] resize-y`}
                            placeholder="Symptoms, preferences, or other private notes"
                          />
                        </FormField>
                      </div>

                      <div className="md:col-span-2 rounded-[10px] border border-zinc-800 bg-zinc-950 p-4">
                        <p className="mb-3 text-sm font-medium text-zinc-100">
                          Coach sharing preferences
                        </p>
                        <div className="space-y-3">
                          <CheckboxRow
                            label="Share current phase with coach"
                            checked={values.shareCurrentPhaseWithCoach}
                            onChange={(checked) =>
                              handleCheckboxChange(
                                "shareCurrentPhaseWithCoach",
                                checked
                              )
                            }
                          />
                          <CheckboxRow
                            label="Share exact dates with coach"
                            checked={values.shareExactDatesWithCoach}
                            onChange={(checked) =>
                              handleCheckboxChange(
                                "shareExactDatesWithCoach",
                                checked
                              )
                            }
                          />
                          <CheckboxRow
                            label="Share notes with coach"
                            checked={values.shareNotesWithCoach}
                            onChange={(checked) =>
                              handleCheckboxChange(
                                "shareNotesWithCoach",
                                checked
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </fieldset>
              )}

              {isReviewStep && (
                <section className="space-y-5">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-50">Review</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Check the data before creating the account.
                    </p>
                  </div>

                  {formError ? (
                    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                      {formError}
                    </p>
                  ) : null}

                  <ReviewCard title="Account">
                    <ReviewRow label="Email" value={reviewData.account.email || "—"} />
                  </ReviewCard>

                  <ReviewCard title="Profile">
                    <ReviewRow
                      label="Full name"
                      value={reviewData.profile.fullName || "—"}
                    />
                    <ReviewRow label="Phone" value={reviewData.profile.phone || "—"} />
                    <ReviewRow label="Date of birth" value={reviewData.profile.dateOfBirth} />
                    <ReviewRow label="Gender" value={reviewData.profile.gender} />
                    <ReviewRow
                      label="Primary goal"
                      value={reviewData.profile.primaryGoal}
                    />
                    <ReviewRow
                      label="Sport played"
                      value={reviewData.profile.sportPlayed}
                    />
                    <ReviewRow
                      label="Current weight"
                      value={reviewData.profile.currentWeightKg}
                    />
                    <ReviewRow
                      label="Additional info"
                      value={reviewData.profile.additionalInfo}
                    />
                  </ReviewCard>

                  {reviewData.cycle ? (
                    <ReviewCard title="Female health options">
                      <ReviewRow label="Cycle tracking" value={reviewData.cycle.enabled} />
                      <ReviewRow label="Menopause support" value={reviewData.cycle.menopauseSupport} />
                      <ReviewRow
                        label="Last period start"
                        value={reviewData.cycle.lastPeriodStartDate}
                      />
                      <ReviewRow
                        label="Average cycle length"
                        value={reviewData.cycle.averageCycleLengthDays}
                      />
                      <ReviewRow
                        label="Period length"
                        value={reviewData.cycle.periodLengthDays}
                      />
                      <ReviewRow
                        label="Regularity"
                        value={reviewData.cycle.regularity}
                      />
                      <ReviewRow
                        label="Private notes"
                        value={reviewData.cycle.privateNotes}
                      />
                      <ReviewRow
                        label="Share current phase"
                        value={reviewData.cycle.shareCurrentPhaseWithCoach}
                      />
                      <ReviewRow
                        label="Share exact dates"
                        value={reviewData.cycle.shareExactDatesWithCoach}
                      />
                      <ReviewRow
                        label="Share notes"
                        value={reviewData.cycle.shareNotesWithCoach}
                      />
                    </ReviewCard>
                  ) : null}
                </section>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={!mounted || step === 0}
                  className="rounded-lg border border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Back
                </button>

                <div className="flex gap-3">
                  {step < totalSteps - 1 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={!mounted}
                      className="btn-primary px-5 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!mounted || isSubmitting}
                      className="btn-primary px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Creating account…" : "Create account"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function FormField({
  label,
  id,
  hint,
  error,
  trailing,
  children,
}: {
  label: ReactNode;
  id: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-zinc-200">
        {label}
      </label>
      {hint ? (
        <p className="mb-2 text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
      {trailing ? (
        <div className="relative">
          {children}
          {trailing}
        </div>
      ) : (
        children
      )}
      {error ? (
        <p className="mt-1 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function ReviewCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-zinc-800 bg-zinc-950 p-4">
      <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {title}
      </h4>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)]">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="break-words text-sm text-zinc-100">{value}</span>
    </div>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-lg border bg-[--input] px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}