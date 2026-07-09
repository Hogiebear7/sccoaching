"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { ProgrammeRecord, ProgrammeStatus } from "@/lib/db";

type ProgrammeFormValues = {
  title: string;
  phase: string;
  focus: string;
  status: ProgrammeStatus;
  startDate: string;
  currentWeek: string;
  totalWeeks: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof ProgrammeFormValues, string>>;

const STATUS_OPTIONS: { value: ProgrammeStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

function toFormValues(programme?: ProgrammeRecord): ProgrammeFormValues {
  return {
    title: programme?.title ?? "",
    phase: programme?.phase ?? "",
    focus: programme?.focus ?? "",
    status: programme?.status ?? "active",
    startDate: programme?.startDate ?? "",
    currentWeek: programme?.currentWeek != null ? String(programme.currentWeek) : "",
    totalWeeks: programme?.totalWeeks != null ? String(programme.totalWeeks) : "",
    notes: programme?.notes ?? "",
  };
}

export function ProgrammeForm({ programme }: { programme?: ProgrammeRecord }) {
  const router = useRouter();
  const [values, setValues] = useState<ProgrammeFormValues>(() => toFormValues(programme));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = Boolean(programme);

  function handleTextChange(
    key: keyof ProgrammeFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.title.trim()) nextErrors.title = "Title is required.";

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
      const res = await fetch("/api/programme/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not save programme. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Programme saved.");
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="label-caps">
          Programme
        </p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">
          {programme ? programme.title : "Set up your programme"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          {programme
            ? "Update your training programme details below."
            : "No programme yet — fill in the details below to create one."}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="panel rounded-xl p-6"
      >
        {formError ? (
          <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {successMessage}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Title" error={errors.title}>
            <input
              type="text"
              value={values.title}
              onChange={(e) => handleTextChange("title", e)}
              className={inputClass(errors.title)}
              placeholder="e.g. Strength Block"
            />
          </FormField>

          <FormField
            label={
              <>
                Phase{" "}
                <span className="text-xs font-normal text-zinc-500">optional</span>
              </>
            }
            error={errors.phase}
          >
            <input
              type="text"
              value={values.phase}
              onChange={(e) => handleTextChange("phase", e)}
              className={inputClass(errors.phase)}
              placeholder="e.g. Off-season development"
            />
          </FormField>

          <FormField label="Status" error={errors.status}>
            <select
              value={values.status}
              onChange={(e) => handleTextChange("status", e)}
              className={inputClass(errors.status)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label={
              <>
                Start date{" "}
                <span className="text-xs font-normal text-zinc-500">optional</span>
              </>
            }
            error={errors.startDate}
          >
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => handleTextChange("startDate", e)}
              className={inputClass(errors.startDate)}
            />
          </FormField>

          <FormField
            label={
              <>
                Current week{" "}
                <span className="text-xs font-normal text-zinc-500">optional</span>
              </>
            }
            error={errors.currentWeek}
          >
            <input
              type="number"
              min={0}
              value={values.currentWeek}
              onChange={(e) => handleTextChange("currentWeek", e)}
              className={inputClass(errors.currentWeek)}
              placeholder="e.g. 2"
            />
          </FormField>

          <FormField
            label={
              <>
                Total weeks{" "}
                <span className="text-xs font-normal text-zinc-500">optional</span>
              </>
            }
            error={errors.totalWeeks}
          >
            <input
              type="number"
              min={0}
              value={values.totalWeeks}
              onChange={(e) => handleTextChange("totalWeeks", e)}
              className={inputClass(errors.totalWeeks)}
              placeholder="e.g. 6"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Focus{" "}
                  <span className="text-xs font-normal text-zinc-500">optional</span>
                </>
              }
              error={errors.focus}
            >
              <textarea
                value={values.focus}
                onChange={(e) => handleTextChange("focus", e)}
                className={`${inputClass(errors.focus)} min-h-[100px] resize-y`}
                placeholder="e.g. Lower-body strength, upper-body hypertrophy, and movement quality."
              />
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Notes{" "}
                  <span className="text-xs font-normal text-zinc-500">optional</span>
                </>
              }
              error={errors.notes}
            >
              <textarea
                value={values.notes}
                onChange={(e) => handleTextChange("notes", e)}
                className={`${inputClass(errors.notes)} min-h-[120px] resize-y`}
                placeholder="Any coaching notes, reminders, or context for this programme"
              />
            </FormField>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-zinc-800 pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg border border-teal-400/50 bg-teal-500 px-5 py-2 text-[13px] font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] transition-[background-color,transform] duration-150 hover:bg-teal-400 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? "Saving…"
              : isEditing
              ? "Update programme"
              : "Save programme"}
          </button>
        </div>
      </form>
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
      <span className="mb-2 block text-sm font-medium text-zinc-200">{label}</span>
      {children}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-lg border bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}
