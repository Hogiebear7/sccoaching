"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { RecoveryLogRecord } from "@/lib/db";
import { ReadinessRing } from "@/components/ui/ReadinessRing";
import { ScoreHelp } from "@/components/ui/ScoreHelp";
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
    sleepQuality: "5",
    soreness: "5",
    fatigue: "3",
    trainingDurationMins: "",
    rpe: "",
    goal: "",
    notes: "",
  };
}

// Same thresholds as WorkoutHelper's readinessTone, so a score reads
// identically everywhere it appears in the app.
function readinessBadgeClass(score: number): string {
  if (score >= 75) return "border-[var(--success)]/30 bg-[var(--success-weak)] text-[var(--success)]";
  if (score >= 50) return "border-white/[0.1] bg-white/[0.04] text-zinc-300";
  return "border-[var(--warning)]/30 bg-[var(--warning-weak)] text-[var(--warning)]";
}

const SCALE_OPTIONS = [1, 2, 3, 4, 5];
const SCALE_OPTIONS_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Recovery — same standard as Workouts and Nutrition: one dominant
// "Today's Readiness" hero unifying the status ring, context stats, and the
// check-in form (previously three separate panels), a two-column Progress
// band pairing Training Weeks with Intensity Mix, and the static "what
// helps / why it matters / pitfalls" guidance moved into a collapsed
// Reference footer since it never changes day to day. All computation stays
// in lib/recovery and lib/progress — this file only changes composition and
// token usage (old .panel/.well + teal/blue leftovers → the surface-card
// navy/gold system already used elsewhere).
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
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
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
    <section className="anim-rise space-y-10">
      {/* Bespoke editorial header — same voice as Workouts/Nutrition */}
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Training</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Today&rsquo;s check-in sharpens everything else.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Sleep, soreness, and fatigue — logged in under a minute, felt in your session plan and
          fuelling guidance too.
        </p>
      </div>

      {/* Hero — Today's Readiness: status ring, context stats, and the
          check-in form unified in one dominant zone, instead of three
          separate panels each competing for the same attention. */}
      <div className="surface-card surface-card--accent overflow-hidden">
        <div className="relative border-b border-white/[0.06] p-5 sm:p-6">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: "radial-gradient(70% 100% at 25% 0%, color-mix(in oklch, var(--primary) 10%, transparent), transparent)" }}
          />
          <div className="relative flex flex-wrap items-center gap-4">
            <ReadinessRing score={latestReadinessScore} size={72} />
            <div className="min-w-0 flex-1">
              <p className="label-caps text-[9px]">Today&apos;s readiness</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
                {latestGuidance ?? "Log today's check-in below to get guidance."}
              </p>
              <ScoreHelp>
                Readiness scores today&apos;s check-in out of 100 — sleep hours, sleep quality,
                soreness, and fatigue each contribute up to 25 points. Higher means you&apos;re
                better recovered to train.
              </ScoreHelp>
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-2 divide-x divide-white/[0.08] rounded-lg border border-white/[0.1] bg-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
            <div className="px-3 py-3 sm:px-4">
              <p className="label-caps text-[9px] sm:text-[10px]">7-day load</p>
              <p className="text-display mt-1.5 text-lg leading-none text-zinc-100 tabular-nums">
                {rollingLoad.sevenDaySum > 0 ? rollingLoad.sevenDaySum : "—"}
              </p>
              <p className="mt-1 truncate text-[10px] text-zinc-500">
                {rollingLoad.daysWithLoad > 0
                  ? `Avg ${rollingLoad.sevenDayAverage}/day · ${rollingLoad.daysWithLoad} day${rollingLoad.daysWithLoad === 1 ? "" : "s"}`
                  : "Log duration & RPE"}
              </p>
            </div>
            <div className="px-3 py-3 sm:px-4">
              <p className="label-caps text-[9px] sm:text-[10px]">Check-ins</p>
              <p className="text-display mt-1.5 text-lg leading-none text-zinc-100 tabular-nums">{logs.length}</p>
              <p className="mt-1 truncate text-[10px] text-zinc-500">Total entries logged</p>
            </div>
          </div>
        </div>

        {/* Check-in form */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6">
          <p className="mb-4 label-caps">Daily check-in</p>

          {formError && (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </p>
          )}

          {successMessage && (
            <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
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

            <FormField label="Sleep quality (1=poor, 10=excellent)" error={errors.sleepQuality}>
              <select
                value={values.sleepQuality}
                onChange={(e) => handleChange("sleepQuality", e)}
                className={inputClass(errors.sleepQuality)}
              >
                {SCALE_OPTIONS_10.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Soreness (1=none, 10=very sore)" error={errors.soreness}>
              <select
                value={values.soreness}
                onChange={(e) => handleChange("soreness", e)}
                className={inputClass(errors.soreness)}
              >
                {SCALE_OPTIONS_10.map((n) => (
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

          <div className="mt-6 flex justify-end border-t border-white/[0.06] pt-4">
            <button
              type="submit"
              disabled={isSubmitting || justSaved}
              className="inline-flex min-w-[132px] items-center justify-center gap-2 btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-90"
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
      </div>

      {/* Progress — Training Weeks and Intensity Mix grouped as one band
          with a single header, side by side on wider screens. */}
      <ProgressModules logs={logs} />

      {/* Recent days */}
      <div>
        <p className="mb-3 px-1 label-caps">Recent days</p>

        {logs.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium">No check-ins logged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Save your first check-in above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.slice(0, 5).map((log) => {
              const load = trainingLoadForLog(log);
              const open = expandedLogId === log.id;

              return (
                <div key={log.id} className="surface-card p-3.5">
                  {/* Collapsed: date + the two scores. Tap for full detail. */}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpandedLogId(open ? null : log.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="text-sm font-medium text-foreground">{log.date}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {log.readinessScore !== null && (
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${readinessBadgeClass(log.readinessScore)}`}
                        >
                          {log.readinessScore}/100
                        </span>
                      )}
                      {load !== null && (
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-secondary-foreground tabular-nums">
                          Load {load}
                        </span>
                      )}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                      >
                        <path d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </button>

                  {open ? (
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <p className="text-sm text-foreground">
                        Sleep {log.sleepHours}h · Quality {log.sleepQuality}/10 · Soreness{" "}
                        {log.soreness}/10 · Fatigue {log.fatigue}/5
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
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reference — static guidance that never changes day to day,
          collapsed by default rather than always taking full vertical
          space. */}
      <div className="border-t border-white/[0.06] pt-6">
        <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Reference</p>
        <details className="group rounded-xl border border-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 transition hover:text-zinc-100">
            Recovery guidance
            <span className="text-zinc-600 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="space-y-4 border-t border-white/[0.06] px-4 py-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">What helps recovery</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· 7–9 hours of quality sleep most nights</li>
                <li>· Consistent wake time — even on rest days</li>
                <li>· Adequate protein intake to support muscle repair</li>
                <li>· Light movement (walking, stretching) on high-soreness days</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">Why it matters</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· Training is the stimulus — recovery is where adaptation happens</li>
                <li>· Tracking readiness over time helps spot patterns early</li>
                <li>· Your score can inform whether to push hard or take a lighter session</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">Common pitfalls</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· Pushing max effort on days with 3+ fatigue or soreness</li>
                <li>· Alcohol close to bedtime — disrupts sleep quality even if total hours look OK</li>
                <li>· Back-to-back high-load days with no lower-intensity session between</li>
              </ul>
            </div>
            <p className="border-t border-white/[0.06] pt-3 text-[11px] text-zinc-600">
              Coaching guidance only, not medical advice. Consult a healthcare provider for any
              health concerns.
            </p>
          </div>
        </details>
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
    if (ratio > 0.66) return "h-3 w-3 bg-primary";
    if (ratio > 0.33) return "h-2 w-2 bg-primary/80";
    return "h-1.5 w-1.5 bg-primary/60";
  }

  return (
    <div>
      <p className="mb-3 px-1 label-caps">Progress</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {hasWeeks && (
          <div className="surface-card p-5">
            <div className="flex items-baseline justify-between">
              <p className="label-caps text-[9px]">Training weeks</p>
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
                      week.isCurrentWeek ? "text-primary" : "text-zinc-500"
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
          <div className="surface-card p-5">
            <div className="flex items-baseline justify-between">
              <p className="label-caps text-[9px]">Intensity mix</p>
              <span className="text-[10px] text-zinc-600 tabular-nums">
                last 4 weeks · {mix.sessions} session{mix.sessions === 1 ? "" : "s"}
              </span>
            </div>
            {/* Easy/moderate/hard is an ordinal scale, not a categorical
                one, so this reads as one intensity ramp (green = safe,
                gold deepening with effort) rather than 3 arbitrary hues —
                also sidesteps this theme's gold palette, where --primary
                and --gold sit almost on the same hue and wouldn't read as
                distinct colors next to each other. */}
            <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-[3px]">
              {mix.easyPct > 0 && (
                <div className="bg-[var(--success)]/90" style={{ width: `${mix.easyPct}%` }} />
              )}
              {mix.moderatePct > 0 && (
                <div className="bg-gold/45" style={{ width: `${mix.moderatePct}%` }} />
              )}
              {mix.hardPct > 0 && (
                <div className="bg-gold/95" style={{ width: `${mix.hardPct}%` }} />
              )}
            </div>
            <div className="mt-4 space-y-2">
              {[
                { label: "Easy", band: "RPE ≤ 5", pct: mix.easyPct, dot: "bg-[var(--success)]" },
                { label: "Moderate", band: "RPE 6–7", pct: mix.moderatePct, dot: "bg-gold/45" },
                { label: "Hard", band: "RPE 8+", pct: mix.hardPct, dot: "bg-gold/95" },
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
  return `w-full rounded-lg border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground ${
    hasError
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
  }`;
}
