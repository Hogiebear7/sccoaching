"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
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
import { PALETTE_OPTIONS, THEME_OPTIONS } from "@/lib/palettes";
import { useHydrated } from "@/lib/use-hydrated";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  AuthField,
  BUTTON_SECONDARY,
  CheckboxField,
  fieldA11y,
  FormMessage,
  inputClass,
  PasswordToggle,
  SubmitButton,
} from "@/components/auth/fields";
import { DietaryRequirementsFields } from "@/components/profile/DietaryRequirementsFields";

type FormErrors = Partial<Record<keyof SignupFormValues, string>>;

const PASSWORD_REQUIREMENTS_HINT =
  "Must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const mounted = useHydrated();
  const [emailStatus, setEmailStatus] = useState<"idle" | "checking" | "available" | "taken">(() =>
    EMAIL_RE.test(DEFAULT_SIGNUP_VALUES.email.trim()) ? "checking" : "idle",
  );

  // Reset the availability status as soon as the email changes (during
  // render, React's "adjust state when a value changes" pattern) — "checking"
  // for a well-formed address, "idle" otherwise. The effect below then only
  // updates it from the async result.
  const trimmedEmail = values.email.trim();
  const [statusForEmail, setStatusForEmail] = useState(trimmedEmail);
  if (statusForEmail !== trimmedEmail) {
    setStatusForEmail(trimmedEmail);
    setEmailStatus(EMAIL_RE.test(trimmedEmail) ? "checking" : "idle");
  }

  // Debounced live availability check — lets someone know their email is
  // already registered before they fill out the whole form, instead of
  // finding out only when the final submit fails.
  useEffect(() => {
    const email = values.email.trim();
    if (!EMAIL_RE.test(email)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/auth/check-email?email=${encodeURIComponent(email)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { available?: boolean }) => {
          setEmailStatus(data.available === false ? "taken" : "available");
        })
        .catch(() => {
          if (!controller.signal.aborted) setEmailStatus("idle");
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [values.email]);

  const sportVisible = shouldShowSportPlayed(values);
  const cycleEligible = shouldShowCycleTracking(values);
  const cycleFieldsVisible = shouldShowCycleFields(values);

  const stepTitles = useMemo(() => {
    const baseSteps = [
      "Account setup",
      "Basic profile",
      "Goals and context",
    ];

    if (cycleEligible) {
      baseSteps.push("Female health options");
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

  // Clamp the step during render when the cycle-tracking step disappears
  // (React's "adjust state when a value changes" pattern, not an effect).
  if (step > totalSteps - 1) {
    setStep(totalSteps - 1);
  }

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
        heightCm: values.heightCm || "—",
        additionalInfo: values.additionalInfo || "—",
        emergencyContactName: values.emergencyContactName || "—",
        emergencyContactPhone: values.emergencyContactPhone || "—",
        emergencyContact2: values.emergencyContact2Name.trim()
          ? `${values.emergencyContact2Name} — ${values.emergencyContact2Phone || "—"}`
          : "—",
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
      if (!values.email.trim()) {
        nextErrors.email = "Email is required.";
      } else if (!EMAIL_RE.test(values.email.trim())) {
        nextErrors.email = "Enter a valid email address.";
      } else if (emailStatus === "taken") {
        nextErrors.email = "This email already has an account.";
      }

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

      if (!values.emergencyContactName.trim()) {
        nextErrors.emergencyContactName = "Emergency contact name is required.";
      }
      if (!values.emergencyContactPhone.trim()) {
        nextErrors.emergencyContactPhone = "Emergency contact phone number is required.";
      }
      if (values.emergencyContact2Name.trim() && !values.emergencyContact2Phone.trim()) {
        nextErrors.emergencyContact2Phone = "Enter a phone number for the second contact, or clear their name.";
      }
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
    const valid = Object.keys(nextErrors).length === 0;
    // Move focus to the first field that needs attention once it renders.
    if (!valid) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
    return valid;
  }

  // Each new step announces itself: focus moves to its heading (not on the
  // first render, so the page doesn't jump on load).
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < totalSteps - 1) goNext();
    else void handleSubmit();
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

    if (!agreedToTerms || !agreedToPrivacy) {
      setFormError("Please agree to the Terms and Conditions and Privacy Policy to continue.");
      return;
    }

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


  const emailTaken = emailStatus === "taken";

  return (
    <AuthShell
      wide
      label="Create account"
      title="Join S&C."
      intro="Set up your profile so your coach can plan around you. It takes a few minutes, and you can change anything later."
      footer={
        <p className="text-sm text-zinc-400">
          Already a member?{" "}
          <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleFormSubmit} noValidate className="grid gap-8">
        {/* Progress: one segment per step. */}
        <div>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <p className="font-semibold text-zinc-200">
              Step {step + 1} of {totalSteps}
            </p>
            {step < totalSteps - 1 ? <p className="text-zinc-400">Next: {stepTitles[step + 1]}</p> : null}
          </div>
          <ol aria-label="Signup progress" className="mt-3 flex gap-1.5">
            {stepTitles.map((title, index) => (
              <li key={title} aria-current={index === step ? "step" : undefined} className="flex-1">
                <span
                  aria-hidden
                  className={`block h-1 rounded-full transition-colors duration-300 ${index <= step ? "bg-primary" : "bg-white/[0.12]"}`}
                />
                <span className="sr-only">
                  {title}
                  {index < step ? " (done)" : index === step ? " (current)" : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* key={step} remounts this block on every step change, so the
            anim-rise entrance replays and the wizard visibly advances. */}
        <section key={step} aria-labelledby="signup-step-title" className="anim-rise grid gap-6">
          <h2 id="signup-step-title" ref={stepHeadingRef} tabIndex={-1} className="text-headline text-[34px] text-zinc-50 outline-none!">
            {stepTitles[step]}
          </h2>

          {isAccountStep && (
            <>
              <AuthField label="Email" id="signup-email" error={emailTaken ? undefined : errors.email}>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.email}
                  onChange={(e) => handleTextChange("email", e)}
                  aria-invalid={errors.email || emailTaken ? true : undefined}
                  aria-describedby={emailTaken ? "signup-email-taken" : errors.email ? "signup-email-error" : undefined}
                  className={inputClass(Boolean(errors.email) || emailTaken)}
                  placeholder="you@example.com"
                />
              </AuthField>

              {emailTaken ? (
                <div id="signup-email-taken">
                  <FormMessage tone="warning">
                    <p>This email already has an account.</p>
                    <p className="mt-1 flex flex-wrap gap-x-5">
                      <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-amber-50 underline underline-offset-2">
                        Sign in instead
                      </Link>
                      <Link href="/forgot-password" className="inline-flex min-h-11 items-center font-semibold text-amber-50 underline underline-offset-2">
                        Reset your password
                      </Link>
                    </p>
                    <p className="text-amber-100/80">Or use a different email to create a new account.</p>
                  </FormMessage>
                </div>
              ) : null}

              <AuthField label="Password" id="signup-password" hint={PASSWORD_REQUIREMENTS_HINT} error={errors.password}>
                <div className="relative">
                  <input
                    id="signup-password"
                    name="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={values.password}
                    onChange={(e) => handleTextChange("password", e)}
                    {...fieldA11y("signup-password", errors.password, true)}
                    className={`${inputClass(Boolean(errors.password))} pr-14`}
                  />
                  <PasswordToggle
                    controls="signup-password"
                    shown={showPassword}
                    onToggle={() => setShowPassword((prev) => !prev)}
                    disabled={!mounted}
                  />
                </div>
              </AuthField>

              <AuthField label="Confirm password" id="signup-confirm-password" error={errors.confirmPassword}>
                <div className="relative">
                  <input
                    id="signup-confirm-password"
                    name="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={values.confirmPassword}
                    onChange={(e) => handleTextChange("confirmPassword", e)}
                    {...fieldA11y("signup-confirm-password", errors.confirmPassword)}
                    className={`${inputClass(Boolean(errors.confirmPassword))} pr-14`}
                  />
                  <PasswordToggle
                    controls="signup-confirm-password"
                    shown={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((prev) => !prev)}
                    disabled={!mounted}
                    label="Show confirmed password"
                  />
                </div>
              </AuthField>
            </>
          )}

          {isBasicProfileStep && (
            <>
              <AuthField label="Full name" id="signup-full-name" error={errors.fullName}>
                <input
                  id="signup-full-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={values.fullName}
                  onChange={(e) => handleTextChange("fullName", e)}
                  {...fieldA11y("signup-full-name", errors.fullName)}
                  className={inputClass(Boolean(errors.fullName))}
                />
              </AuthField>

              <AuthField label="Phone" id="signup-phone" error={errors.phone}>
                <input
                  id="signup-phone"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  value={values.phone}
                  onChange={(e) => handleTextChange("phone", e)}
                  {...fieldA11y("signup-phone", errors.phone)}
                  className={inputClass(Boolean(errors.phone))}
                  placeholder="+353 83 123 4567"
                />
              </AuthField>

              <div className="grid gap-6 sm:grid-cols-2">
                <AuthField label="Date of birth" id="signup-dob" error={errors.dateOfBirth}>
                  <input
                    id="signup-dob"
                    name="bday"
                    type="date"
                    autoComplete="bday"
                    required
                    aria-required="true"
                    value={values.dateOfBirth}
                    onChange={(e) => handleTextChange("dateOfBirth", e)}
                    max={new Date().toISOString().slice(0, 10)}
                    {...fieldA11y("signup-dob", errors.dateOfBirth)}
                    className={inputClass(Boolean(errors.dateOfBirth))}
                  />
                </AuthField>

                <AuthField label="Gender" id="signup-gender" error={errors.gender}>
                  <select
                    id="signup-gender"
                    required
                    aria-required="true"
                    value={values.gender}
                    onChange={(e) => handleTextChange("gender", e)}
                    {...fieldA11y("signup-gender", errors.gender)}
                    className={inputClass(Boolean(errors.gender))}
                  >
                    <option value="">Select gender</option>
                    {GENDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </AuthField>
              </div>

              <div className="border-t border-white/[0.08] pt-6">
                <h3 className="text-headline text-[24px] text-zinc-50">In case of emergency</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                  Who should we contact if something happens to you during a session?
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <AuthField label="Emergency contact name" id="signup-ice-name" error={errors.emergencyContactName}>
                  <input
                    id="signup-ice-name"
                    type="text"
                    value={values.emergencyContactName}
                    onChange={(e) => handleTextChange("emergencyContactName", e)}
                    {...fieldA11y("signup-ice-name", errors.emergencyContactName)}
                    className={inputClass(Boolean(errors.emergencyContactName))}
                  />
                </AuthField>

                <AuthField label="Emergency contact phone" id="signup-ice-phone" error={errors.emergencyContactPhone}>
                  <input
                    id="signup-ice-phone"
                    type="tel"
                    value={values.emergencyContactPhone}
                    onChange={(e) => handleTextChange("emergencyContactPhone", e)}
                    {...fieldA11y("signup-ice-phone", errors.emergencyContactPhone)}
                    className={inputClass(Boolean(errors.emergencyContactPhone))}
                    placeholder="+353 83 123 4567"
                  />
                </AuthField>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <AuthField label="Second contact name" id="signup-ice2-name" optional error={errors.emergencyContact2Name}>
                  <input
                    id="signup-ice2-name"
                    type="text"
                    value={values.emergencyContact2Name}
                    onChange={(e) => handleTextChange("emergencyContact2Name", e)}
                    {...fieldA11y("signup-ice2-name", errors.emergencyContact2Name)}
                    className={inputClass(Boolean(errors.emergencyContact2Name))}
                  />
                </AuthField>

                {values.emergencyContact2Name.trim() ? (
                  <AuthField label="Second contact phone" id="signup-ice2-phone" error={errors.emergencyContact2Phone}>
                    <input
                      id="signup-ice2-phone"
                      type="tel"
                      value={values.emergencyContact2Phone}
                      onChange={(e) => handleTextChange("emergencyContact2Phone", e)}
                      {...fieldA11y("signup-ice2-phone", errors.emergencyContact2Phone)}
                      className={inputClass(Boolean(errors.emergencyContact2Phone))}
                      placeholder="+353 83 123 4567"
                    />
                  </AuthField>
                ) : null}
              </div>
            </>
          )}

          {isGoalsStep && (
            <>
              <AuthField label="Primary goal" id="signup-primary-goal" error={errors.primaryGoal}>
                <select
                  id="signup-primary-goal"
                  required
                  aria-required="true"
                  value={values.primaryGoal}
                  onChange={(e) => handleTextChange("primaryGoal", e)}
                  {...fieldA11y("signup-primary-goal", errors.primaryGoal)}
                  className={inputClass(Boolean(errors.primaryGoal))}
                >
                  <option value="">Select a goal</option>
                  {PRIMARY_GOAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AuthField>

              {sportVisible && (
                <AuthField label="Sport played" id="signup-sport-played" error={errors.sportPlayed}>
                  <input
                    id="signup-sport-played"
                    type="text"
                    value={values.sportPlayed}
                    onChange={(e) => handleTextChange("sportPlayed", e)}
                    {...fieldA11y("signup-sport-played", errors.sportPlayed)}
                    className={inputClass(Boolean(errors.sportPlayed))}
                    placeholder="e.g. Cricket, Football, Tennis"
                  />
                </AuthField>
              )}

              <div className="grid gap-6 sm:grid-cols-2">
                <AuthField label="Current weight (kg)" id="signup-weight" optional error={errors.currentWeightKg}>
                  <input
                    id="signup-weight"
                    type="number"
                    inputMode="decimal"
                    value={values.currentWeightKg}
                    onChange={(e) => handleTextChange("currentWeightKg", e)}
                    {...fieldA11y("signup-weight", errors.currentWeightKg)}
                    className={inputClass(Boolean(errors.currentWeightKg))}
                    placeholder="e.g. 72"
                  />
                </AuthField>

                <AuthField label="Height (cm)" id="signup-height" optional error={errors.heightCm}>
                  <input
                    id="signup-height"
                    type="number"
                    inputMode="decimal"
                    value={values.heightCm}
                    onChange={(e) => handleTextChange("heightCm", e)}
                    {...fieldA11y("signup-height", errors.heightCm)}
                    className={inputClass(Boolean(errors.heightCm))}
                    placeholder="e.g. 178"
                  />
                </AuthField>
              </div>

              <AuthField label="Additional information" id="signup-additional-info" optional error={errors.additionalInfo}>
                <textarea
                  id="signup-additional-info"
                  value={values.additionalInfo}
                  onChange={(e) => handleTextChange("additionalInfo", e)}
                  {...fieldA11y("signup-additional-info", errors.additionalInfo)}
                  className={inputClass(Boolean(errors.additionalInfo), true)}
                  placeholder={ADDITIONAL_INFO_PLACEHOLDER}
                />
              </AuthField>

              <div className="rounded-[3px] border border-white/[0.1] bg-[var(--surface-1)] p-5">
                <h3 className="text-headline text-[24px] text-zinc-50">Dietary requirements</h3>
                <p className="mb-4 mt-1 text-sm leading-relaxed text-zinc-400">
                  Optional. Powers your nutrition suggestions, and you can change these any time.
                </p>
                <DietaryRequirementsFields
                  idPrefix="signup-diet"
                  values={{
                    dietaryPreference: values.dietaryPreference,
                    allergies: values.allergies,
                    intolerancesOrMedical: values.intolerancesOrMedical,
                    dietaryNotes: values.dietaryNotes,
                  }}
                  onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
                />
              </div>

              <ChoiceGroup
                label="App theme"
                description="The background tint of your app. You can change it any time in Settings."
                options={THEME_OPTIONS}
                value={values.theme}
                onChange={(id) => setValues((prev) => ({ ...prev, theme: id }))}
              />

              <ChoiceGroup
                label="Accent colour"
                description="The colour of buttons and highlights in your app. You can change it any time in Settings."
                options={PALETTE_OPTIONS}
                value={values.palette}
                onChange={(id) => setValues((prev) => ({ ...prev, palette: id }))}
              />
            </>
          )}

          {isCycleStep && (
            <>
              <p className="text-base leading-relaxed text-zinc-300">
                Both options are independent: enable either, both or neither. Everything here is private to you unless you
                choose to share it.
              </p>

              <CheckboxField
                boxed
                checked={values.cycleTrackingEnabled}
                onChange={(checked) => handleCheckboxChange("cycleTrackingEnabled", checked)}
                label="Enable cycle tracking"
                description={CYCLE_TRACKING_BENEFIT_COPY}
              />

              <CheckboxField
                boxed
                checked={values.menopauseSupportEnabled}
                onChange={(checked) => handleCheckboxChange("menopauseSupportEnabled", checked)}
                label="Receive menopause support information"
                description="Educational content on strength training, nutrition and recovery relevant to perimenopause and post-menopause. Visible only to you."
              />

              {cycleFieldsVisible && (
                <>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <AuthField label="Last period start date" id="signup-last-period" error={errors.lastPeriodStartDate}>
                      <input
                        id="signup-last-period"
                        type="date"
                        value={values.lastPeriodStartDate}
                        onChange={(e) => handleTextChange("lastPeriodStartDate", e)}
                        {...fieldA11y("signup-last-period", errors.lastPeriodStartDate)}
                        className={inputClass(Boolean(errors.lastPeriodStartDate))}
                      />
                    </AuthField>

                    <AuthField label="Average cycle length (days)" id="signup-avg-cycle-length" error={errors.averageCycleLengthDays}>
                      <input
                        id="signup-avg-cycle-length"
                        type="number"
                        inputMode="numeric"
                        value={values.averageCycleLengthDays}
                        onChange={(e) => handleTextChange("averageCycleLengthDays", e)}
                        {...fieldA11y("signup-avg-cycle-length", errors.averageCycleLengthDays)}
                        className={inputClass(Boolean(errors.averageCycleLengthDays))}
                        placeholder="e.g. 28"
                      />
                    </AuthField>

                    <AuthField label="Period length (days)" id="signup-period-length" error={errors.periodLengthDays}>
                      <input
                        id="signup-period-length"
                        type="number"
                        inputMode="numeric"
                        value={values.periodLengthDays}
                        onChange={(e) => handleTextChange("periodLengthDays", e)}
                        {...fieldA11y("signup-period-length", errors.periodLengthDays)}
                        className={inputClass(Boolean(errors.periodLengthDays))}
                        placeholder="e.g. 5"
                      />
                    </AuthField>

                    <AuthField label="Regularity" id="signup-regularity" error={errors.regularity}>
                      <select
                        id="signup-regularity"
                        value={values.regularity}
                        onChange={(e) => handleTextChange("regularity", e)}
                        {...fieldA11y("signup-regularity", errors.regularity)}
                        className={inputClass(Boolean(errors.regularity))}
                      >
                        <option value="">Select regularity</option>
                        {CYCLE_REGULARITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </AuthField>
                  </div>

                  <AuthField label="Private notes" id="signup-private-notes" optional error={errors.privateNotes}>
                    <textarea
                      id="signup-private-notes"
                      value={values.privateNotes}
                      onChange={(e) => handleTextChange("privateNotes", e)}
                      {...fieldA11y("signup-private-notes", errors.privateNotes)}
                      className={inputClass(Boolean(errors.privateNotes), true)}
                      placeholder="Symptoms, preferences or other private notes"
                    />
                  </AuthField>

                  <fieldset className="rounded-[3px] border border-white/[0.1] bg-[var(--surface-1)] px-5 py-4">
                    <legend className="px-1 text-sm font-semibold text-zinc-200">Coach sharing preferences</legend>
                    <CheckboxField
                      checked={values.shareCurrentPhaseWithCoach}
                      onChange={(checked) => handleCheckboxChange("shareCurrentPhaseWithCoach", checked)}
                      label="Share current phase with coach"
                    />
                    <CheckboxField
                      checked={values.shareExactDatesWithCoach}
                      onChange={(checked) => handleCheckboxChange("shareExactDatesWithCoach", checked)}
                      label="Share exact dates with coach"
                    />
                    <CheckboxField
                      checked={values.shareNotesWithCoach}
                      onChange={(checked) => handleCheckboxChange("shareNotesWithCoach", checked)}
                      label="Share notes with coach"
                    />
                  </fieldset>
                </>
              )}
            </>
          )}

          {isReviewStep && (
            <>
              <p className="-mt-2 text-base leading-relaxed text-zinc-300">Check your details before creating your account.</p>

              {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}

              <ReviewSection title="Account">
                <ReviewRow label="Email" value={reviewData.account.email || "—"} />
              </ReviewSection>

              <ReviewSection title="Profile">
                <ReviewRow label="Full name" value={reviewData.profile.fullName || "—"} />
                <ReviewRow label="Phone" value={reviewData.profile.phone || "—"} />
                <ReviewRow label="Date of birth" value={reviewData.profile.dateOfBirth} />
                <ReviewRow label="Gender" value={reviewData.profile.gender} />
                <ReviewRow label="Primary goal" value={reviewData.profile.primaryGoal} />
                <ReviewRow label="Sport played" value={reviewData.profile.sportPlayed} />
                <ReviewRow label="Current weight" value={reviewData.profile.currentWeightKg} />
                <ReviewRow label="Height" value={reviewData.profile.heightCm} />
                <ReviewRow label="Additional info" value={reviewData.profile.additionalInfo} />
                <ReviewRow
                  label="Emergency contact"
                  value={`${reviewData.profile.emergencyContactName} — ${reviewData.profile.emergencyContactPhone}`}
                />
                <ReviewRow label="Second emergency contact" value={reviewData.profile.emergencyContact2} />
              </ReviewSection>

              {reviewData.cycle ? (
                <ReviewSection title="Female health options">
                  <ReviewRow label="Cycle tracking" value={reviewData.cycle.enabled} />
                  <ReviewRow label="Menopause support" value={reviewData.cycle.menopauseSupport} />
                  <ReviewRow label="Last period start" value={reviewData.cycle.lastPeriodStartDate} />
                  <ReviewRow label="Average cycle length" value={reviewData.cycle.averageCycleLengthDays} />
                  <ReviewRow label="Period length" value={reviewData.cycle.periodLengthDays} />
                  <ReviewRow label="Regularity" value={reviewData.cycle.regularity} />
                  <ReviewRow label="Private notes" value={reviewData.cycle.privateNotes} />
                  <ReviewRow label="Share current phase" value={reviewData.cycle.shareCurrentPhaseWithCoach} />
                  <ReviewRow label="Share exact dates" value={reviewData.cycle.shareExactDatesWithCoach} />
                  <ReviewRow label="Share notes" value={reviewData.cycle.shareNotesWithCoach} />
                </ReviewSection>
              ) : null}

              <div className="grid border-t border-white/[0.08] pt-4">
                <CheckboxField
                  checked={agreedToTerms}
                  onChange={setAgreedToTerms}
                  label={
                    <span className="font-normal text-zinc-300">
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-gold underline underline-offset-2 hover:text-[var(--primary-hover)]">
                        Terms and Conditions
                      </Link>
                    </span>
                  }
                />
                <CheckboxField
                  checked={agreedToPrivacy}
                  onChange={setAgreedToPrivacy}
                  label={
                    <span className="font-normal text-zinc-300">
                      I agree to the{" "}
                      <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-gold underline underline-offset-2 hover:text-[var(--primary-hover)]">
                        Privacy Policy
                      </Link>
                    </span>
                  }
                />
              </div>
            </>
          )}
        </section>

        <div className="flex flex-col-reverse gap-3 border-t border-white/[0.08] pt-6 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" onClick={goBack} disabled={!mounted} className={BUTTON_SECONDARY}>
              Back
            </button>
          ) : (
            <span aria-hidden className="hidden sm:block" />
          )}
          <div className="sm:min-w-[200px]">
            {step < totalSteps - 1 ? (
              <SubmitButton busy={false} disabled={!mounted} label="Continue" busyLabel="Continue" />
            ) : (
              <SubmitButton busy={isSubmitting} disabled={!mounted} label="Create account" busyLabel="Creating account…" />
            )}
          </div>
        </div>
      </form>
    </AuthShell>
  );
}

// Single-choice row of swatch chips (theme and accent), as an ARIA radio group.
function ChoiceGroup<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description: string;
  options: readonly { id: T; label: string; swatch: string }[];
  value: string;
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-zinc-200">{label}</p>
      <p className="mb-3 mt-1 text-sm leading-relaxed text-zinc-400">{description}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-[3px] border px-3.5 text-sm font-medium transition-colors duration-150 ${
                selected
                  ? "border-primary bg-primary/[0.1] text-zinc-50"
                  : "border-white/[0.14] text-zinc-300 hover:border-white/[0.3] hover:text-zinc-100"
              }`}
            >
              <span aria-hidden="true" className="h-4 w-4 rounded-full ring-1 ring-white/25" style={{ backgroundColor: option.swatch }} />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{title}</h3>
      <dl className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]">{children}</dl>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="text-sm text-zinc-400">{label}</dt>
      <dd className="break-words text-sm text-zinc-100">{value}</dd>
    </div>
  );
}
