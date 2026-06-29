"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import {
  shouldShowSportPlayed,
  type Gender,
  type PrimaryGoal,
  type ProfileRecord,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS } from "@/lib/profile-options";

type ProfileFormValues = {
  fullName: string;
  phone: string;
  gender: Gender | "";
  primaryGoal: PrimaryGoal | "";
  sportPlayed: string;
  currentWeightKg: string;
  additionalInfo: string;
};

type FormErrors = Partial<Record<keyof ProfileFormValues, string>>;

function toFormValues(profile: ProfileRecord): ProfileFormValues {
  return {
    fullName: profile.fullName,
    phone: profile.phone,
    gender: profile.gender,
    primaryGoal: profile.primaryGoal,
    sportPlayed: profile.sportPlayed ?? "",
    currentWeightKg: profile.currentWeightKg !== null ? String(profile.currentWeightKg) : "",
    additionalInfo: profile.additionalInfo ?? "",
  };
}

export function ProfileForm({
  email,
  profile,
}: {
  email: string;
  profile: ProfileRecord;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues>(() => toFormValues(profile));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sportVisible = shouldShowSportPlayed({ primaryGoal: values.primaryGoal });

  function handleTextChange(
    key: keyof ProfileFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.fullName.trim()) nextErrors.fullName = "Full name is required.";
    if (!values.phone.trim()) nextErrors.phone = "Phone number is required.";
    if (!values.gender) nextErrors.gender = "Please select a gender.";
    if (!values.primaryGoal) nextErrors.primaryGoal = "Please select a primary goal.";
    if (sportVisible && !values.sportPlayed.trim()) {
      nextErrors.sportPlayed = "Please enter the sport played.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!validate()) return;

    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not update profile. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Profile updated.");
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-5 pt-2">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>
      </div>

      {/* Edit form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]"
      >
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Personal details</p>
          <p className="mt-1 text-sm font-semibold">{profile.fullName}</p>
        </div>

        {formError ? (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {successMessage}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Email">
            <input
              type="email"
              value={email}
              disabled
              className={`${inputClass()} cursor-not-allowed opacity-60`}
            />
          </FormField>

          <FormField label="Full name" error={errors.fullName}>
            <input
              type="text"
              value={values.fullName}
              onChange={(e) => handleTextChange("fullName", e)}
              className={inputClass(errors.fullName)}
              placeholder="Your full name"
            />
          </FormField>

          <FormField label="Phone" error={errors.phone}>
            <input
              type="tel"
              value={values.phone}
              onChange={(e) => handleTextChange("phone", e)}
              className={inputClass(errors.phone)}
              placeholder="+91 98765 43210"
            />
          </FormField>

          <FormField label="Gender" error={errors.gender}>
            <select
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

          <FormField label="Primary goal" error={errors.primaryGoal}>
            <select
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
            <FormField label="Sport played" error={errors.sportPlayed}>
              <input
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
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.currentWeightKg}
          >
            <input
              type="number"
              inputMode="decimal"
              value={values.currentWeightKg}
              onChange={(e) => handleTextChange("currentWeightKg", e)}
              className={inputClass(errors.currentWeightKg)}
              placeholder="e.g. 72"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField label="Additional information" error={errors.additionalInfo}>
              <textarea
                value={values.additionalInfo}
                onChange={(e) => handleTextChange("additionalInfo", e)}
                className={`${inputClass(errors.additionalInfo)} min-h-[120px] resize-y`}
                placeholder="Any other info, injuries, preferences, or context we should know"
              />
            </FormField>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {/* Navigation tiles */}
      <Link
        href="/dashboard/recovery"
        className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-accent"
      >
        <div className="h-9 w-9 rounded-full bg-emerald-500/15 grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-emerald-400">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Recovery &amp; fuel</p>
          <p className="text-xs text-muted-foreground">Sleep, training load, daily guidance</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted-foreground">
          <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </Link>

      {profile.cycleTrackingEligible && (
        <Link
          href="/dashboard/cycle"
          className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-accent"
        >
          <div className="h-9 w-9 rounded-full bg-rose-500/15 grid place-items-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-rose-400">
              <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Cycle tracking</p>
            <p className="text-xs text-muted-foreground">Phase, training notes, and privacy</p>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted-foreground">
            <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      )}

    </section>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-xl border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground ${
    hasError
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-primary"
  }`;
}
