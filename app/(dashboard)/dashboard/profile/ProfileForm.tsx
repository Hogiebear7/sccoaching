"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import {
  shouldShowSportPlayed,
  type DietaryPreference,
  type Gender,
  type PrimaryGoal,
  type ProfileRecord,
} from "@/lib/profile-schema";
import type { BodyWeightLogRecord } from "@/lib/db";
import type { MemberStatsData } from "@/lib/member-stats";
import { PageHeader } from "@/components/ui/PageHeader";
import { latestWeightLog } from "@/lib/body-weight";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS } from "@/lib/profile-options";
import { DietaryRequirementsFields } from "@/components/profile/DietaryRequirementsFields";
import { ProfileStatsCard } from "./ProfileStatsCard";

const BW_W = 400;
const BW_H = 140;
const BW_PAD = { top: 16, right: 16, bottom: 28, left: 40 };

type BwFilter = "3months" | "month" | "6months" | "year" | "all";

const BW_FILTER_LABELS: { value: BwFilter; label: string }[] = [
  { value: "month",   label: "1 month" },
  { value: "3months", label: "3 months" },
  { value: "6months", label: "6 months" },
  { value: "year",    label: "1 year" },
  { value: "all",     label: "All time" },
];

function applyBwFilter(logs: BodyWeightLogRecord[], filter: BwFilter): BodyWeightLogRecord[] {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  if (filter === "all") return sorted;
  const cutoff = new Date();
  if (filter === "month")   cutoff.setMonth(cutoff.getMonth() - 1);
  if (filter === "3months") cutoff.setMonth(cutoff.getMonth() - 3);
  if (filter === "6months") cutoff.setMonth(cutoff.getMonth() - 6);
  if (filter === "year")    cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return sorted.filter((l) => l.date >= cutoffStr);
}

// DD-MM-YYYY for the read-only weight display (e.g. "logged 07-07-2026").
function formatDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}-${m}-${y}` : iso;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}

// Consecutive entries more than this far apart get a dashed connector so a
// long logging gap is visibly different from a steady trend.
const BW_GAP_DAYS = 35;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000;
}

function BodyWeightTrendChart({ logs }: { logs: BodyWeightLogRecord[] }) {
  if (logs.length < 2) {
    return (
      <p className="py-3 text-center text-xs text-muted-foreground">
        {logs.length === 0
          ? "No entries in this time range."
          : "Log at least two entries to see a trend."}
      </p>
    );
  }

  const innerW = BW_W - BW_PAD.left - BW_PAD.right;
  const innerH = BW_H - BW_PAD.top - BW_PAD.bottom;

  const weights = logs.map((l) => l.weightKg);
  const minY = Math.min(...weights);
  const maxY = Math.max(...weights);
  const yRange = maxY === minY ? 1 : maxY - minY;

  const toX = (i: number) =>
    BW_PAD.left + (logs.length === 1 ? innerW / 2 : (i / (logs.length - 1)) * innerW);
  const toY = (val: number) =>
    BW_PAD.top + innerH - ((val - minY) / yRange) * innerH;

  const plotted = logs.map((l, i) => ({ x: toX(i), y: toY(l.weightKg), val: l.weightKg, date: l.date }));
  const labelStep = Math.max(1, Math.ceil(logs.length / 6));

  // One <line> per connector rather than one polyline, so a segment that
  // spans a long logging gap can render dashed.
  const segments = plotted.slice(1).map((p, i) => ({
    x1: plotted[i].x,
    y1: plotted[i].y,
    x2: p.x,
    y2: p.y,
    isGap: daysBetween(plotted[i].date, p.date) > BW_GAP_DAYS,
  }));

  const areaPoints = [
    `${plotted[0].x},${BW_PAD.top + innerH}`,
    ...plotted.map((p) => `${p.x},${p.y}`),
    `${plotted[plotted.length - 1].x},${BW_PAD.top + innerH}`,
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${BW_W} ${BW_H}`}
      width="100%"
      className="overflow-visible text-foreground"
      aria-hidden="true"
    >
      <line
        x1={BW_PAD.left} y1={BW_PAD.top}
        x2={BW_PAD.left} y2={BW_PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <line
        x1={BW_PAD.left} y1={BW_PAD.top + innerH}
        x2={BW_PAD.left + innerW} y2={BW_PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <polygon points={areaPoints} style={{ fill: "var(--primary)" }} opacity={0.08} />
      {segments.map((s, i) => (
        <line
          key={i}
          x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          style={{ stroke: "var(--primary)" }}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={s.isGap ? "3 5" : undefined}
          strokeOpacity={s.isGap ? 0.55 : 1}
        />
      ))}
      {plotted.map(({ x, y, val, date }, i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={3.5} style={{ fill: "var(--primary)" }} />
          <text x={x} y={y - 8} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.7}>
            {val}
          </text>
          {i % labelStep === 0 && (
            <text x={x} y={BW_PAD.top + innerH + 16} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.45}>
              {shortDate(date)}
            </text>
          )}
        </g>
      ))}
      <text x={BW_PAD.left - 5} y={BW_PAD.top} textAnchor="end" dominantBaseline="middle" fontSize={8} fill="currentColor" opacity={0.45}>
        {maxY}
      </text>
      <text x={BW_PAD.left - 5} y={BW_PAD.top + innerH} textAnchor="end" dominantBaseline="middle" fontSize={8} fill="currentColor" opacity={0.45}>
        {minY}
      </text>
    </svg>
  );
}

