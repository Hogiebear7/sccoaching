"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { WorkoutSessionRecord } from "@/lib/db";
import {
  buildWorkoutPlan,
  classifyLoad,
  LOAD_BAND_LABEL,
  type HelperContext,
  type HelperEquipment,
  type HelperFocus,
  type HelperTime,
  type PlanExercise,
  type WorkoutPlan,
} from "@/lib/workout-helper";

const TIME_OPTIONS: { value: HelperTime; label: string }[] = [
  { value: 20, label: "20 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "60+ min" },
];

const EQUIPMENT_OPTIONS: { value: HelperEquipment; label: string }[] = [
  { value: "full_gym", label: "Full gym" },
  { value: "barbell", label: "Barbell" },
  { value: "dumbbells", label: "Dumbbells" },
  { value: "kettlebell", label: "Kettlebell" },
  { value: "bodyweight", label: "Bodyweight" },
];

const FOCUS_OPTIONS: { value: HelperFocus; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "full_body", label: "Full body" },
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
  { value: "strength", label: "Strength" },
  { value: "conditioning", label: "Conditioning" },
  { value: "recovery", label: "Recovery" },
];

function readinessTone(score: number | null): { dot: string; text: string; sub: string } {
  if (score === null) return { dot: "bg-zinc-500", text: "text-zinc-500", sub: "Not logged today" };
  if (score >= 75) return { dot: "bg-teal-400", text: "text-teal-300", sub: "Well recovered" };
  if (score >= 50) return { dot: "bg-zinc-300", text: "text-zinc-100", sub: "Moderate" };
  return { dot: "bg-amber-400", text: "text-amber-300", sub: "Take it easier" };
}

function tierChipClass(tier: WorkoutPlan["tier"]): string {
  if (tier === "full") return "border-teal-500/30 bg-teal-500/10 text-teal-300";
  if (tier === "reduced") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-white/[0.1] bg-white/[0.04] text-zinc-300";
}

// ─── Exercise card ────────────────────────────────────────────────────

function ExerciseCard({ item }: { item: PlanExercise }) {
  const { prescription } = item;
  const fromHistory = prescription.kind === "history";

  return (
    <div className="group p-4 transition-colors duration-150 hover:bg-white/[0.015] sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="text-[15px] font-semibold leading-snug tracking-tight text-zinc-50">
          {item.name}
        </p>
        <p className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-display text-[15px] text-zinc-100 tabular-nums">
            {prescription.scheme}
          </span>
          <span className="text-zinc-600">·</span>
          <span
            className={`text-display text-[15px] tabular-nums ${
              fromHistory ? "text-blue-300" : "text-zinc-300"
            }`}
          >
            {prescription.loadText}
          </span>
        </p>
      </div>

      {(fromHistory || prescription.kind === "rpe") && (
        <div className="mt-2">
          {fromHistory ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-400/25 bg-blue-400/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-blue-300">
              <span className="h-1 w-1 rounded-full bg-blue-400" />
              From your history
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-400">
              <span className="h-1 w-1 rounded-full bg-zinc-500" />
              RPE target
            </span>
          )}
        </div>
      )}

      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{prescription.rationale}</p>

      {prescription.reference && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400 tabular-nums">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 flex-shrink-0 text-zinc-600"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          {prescription.reference}
        </p>
      )}
    </div>
  );
}

// ─── Section header with numbered rule ────────────────────────────────

