"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { RecoveryLogRecord } from "@/lib/db";
import { readinessGuidance, trainingLoadForLog } from "@/lib/recovery";

type RecoveryFormValues = {
  date: string;
  sleepHours: string;
  sleepQuality: string;
  soreness: string;
  fatigue: string;
  trainingDurationMins: string;
  rpe: string;
  goal: string;
  notes: string;
};

type FormErrors = Partial<Record<keyof RecoveryFormValues, string>>;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFormValues(): RecoveryFormValues {
  return {
    date: todayDateString(),
    sleepHours: "",
    sleepQuality: "3",
    soreness: "3",
    fatigue: "3",
    trainingDurationMins: "",
    rpe: "",
    goal: "",
    notes: "",
  };
}

function readinessBadgeClass(score: number): string {
  if (score >= 70) return "bg-primary/10 text-primary border-primary/20";
  if (score >= 50) return "bg-muted text-muted-foreground border-border";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

const SCALE_OPTIONS = [1, 2, 3, 4, 5];

export function RecoveryView({
  logs,
  latestReadinessScore,
  latestGuidance,
  rollingLoad,
}: {
  logs: RecoveryLogRecord[];
  latestReadinessScore: number | null;
  latestGuidance: string | null;
  rollingLoad: { sevenDaySum: number; sevenDayAverage: number; daysWithLoad: number };
}) {
  const router = useRouter();
  const [values, setValues] = useState<RecoveryFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(
    key: keyof RecoveryFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.date.trim()) nextErrors.date = "Date is required.";

    if (
      !values.sleepHours.trim() ||
      Number.isNaN(Number(values.sleepHours)) ||
      Number(values.sleepHours) < 0 ||
      Number(values.sleepHours) > 24
    ) {
      nextErrors.sleepHours = "Enter sleep hours between 0 and 24.";
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
      const res = await fetch("/api/recovery/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not save recovery log. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Recovery log saved.");
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
        <h1 className="text-2xl font-semibold tracking-tight">Recovery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log sleep, soreness, and fatigue to track your daily readiness.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryStat
          label="Today's readiness"
          value={latestReadinessScore !== null ? `${latestReadinessScore} / 100` : "—"}
          detail={latestGuidance ?? "Log today's recovery to get guidance."}
        />
        <SummaryStat
          label="7-day training load"
          value={rollingLoad.sevenDaySum > 0 ? String(rollingLoad.sevenDaySum) : "—"}
          detail={
            rollingLoad.daysWithLoad > 0
              ? `Avg ${rollingLoad.sevenDayAverage} / day over ${rollingLoad.daysWithLoad} logged day${rollingLoad.daysWithLoad === 1 ? "" : "s"}.`
              : "Log duration and RPE to track training load."
          }
        />
        <SummaryStat
          label="Entries logged"
          value={String(logs.length)}
          detail="Total recovery check-ins."
        />
      </div>

      {/* Check-in form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]"
      >
        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Daily check-in
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
          <FormField label="Date" error={errors.date}>
            <input
              type="date"
              value={values.date}
              onChange={(e) => handleChange("date", e)}
              className={inputClass(errors.date)}
            />
          </FormField>

          <FormField label="Sleep hours" error={errors.sleepHours}>
            <input
              type="number"
              min={0}
              max={24}
              step="0.5"
              value={values.sleepHours}
              onChange={(e) => handleChange("sleepHours", e)}
              className={inputClass(errors.sleepHours)}
              placeholder="e.g. 7.5"
            />
          </FormField>

          <FormField label="Sleep quality (1=poor, 5=excellent)" error={errors.sleepQuality}>
            <select
              value={values.sleepQuality}
              onChange={(e) => handleChange("sleepQuality", e)}
              className={inputClass(errors.sleepQuality)}
            >
              {SCALE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Soreness (1=none, 5=very sore)" error={errors.soreness}>
            <select
              value={values.soreness}
              onChange={(e) => handleChange("soreness", e)}
              className={inputClass(errors.soreness)}
            >
              {SCALE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Fatigue (1=fresh, 5=exhausted)" error={errors.fatigue}>
            <select
              value={values.fatigue}
              onChange={(e) => handleChange("fatigue", e)}
              className={inputClass(errors.fatigue)}
            >
              {SCALE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label={
              <>
                Training duration (minutes){" "}
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.trainingDurationMins}
          >
            <input
              type="number"
              min={0}
              value={values.trainingDurationMins}
              onChange={(e) => handleChange("trainingDurationMins", e)}
              className={inputClass(errors.trainingDurationMins)}
              placeholder="e.g. 60"
            />
          </FormField>

          <FormField
            label={
              <>
                RPE (1-10){" "}
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.rpe}
          >
            <input
              type="number"
              min={1}
              max={10}
              value={values.rpe}
              onChange={(e) => handleChange("rpe", e)}
              className={inputClass(errors.rpe)}
              placeholder="e.g. 7"
            />
          </FormField>

          <FormField
            label={
              <>
                Goal for the day{" "}
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </>
            }
            error={errors.goal}
          >
            <input
              type="text"
              value={values.goal}
              onChange={(e) => handleChange("goal", e)}
              className={inputClass(errors.goal)}
              placeholder="e.g. Hit every set at the prescribed RPE"
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
                onChange={(e) => handleChange("notes", e)}
                className={`${inputClass(errors.notes)} min-h-[80px] resize-y`}
                placeholder="Anything else worth noting today"
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
            {isSubmitting ? "Saving…" : "Save check-in"}
          </button>
        </div>
      </form>

      {/* Recovery guidance */}
      <div className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Recovery guidance
        </p>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">What helps recovery</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>· 7–9 hours of quality sleep most nights</li>
              <li>· Consistent wake time — even on rest days</li>
              <li>· Adequate protein intake to support muscle repair</li>
              <li>· Light movement (walking, stretching) on high-soreness days</li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Why it matters</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>· Training is the stimulus — recovery is where adaptation happens</li>
              <li>· Tracking readiness over time helps spot patterns early</li>
              <li>· Your score can inform whether to push hard or take a lighter session</li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Common pitfalls</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>· Pushing max effort on days with 3+ fatigue or soreness</li>
              <li>· Alcohol close to bedtime — disrupts sleep quality even if total hours look OK</li>
              <li>· Back-to-back high-load days with no lower-intensity session between</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
          Coaching guidance only, not medical advice. Consult a healthcare provider for any health concerns.
        </p>
      </div>

      {/* Recent days */}
      <div>
        <p className="mb-3 px-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Recent days
        </p>

        {logs.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm font-medium">No check-ins logged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Save your first check-in above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => {
              const load = trainingLoadForLog(log);

              return (
                <div
                  key={log.id}
                  className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{log.date}</p>
                      <p className="mt-1 text-sm text-foreground">
                        Sleep {log.sleepHours}h · Quality {log.sleepQuality}/5 · Soreness{" "}
                        {log.soreness}/5 · Fatigue {log.fatigue}/5
                      </p>
                      {log.goal && (
                        <p className="mt-2 text-sm text-muted-foreground">Goal: {log.goal}</p>
                      )}
                      {log.notes && (
                        <p className="mt-2 text-sm text-muted-foreground">{log.notes}</p>
                      )}
                      {log.readinessScore !== null && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {readinessGuidance(log.readinessScore)}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      {log.readinessScore !== null && (
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${readinessBadgeClass(log.readinessScore)}`}
                        >
                          Readiness {log.readinessScore}/100
                        </span>
                      )}
                      {load !== null && (
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                          Load {load}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