// Short change-since-first-entry summary shown above the chart. Always uses
// the full history, not the active time filter, so it reads as "since you
// joined" rather than "since the start of this window".
function weightChangeSummary(logs: BodyWeightLogRecord[]): string | null {
  if (logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const delta = Math.round((latest.weightKg - first.weightKg) * 10) / 10;
  const since = new Date(`${first.date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (delta === 0) return `No change since your first entry (${since}).`;
  return `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} kg since your first entry (${since}).`;
}

type ProfileFormValues = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender | "";
  primaryGoal: PrimaryGoal | "";
  sportPlayed: string;
  additionalInfo: string;
  dietaryPreference: DietaryPreference | "";
  allergies: string[];
  intolerancesOrMedical: string[];
  dietaryNotes: string;
};

type FormErrors = Partial<Record<keyof ProfileFormValues, string>>;

function toFormValues(profile: ProfileRecord): ProfileFormValues {
  return {
    fullName: profile.fullName,
    phone: profile.phone,
    dateOfBirth: profile.dateOfBirth ?? "",
    gender: profile.gender,
    primaryGoal: profile.primaryGoal,
    sportPlayed: profile.sportPlayed ?? "",
    additionalInfo: profile.additionalInfo ?? "",
    dietaryPreference: profile.dietaryPreference ?? "standard",
    allergies: profile.allergies ?? [],
    intolerancesOrMedical: profile.intolerancesOrMedical ?? [],
    dietaryNotes: profile.dietaryNotes ?? "",
  };
}

export function ProfileForm({
  email,
  profile,
  bodyWeightLogs,
  statsData,
}: {
  email: string;
  profile: ProfileRecord;
  bodyWeightLogs: BodyWeightLogRecord[];
  statsData: MemberStatsData;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues>(() => toFormValues(profile));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [bwDate, setBwDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bwWeight, setBwWeight] = useState("");
  const [bwError, setBwError] = useState<string | null>(null);
  const [bwSubmitting, setBwSubmitting] = useState(false);
  const [bwFilter, setBwFilter] = useState<BwFilter>("3months");

  // Read-only current weight, sourced from the latest weight log (the page
  // passes the resolved value). Updated locally the moment a new latest
  // entry is logged, so the display changes without a refresh.
  const [displayWeightKg, setDisplayWeightKg] = useState<number | null>(profile.currentWeightKg);
  const [latestLogDate, setLatestLogDate] = useState<string | null>(
    () => latestWeightLog(bodyWeightLogs)?.date ?? null
  );

  async function handleBwSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBwError(null);
    const weightKg = parseFloat(bwWeight);
    if (!bwDate || !Number.isFinite(weightKg) || weightKg <= 0) {
      setBwError("Please enter a valid date and a positive weight.");
      return;
    }
    setBwSubmitting(true);
    try {
      const res = await fetch("/api/profile/body-weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: bwDate, weightKg }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBwError(data?.message ?? "Could not log weight. Please try again.");
        return;
      }
      setBwWeight("");
      // Latest log wins: if this entry is the newest, reflect it immediately
      // in the read-only display, then revalidate server-backed data.
      if (latestLogDate === null || bwDate >= latestLogDate) {
        setDisplayWeightKg(weightKg);
        setLatestLogDate(bwDate);
      }
      router.refresh();
    } catch {
      setBwError("Something went wrong. Please try again.");
    } finally {
      setBwSubmitting(false);
    }
  }

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

    const dob = values.dateOfBirth.trim();
    const todayISO = new Date().toISOString().slice(0, 10);
    if (!dob) {
      nextErrors.dateOfBirth = "Date of birth is required.";
    } else if (Number.isNaN(new Date(dob).getTime()) || dob >= todayISO) {
      nextErrors.dateOfBirth = "Enter a valid date in the past.";
    }

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
    <section className="space-y-8">

      <PageHeader eyebrow="Account" title="Profile" subtitle={email} />

      {/* Training summary — compact, range-filterable stats */}
      <ProfileStatsCard data={statsData} />

      {/* Edit form */}
      <form
        onSubmit={handleSubmit}
        className="panel p-5"
      >
        <div className="mb-5">
          <p className="label-caps">Personal details</p>
          <p className="mt-1 text-sm font-semibold">{profile.fullName}</p>
        </div>

        {formError ? (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
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
              placeholder="+353 83 123 4567"
            />
          </FormField>

          <FormField
            label={
              <>
                Date of birth
              </>
            }
            error={errors.dateOfBirth}
          >
            <input
              type="date"
              required
              aria-required="true"
              value={values.dateOfBirth}
              onChange={(e) => handleTextChange("dateOfBirth", e)}
              max={new Date().toISOString().slice(0, 10)}
              className={inputClass(errors.dateOfBirth)}
            />
          </FormField>

          <FormField label="Gender" error={errors.gender}>
            <select
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

          <FormField label="Primary goal" error={errors.primaryGoal}>
            <select
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
                Current weight{" "}
                <span className="text-xs font-normal text-muted-foreground">from your weight log</span>
              </>
            }
          >
            <div
              aria-readonly="true"
              className="well flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {displayWeightKg !== null ? `${displayWeightKg} kg` : "—"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {latestLogDate ? `logged ${formatDMY(latestLogDate)}` : "no entries yet"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Updates automatically from your latest entry — log a new weight below to change it.
            </p>
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

          <div className="md:col-span-2">
            <p className="mb-1 text-sm font-semibold">Dietary requirements</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Powers your nutrition suggestions. Allergies and intolerances are always excluded.
            </p>
            <DietaryRequirementsFields
              idPrefix="profile-diet"
              values={{
                dietaryPreference: values.dietaryPreference,
                allergies: values.allergies,
                intolerancesOrMedical: values.intolerancesOrMedical,
                dietaryNotes: values.dietaryNotes,
              }}
              onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {/* Body weight log */}
      <div className="panel p-5">
        <p className="mb-4 label-caps">Body weight</p>

        <form onSubmit={handleBwSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Date</label>
            <input
              type="date"
              value={bwDate}
              onChange={(e) => setBwDate(e.target.value)}
              className={inputClass()}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Weight (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={bwWeight}
              onChange={(e) => setBwWeight(e.target.value)}
              placeholder="e.g. 72.5"
              className={inputClass()}
            />
          </div>
          <button
            type="submit"
            disabled={bwSubmitting}
            className="btn-primary px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60 sm:shrink-0"
          >
            {bwSubmitting ? "Logging…" : "Log weight"}
          </button>
        </form>

        {bwError ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {bwError}
          </p>
        ) : null}

        {bodyWeightLogs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Log your first weight to start tracking progress.
          </p>
        ) : (
          <>
            {/* Filter buttons */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {BW_FILTER_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBwFilter(value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    bwFilter === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Change since first entry — full history, not the filter window */}
            {weightChangeSummary(bodyWeightLogs) ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {weightChangeSummary(bodyWeightLogs)}
              </p>
            ) : null}

            {/* Chart */}
            <div className="mt-3">
              <BodyWeightTrendChart logs={applyBwFilter(bodyWeightLogs, bwFilter)} />
            </div>

          </>
        )}
      </div>

      {/* Navigation tiles */}
      <Link
        href="/dashboard/settings"
        className="flex items-center gap-4 panel p-4 transition-colors hover:bg-accent"
      >
        <div className="h-9 w-9 rounded-full bg-primary/15 grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Settings</p>
          <p className="text-xs text-muted-foreground">Notifications, reminders, units, account</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted-foreground">
          <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </Link>

      <Link
        href="/dashboard/recovery"
        className="flex items-center gap-4 panel p-4 transition-colors hover:bg-accent"
      >
        <div className="h-9 w-9 rounded-full bg-primary/15 grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary">
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
          className="flex items-center gap-4 panel p-4 transition-colors hover:bg-accent"
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
  return `w-full rounded-lg border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground ${
    hasError
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}