function BlockHeader({ index, title }: { index: number; title: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-3">
      <p className="label-caps whitespace-nowrap">
        <span className="text-teal-500/80 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <span className="mx-1.5 text-zinc-700">/</span>
        {title}
      </p>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

// ─── Generating skeleton ──────────────────────────────────────────────

function GeneratingState({ phase }: { phase: 0 | 1 }) {
  return (
    <div className="p-5 sm:p-6" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin text-teal-400">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
        </svg>
        <p className="anim-fade text-sm font-medium text-zinc-300" key={phase}>
          {phase === 0 ? "Reading your recovery and history…" : "Building your session…"}
        </p>
      </div>

      {/* Skeleton mirrors the real output structure */}
      <div className="mt-5 space-y-5" aria-hidden="true">
        <div className="flex gap-2">
          <div className="h-6 w-24 animate-pulse rounded-full bg-white/[0.05]" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-white/[0.04]" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-white/[0.04]" />
        </div>
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.04]" />
        {[0, 1].map((block) => (
          <div key={block}>
            <div className="mb-2.5 flex items-center gap-3">
              <div className="h-3 w-28 animate-pulse rounded bg-white/[0.05]" />
              <span className="h-px flex-1 bg-white/[0.04]" />
            </div>
            <div className="well divide-y divide-white/[0.04] overflow-hidden">
              {[0, 1].map((row) => (
                <div key={row} className="space-y-2.5 p-4">
                  <div className="flex justify-between gap-4">
                    <div className="h-3.5 w-36 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-3.5 w-24 animate-pulse rounded bg-white/[0.05]" />
                  </div>
                  <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/[0.03]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────

export function WorkoutHelper({
  sessions,
  context,
}: {
  sessions: WorkoutSessionRecord[];
  context: HelperContext;
}) {
  const [time, setTime] = useState<HelperTime>(45);
  const [equipment, setEquipment] = useState<HelperEquipment>("full_gym");
  const [focus, setFocus] = useState<HelperFocus>("auto");
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState<0 | 1>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const loadBand = classifyLoad(context.sevenDayLoad, context.daysWithLoad);
  const readiness = readinessTone(context.readinessScore);

  function handleGenerate() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setGenerating(true);
    setPhase(0);
    // The plan itself is instant; the brief two-phase state makes
    // regeneration legible rather than jarring.
    timers.current.push(setTimeout(() => setPhase(1), 450));
    timers.current.push(
      setTimeout(() => {
        setPlan(buildWorkoutPlan({ time, equipment, focus, context, sessions }));
        setGenerating(false);
      }, 900)
    );
  }

  return (
    <div className="panel overflow-hidden">
      {/* ── Masthead ── */}
      <div className="relative border-b border-white/[0.06] p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(70%_100%_at_30%_0%,rgba(45,212,191,0.08),transparent)]" />
        <div className="relative">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-teal-500/25 bg-teal-500/10">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-teal-300"
              >
                <path d="M6.5 6.5h11" />
                <path d="M6.5 17.5h11" />
                <path d="M4 9.5v5" /><path d="M2 10.5v3" />
                <path d="M20 9.5v5" /><path d="M22 10.5v3" />
                <path d="M6.5 4v5" /><path d="M6.5 15v5" />
                <path d="M17.5 4v5" /><path d="M17.5 15v5" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-display text-[17px] text-zinc-50">Workout Helper</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                A solo session tailored to how you&apos;re tracking — built from today&apos;s
                readiness, your training week, and your own logged lifts.
              </p>
            </div>
          </div>

          {/* Context strip */}
          <div className="mt-5 grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl border border-white/[0.1] bg-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
            <div className="px-3 py-3 sm:px-4">
              <p className="label-caps text-[9px] sm:text-[10px]">Readiness</p>
              <p className="mt-1.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${readiness.dot}`} />
                <span className={`text-display text-lg leading-none tabular-nums ${readiness.text}`}>
                  {context.readinessScore ?? "—"}
                </span>
              </p>
              <p className="mt-1 truncate text-[10px] text-zinc-500">{readiness.sub}</p>
            </div>
            <div className="px-3 py-3 sm:px-4">
              <p className="label-caps text-[9px] sm:text-[10px]">7-Day Load</p>
              <p className="text-display mt-1.5 text-lg leading-none text-zinc-100">
                {LOAD_BAND_LABEL[loadBand]}
              </p>
              <p className="mt-1 truncate text-[10px] text-zinc-500">
                {context.daysWithLoad > 0
                  ? `${context.daysWithLoad} day${context.daysWithLoad === 1 ? "" : "s"} logged`
                  : "No sessions logged"}
              </p>
            </div>
            <div className="px-3 py-3 sm:px-4">
              <p className="label-caps text-[9px] sm:text-[10px]">History</p>
              <p className="text-display mt-1.5 text-lg leading-none text-zinc-100 tabular-nums">
                {sessions.length > 0 ? sessions.length : "—"}
              </p>
              <p className="mt-1 truncate text-[10px] text-zinc-500">
                {sessions.length > 0
                  ? `workout${sessions.length === 1 ? "" : "s"} on record`
                  : "None yet"}
              </p>
            </div>
          </div>

          {context.readinessScore === null && (
            <Link
              href="/dashboard/recovery"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300"
            >
              Log today&apos;s recovery for a sharper session
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* ── Inputs ── */}
      <div className="border-b border-white/[0.06] p-5 sm:p-6">
        <div className="space-y-5">
          <div>
            <p className="label-caps mb-2 text-[10px]">Time available</p>
            <div className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-white/[0.09] bg-white/[0.03] p-0.5">
              {TIME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTime(opt.value)}
                  aria-pressed={time === opt.value}
                  className={`rounded-lg px-1 py-2 text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                    time === opt.value
                      ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label-caps mb-2 text-[10px]">Equipment</p>
            <div className="grid grid-cols-2 gap-0.5 rounded-[10px] border border-white/[0.09] bg-white/[0.03] p-0.5 sm:grid-cols-5">
              {EQUIPMENT_OPTIONS.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEquipment(opt.value)}
                  aria-pressed={equipment === opt.value}
                  className={`rounded-lg px-1 py-2 text-xs font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                    // 5 options: on the 2-col mobile grid, let the last one
                    // span the final row so the control stays balanced.
                    i === EQUIPMENT_OPTIONS.length - 1 ? "max-sm:col-span-2" : ""
                  } ${
                    equipment === opt.value
                      ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label-caps mb-2 text-[10px]">
              Focus <span className="font-normal normal-case tracking-normal text-zinc-600">· optional</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FOCUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFocus(opt.value)}
                  aria-pressed={focus === opt.value}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-95 ${
                    focus === opt.value
                      ? "border-teal-500/40 bg-teal-500/10 text-teal-300 shadow-[inset_0_1px_0_0_rgba(45,212,191,0.1)]"
                      : "border-white/[0.08] text-zinc-500 hover:border-white/[0.15] hover:text-zinc-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70 disabled:active:translate-y-0"
          >
            {!generating && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {generating ? "Building your session…" : plan ? "Regenerate workout" : "Generate workout"}
          </button>
        </div>
      </div>

      {/* ── Generating ── */}
      {generating && <GeneratingState phase={phase} />}

      {/* ── Plan output ── */}
      {!generating && plan && (
        <div className="anim-rise p-5 sm:p-6">
          {/* Session summary — coach note */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tierChipClass(plan.tier)}`}>
              {plan.tierLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
              {plan.focusLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300 tabular-nums">
              ~{time === 60 ? "60+" : time} min
            </span>
            {plan.historyAnchoredCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/25 bg-blue-400/[0.08] px-2.5 py-1 text-[11px] font-medium text-blue-300 tabular-nums">
                <span className="h-1 w-1 rounded-full bg-blue-400" />
                {plan.historyAnchoredCount} from your history
              </span>
            )}
          </div>

          <div className="mt-4 border-l-2 border-teal-500/50 pl-3.5">
            <p className="text-sm leading-relaxed text-zinc-200">{plan.rationale}</p>
            {plan.notes.map((note) => (
              <p key={note} className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                {note}
              </p>
            ))}
          </div>

          {/* Blocks */}
          <div className="mt-7 space-y-7">
            {plan.blocks.map((block, i) => (
              <div
                key={block.title}
                className="anim-rise"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <BlockHeader index={i} title={block.title} />
                <div className="well divide-y divide-white/[0.04] overflow-hidden">
                  {block.items.map((item) => (
                    <ExerciseCard key={`${block.title}-${item.name}`} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 border-t border-white/[0.05] pt-4 text-xs leading-relaxed text-zinc-600">
            Guidance from your logs — adjust to how you feel on the day. Log the session below and
            future recommendations get sharper.
          </p>
        </div>
      )}
    </div>
  );
}
