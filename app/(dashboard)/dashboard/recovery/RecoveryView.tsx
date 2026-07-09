"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { RecoveryLogRecord } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { intensityMix, weeklyTrainingSummary } from "@/lib/progress";
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
  // Post-save state for the submit-button morph (spinner → check → idle).
  const [justSaved, setJustSaved] = useState(false);

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
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1400);
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-8">

      <PageHeader
        eyebrow="Training"
        title="Recovery"
        subtitle="Log sleep, soreness, and fatigue to track your daily readiness."
      />

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

      <ProgressModules logs={logs} />

      {/* Check-in form */}
      <form
        onSubmit={handleSubmit}
        className="panel p-5"
      >
        <p className="mb-4 label-caps">
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
            disabled={isSubmitting || justSaved}
            className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-90"
          >
            {isSubmitting ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
                />
                Saving
              </>
            ) : justSaved ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="anim-fade h-4 w-4"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Saved
              </>
            ) : (
              "Save check-in"
            )}
          </button>
        </div>
      </form>

      {/* Recovery guidance */}
      <div className="panel p-5">
        <p className="mb-4 label-caps">
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
        <p className="mb-3 px-1 label-caps">
          Recent days
        </p>

        {logs.length === 0 ? (
          <div className="empty-state">
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
                  className="panel p-4"
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

// Week-by-week training summary + intensity mix, derived from the same logs
// the page already holds. Rendered only once there is real load data.
function ProgressModules({ logs }: { logs: RecoveryLogRecord[] }) {
  const todayISO = todayDateString();
  const weeks = weeklyTrainingSummary(logs, todayISO, 5);
  const mix = intensityMix(logs, todayISO);
  const hasWeeks = weeks.some((w) => w.totalLoad > 0);

  if (!hasWeeks && !mix) return null;

  const maxDayLoad = Math.max(
    1,
    ...weeks.flatMap((w) => w.dayLoads.filter((l): l is number => l !== null))
  );

  function dotClass(load: number | null): string {
    if (load === null) return "h-1 w-1 bg-white/[0.08]";
    const ratio = load / maxDayLoad;
    if (ratio > 0.66) return "h-3 w-3 bg-blue-400";
    if (ratio > 0.33) return "h-2 w-2 bg-blue-400/80";
    return "h-1.5 w-1.5 bg-blue-400/60";
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hasWeeks && (
        <div className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="label-caps">Training Weeks</h3>
            <span className="text-[10px] text-zinc-600">load = duration × RPE</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {weeks.map((week) => (
              <div
                key={week.weekStartISO}
                className="grid grid-cols-[44px_1fr_auto_52px] items-center gap-3"
              >
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    week.isCurrentWeek ? "text-blue-300" : "text-zinc-500"
                  }`}
                >
                  {week.label}
                </span>
                <span className="flex items-center gap-2">
                  {week.dayLoads.map((load, i) => (
                    <span key={i} className="flex h-3 w-3 items-center justify-center">
                      <span className={`rounded-full ${dotClass(load)}`} />
                    </span>
                  ))}
                </span>
                <span className="text-sm font-semibold text-zinc-200 tabular-nums">
                  {week.totalLoad > 0 ? week.totalLoad : "—"}
                </span>
                <span className="text-right text-xs text-zinc-500 tabular-nums">
                  {week.changePct !== null && week.totalLoad > 0
                    ? `${week.changePct > 0 ? "+" : ""}${week.changePct}%`
                    : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-white/[0.06] pt-2.5 text-[10px] text-zinc-600">
            Mon–Sun · dot size scales with that day&apos;s load · % vs previous week
          </p>
        </div>
      )}

      {mix && (
        <div className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="label-caps">Intensity Mix</h3>
            <span className="text-[10px] text-zinc-600 tabular-nums">
              last 4 weeks · {mix.sessions} session{mix.sessions === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
            {mix.easyPct > 0 && (
              <div className="bg-teal-400/90" style={{ width: `${mix.easyPct}%` }} />
            )}
            {mix.moderatePct > 0 && (
              <div className="bg-blue-400/90" style={{ width: `${mix.moderatePct}%` }} />
            )}
            {mix.hardPct > 0 && (
              <div className="bg-gold/90" style={{ width: `${mix.hardPct}%` }} />
            )}
          </div>
          <div className="mt-4 space-y-2">
            {[
              { label: "Easy", band: "RPE ≤ 5", pct: mix.easyPct, dot: "bg-teal-400" },
              { label: "Moderate", band: "RPE 6–7", pct: mix.moderatePct, dot: "bg-blue-400" },
              { label: "Hard", band: "RPE 8+", pct: mix.hardPct, dot: "bg-gold" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full ${row.dot}`} />
                <span className="w-20 text-sm text-zinc-300">{row.label}</span>
                <span className="flex-1 text-xs text-zinc-600">{row.band}</span>
                <span className="text-display text-[15px] text-zinc-100 tabular-nums">{row.pct}%</span>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-white/[0.06] pt-2.5 text-[10px] text-zinc-600">
            Share of training load in each effort band, from your logged sessions.
          </p>
        </div>
      )}
    </div>
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
    <div className="panel p-5">
      <p className="label-caps">{label}</p>
      <p className="mt-2 text-display text-3xl tabular-nums">{value}</p>
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
      : "border-border focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}
