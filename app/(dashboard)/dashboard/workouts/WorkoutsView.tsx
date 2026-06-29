"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { WorkoutSessionRecord } from "@/lib/db";

type WorkoutFormValues = {
  title: string;
  date: string;
  durationMins: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof WorkoutFormValues, string>>;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFormValues(): WorkoutFormValues {
  return {
    title: "",
    date: todayDateString(),
    durationMins: "",
    notes: "",
  };
}

export function WorkoutsView({
  sessions,
  weeklyDurationMins,
}: {
  sessions: WorkoutSessionRecord[];
  weeklyDurationMins: number;
}) {
  const router = useRouter();
  const latestSession = sessions[0] ?? null;
  const [values, setValues] = useState<WorkoutFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleTextChange(
    key: keyof WorkoutFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.title.trim()) nextErrors.title = "Title is required.";
    if (!values.date.trim()) nextErrors.date = "Date is required.";

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
      const res = await fetch("/api/workouts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not log workout. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Workout logged.");
      setValues(emptyFormValues());
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
        <h1 className="text-2xl font-semibold tracking-tight">Workouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Record your training sessions and keep a history over time.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryStat
          label="Total sessions"
          value={String(sessions.length)}
          detail="All workouts logged."
        />
        <SummaryStat
          label="This week"
          value={weeklyDurationMins > 0 ? `${weeklyDurationMins} min` : "—"}
          detail="Total duration since Monday."
        />
        <SummaryStat
          label="Latest session"
          value={latestSession ? latestSession.title : "—"}
          detail={
            latestSession
              ? `${latestSession.date}${
                  latestSession.durationMins !== null
                    ? ` · ${latestSession.durationMins} min`
                    : ""
                }`
              : "No sessions yet."
          }
        />
      </div>

      {/* Log form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]"
      >
        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Log a workout
        </p>

        {formError && (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </p>
        )}

        {successMessage && (
          <p className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {successMessage}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Title" error={errors.title}>
            <input
              type="text"
              value={values.title}
              onChange={(e) => handleTextChange("title", e)}
              className={inputClass(errors.title)}
              placeholder="e.g. Lower Body Strength"
            />
          </FormField>

          <FormField label="Date" error={errors.date}>
            <input
              type="date"
              value={values.date}
              onChange={(e) => handleTextChange("date", e)}
              className={inputClass(errors.date)}
            />
          </FormField>

          <FormField
            label={
              <>
                Duration (minutes){" "}
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.durationMins}
          >
            <input
              type="number"
              min={0}
              value={values.durationMins}
              onChange={(e) => handleTextChange("durationMins", e)}
              className={inputClass(errors.durationMins)}
              placeholder="e.g. 60"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Notes{" "}
                  <span className="text-xs font-normal text-muted-foreground">optional</span>
                </>
              }
              error={errors.notes}
            >
              <textarea
                value={values.notes}
                onChange={(e) => handleTextChange("notes", e)}
                className={`${inputClass(errors.notes)} min-h-[100px] resize-y`}
                placeholder="What did you do, how did it feel, anything worth remembering"
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
            {isSubmitting ? "Saving…" : "Log workout"}
          </button>
        </div>
      </form>

      {/* History */}
      <div>
        <p className="mb-3 px-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          History
        </p>

        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm font-medium">No workouts logged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Log your first session above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{session.date}</p>
                    <h4 className="mt-1 text-base font-semibold">
                      {session.title}
                    </h4>
                    {session.notes && (
                      <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p>
                    )}
                  </div>

                  {session.durationMins !== null && (
                    <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      {session.durationMins} min
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </section>
  );
}

function SummaryStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
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
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
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
