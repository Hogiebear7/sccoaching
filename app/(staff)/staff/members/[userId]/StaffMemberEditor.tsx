"use client";

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
  email: string;
  fullName: string;
  phone: string;
  gender: Gender | "";
  primaryGoal: PrimaryGoal | "";
  sportPlayed: string;
  currentWeightKg: string;
  additionalInfo: string;
};

type FormErrors = Partial<Record<keyof ProfileFormValues, string>>;

function toFormValues(email: string, profile: ProfileRecord): ProfileFormValues {
  return {
    email,
    fullName: profile.fullName,
    phone: profile.phone,
    gender: profile.gender,
    primaryGoal: profile.primaryGoal,
    sportPlayed: profile.sportPlayed ?? "",
    currentWeightKg: profile.currentWeightKg !== null ? String(profile.currentWeightKg) : "",
    additionalInfo: profile.additionalInfo ?? "",
  };
}

export function StaffMemberEditor({
  userId,
  email,
  profile,
  initialNotes,
}: {
  userId: string;
  email: string;
  profile: ProfileRecord;
  initialNotes: string;
}) {
  const router = useRouter();

  const [values, setValues] = useState<ProfileFormValues>(() => toFormValues(email, profile));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const [notes, setNotes] = useState(initialNotes);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesSuccess, setNotesSuccess] = useState<string | null>(null);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

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

    if (!values.email.trim()) nextErrors.email = "Email is required.";
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
      const res = await fetch("/api/staff/members/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...values }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not update member. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Member updated.");
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    setResetError(null);
    setResetMessage(null);
    setResetUrl(null);
    setIsResetting(true);

    try {
      const res = await fetch("/api/staff/members/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setResetError(data?.message ?? "Could not create a reset link. Please try again.");
        return;
      }

      setResetMessage(data?.message ?? "Reset link created.");
      setResetUrl(data?.resetUrl ?? null);
    } catch {
      setResetError("Something went wrong. Please try again.");
    } finally {
      setIsResetting(false);
    }
  }

  async function handleSaveNotes() {
    setNotesError(null);
    setNotesSuccess(null);
    setIsSavingNotes(true);

    try {
      const res = await fetch("/api/staff/members/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, notes }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setNotesError(data?.message ?? "Could not save notes. Please try again.");
        return;
      }

      setNotesSuccess(data?.message ?? "Notes saved.");
    } catch {
      setNotesError("Something went wrong. Please try again.");
    } finally {
      setIsSavingNotes(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6"
      >
        <h3 className="text-lg font-semibold text-zinc-50">Profile</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Editing this member&apos;s core profile data.
        </p>

        {formError ? (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {successMessage}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <FormField label="Email" error={errors.email}>
            <input
              type="email"
              value={values.email}
              onChange={(e) => handleTextChange("email", e)}
              className={inputClass(errors.email)}
              placeholder="member@example.com"
            />
          </FormField>

          <FormField label="Full name" error={errors.fullName}>
            <input
              type="text"
              value={values.fullName}
              onChange={(e) => handleTextChange("fullName", e)}
              className={inputClass(errors.fullName)}
              placeholder="Member's full name"
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
                <span className="text-xs font-normal text-zinc-500">optional</span>
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
                className={`${inputClass(errors.additionalInfo)} min-h-[100px] resize-y`}
                placeholder="Any other info, injuries, preferences, or context"
              />
            </FormField>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-zinc-800 pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Account access</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Create a password reset link for this member.
        </p>

        {resetError ? (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {resetError}
          </p>
        ) : null}

        {resetMessage ? (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <p>{resetMessage}</p>
            {resetUrl ? (
              <p className="mt-2 break-all font-mono text-xs text-emerald-200">{resetUrl}</p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleResetPassword}
          disabled={isResetting}
          className="mt-4 rounded-xl border border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isResetting ? "Creating link…" : "Send password reset"}
        </button>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Coach notes</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Internal notes, visible to staff only — not shown to the member.
        </p>

        {notesError ? (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {notesError}
          </p>
        ) : null}

        {notesSuccess ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notesSuccess}
          </p>
        ) : null}

        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesSuccess(null);
          }}
          className={`${inputClass()} mt-4 min-h-[120px] resize-y`}
          placeholder="Notes only staff can see — injuries, preferences, coaching context, etc."
        />

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={isSavingNotes}
            className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingNotes ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>
    </div>
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
      <span className="mb-2 block text-sm font-medium text-zinc-200">{label}</span>
      {children}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-xl border bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-teal-500"
  }`;
}
