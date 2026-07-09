"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type {
  CyclePrivacyPreferencesRecord,
  CycleRegularity,
  CycleSettingsRecord,
} from "@/lib/profile-schema";
import { estimatePhase } from "@/lib/cycle-phase";

const REGULARITY_OPTIONS: CycleRegularity[] = ["Regular", "Irregular", "Unsure"];

type SettingsState = {
  lastPeriodStartDate: string;
  averageCycleLengthDays: string;
  periodLengthDays: string;
  regularity: CycleRegularity | "";
  privateNotes: string;
};

type PrivacyState = {
  shareCurrentPhaseWithCoach: boolean;
  shareExactDatesWithCoach: boolean;
  shareNotesWithCoach: boolean;
};

function inputClass() {
  return "w-full rounded-lg border border-border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";
}

export function CycleView({
  cycleTrackingEnabled,
  menopauseSupportEnabled: initialMenopauseEnabled,
  cycleSettings,
  cyclePrivacy,
}: {
  cycleTrackingEnabled: boolean;
  menopauseSupportEnabled: boolean;
  cycleSettings: CycleSettingsRecord | null;
  cyclePrivacy: CyclePrivacyPreferencesRecord | null;
}) {
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsState>({
    lastPeriodStartDate: cycleSettings?.lastPeriodStartDate ?? "",
    averageCycleLengthDays:
      cycleSettings?.averageCycleLengthDays != null
        ? String(cycleSettings.averageCycleLengthDays)
        : "",
    periodLengthDays:
      cycleSettings?.periodLengthDays != null ? String(cycleSettings.periodLengthDays) : "",
    regularity: cycleSettings?.regularity ?? "",
    privateNotes: cycleSettings?.privateNotes ?? "",
  });

  const [privacy, setPrivacy] = useState<PrivacyState>({
    shareCurrentPhaseWithCoach: cyclePrivacy?.shareCurrentPhaseWithCoach ?? false,
    shareExactDatesWithCoach: cyclePrivacy?.shareExactDatesWithCoach ?? false,
    shareNotesWithCoach: cyclePrivacy?.shareNotesWithCoach ?? false,
  });

  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false);

  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacySuccess, setPrivacySuccess] = useState<string | null>(null);
  const [isSubmittingPrivacy, setIsSubmittingPrivacy] = useState(false);

  const [menopauseEnabled, setMenopauseEnabled] = useState(initialMenopauseEnabled);
  const [menopauseError, setMenopauseError] = useState<string | null>(null);
  const [menopauseSuccess, setMenopauseSuccess] = useState<string | null>(null);
  const [isSubmittingMenopause, setIsSubmittingMenopause] = useState(false);

  const phaseEstimate = estimatePhase(
    cycleSettings?.lastPeriodStartDate ?? null,
    cycleSettings?.averageCycleLengthDays ?? null,
    cycleSettings?.periodLengthDays ?? null,
    cycleSettings?.regularity ?? null
  );

  const hasExistingData = Boolean(
    cycleSettings?.lastPeriodStartDate ||
      cycleSettings?.averageCycleLengthDays ||
      cycleSettings?.periodLengthDays
  );

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsSubmittingSettings(true);

    try {
      const res = await fetch("/api/cycle/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setSettingsError(data?.message ?? "Could not save settings.");
        return;
      }

      setSettingsSuccess("Cycle settings saved.");
      router.refresh();
    } catch {
      setSettingsError("Something went wrong. Please try again.");
    } finally {
      setIsSubmittingSettings(false);
    }
  }

  async function handleSavePrivacy(e: FormEvent) {
    e.preventDefault();
    setPrivacyError(null);
    setPrivacySuccess(null);
    setIsSubmittingPrivacy(true);

    try {
      const res = await fetch("/api/cycle/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(privacy),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setPrivacyError(data?.message ?? "Could not save sharing preferences.");
        return;
      }

      setPrivacySuccess("Sharing preferences saved.");
      router.refresh();
    } catch {
      setPrivacyError("Something went wrong. Please try again.");
    } finally {
      setIsSubmittingPrivacy(false);
    }
  }

  async function handleSaveMenopause(enabled: boolean) {
    setMenopauseError(null);
    setMenopauseSuccess(null);
    setIsSubmittingMenopause(true);
    try {
      const res = await fetch("/api/cycle/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menopauseSupportEnabled: enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMenopauseError(data?.message ?? "Could not save preference.");
        return;
      }
      setMenopauseEnabled(enabled);
      setMenopauseSuccess(enabled ? "Menopause support enabled." : "Menopause support disabled.");
      router.refresh();
    } catch {
      setMenopauseError("Something went wrong. Please try again.");
    } finally {
      setIsSubmittingMenopause(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="label-caps">Training</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Your cycle tracker</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {hasExistingData || cycleTrackingEnabled
            ? "View and update your cycle information. You control what, if anything, your coach can see."
            : "Add your cycle information below. Everything is private by default — you choose what, if anything, to share with your coach."}
        </p>
        <div className="mt-4 well px-4 py-3 text-xs text-muted-foreground">
          This information is only used to help personalise your coaching context. It is never shared
          without your explicit permission below.
        </div>
      </div>

      {/* Phase guidance card — shown when cycle tracking is enabled and data exists */}
      {cycleTrackingEnabled && phaseEstimate.phase !== "Unknown" && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">
              Estimated phase: {phaseEstimate.phaseLabel}
            </h3>
            {phaseEstimate.cycleDay !== null && phaseEstimate.cycleLength !== null && (
              <span className="text-sm text-muted-foreground">
                Approx. day {phaseEstimate.cycleDay} of {phaseEstimate.cycleLength}
              </span>
            )}
          </div>

          <p className="mt-3 text-sm text-foreground">{phaseEstimate.explanation}</p>

          {phaseEstimate.confidence === "low" && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
              Your cycle regularity is set to irregular or unsure — treat this estimate as a
              rough reference only. Individual experience varies significantly.
            </p>
          )}

          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <GuidanceRow label="Training" value={phaseEstimate.trainingGuidance} />
            <GuidanceRow label="Intensity" value={phaseEstimate.intensityGuidance} />
            <GuidanceRow label="Recovery" value={phaseEstimate.recoveryGuidance} />
          </div>

          <p className="mt-4 text-xs text-muted-foreground/60">
            Educational guidance only — not medical advice. This estimate is based on the cycle
            information you have entered and may not reflect your individual experience. Cycle
            phases vary between people and from month to month.
          </p>
        </div>
      )}

      {/* Phase prompt — shown when cycle tracking is enabled but no data yet */}
      {cycleTrackingEnabled && phaseEstimate.phase === "Unknown" && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Estimated phase</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your cycle information below to see a phase estimate. All information is private
            to you.
          </p>
        </div>
      )}

      {/* Menopause support card — shown when preference is enabled */}
      {menopauseEnabled && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">Menopause support</h3>
            <span className="text-xs text-muted-foreground">Educational content only — not medical advice</span>
          </div>

          <div className="mt-4 space-y-5">
            <MenopauseSection
              title="Strength training"
              body="After menopause, strength training is one of the most effective tools for preserving muscle mass, maintaining bone density, and supporting metabolic health. Two to three sessions per week with progressive resistance is a strong foundation."
            />
            <MenopauseSection
              title="Nutrition"
              body="Protein needs remain high. Adequate calcium and vitamin D support bone health. Consistent meal timing can help stabilise energy levels throughout the day."
            />
            <MenopauseSection
              title="Recovery"
              body="Sleep quality can be more disrupted during perimenopause and post-menopause. Active recovery, consistent sleep schedules, and stress management all contribute to better training outcomes."
            />
          </div>

          <p className="mt-5 text-xs text-muted-foreground/60">
            This is educational information only. Please speak with a healthcare professional for
            personal medical guidance.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Cycle information</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          These details are private to you unless you choose to share them below.
        </p>

        <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">
                Last period start date
              </span>
              <input
                type="date"
                value={settings.lastPeriodStartDate}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, lastPeriodStartDate: e.target.value }))
                }
                className={inputClass()}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">
                Average cycle length (days)
              </span>
              <input
                type="number"
                value={settings.averageCycleLengthDays}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, averageCycleLengthDays: e.target.value }))
                }
                className={inputClass()}
                placeholder="e.g. 28"
                min={14}
                max={60}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">
                Period length (days)
              </span>
              <input
                type="number"
                value={settings.periodLengthDays}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, periodLengthDays: e.target.value }))
                }
                className={inputClass()}
                placeholder="e.g. 5"
                min={1}
                max={14}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">Regularity</span>
              <select
                value={settings.regularity}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    regularity: e.target.value as CycleRegularity | "",
                  }))
                }
                className={inputClass()}
              >
                <option value="">Select regularity</option>
                {REGULARITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Private notes</span>
            <textarea
              value={settings.privateNotes}
              onChange={(e) => setSettings((s) => ({ ...s, privateNotes: e.target.value }))}
              className={`${inputClass()} min-h-[100px] resize-y`}
              placeholder="Symptoms, patterns, or other notes — visible only to you unless you share notes below"
            />
          </label>

          {settingsError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {settingsError}
            </p>
          ) : null}

          {settingsSuccess ? (
            <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              {settingsSuccess}
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmittingSettings}
              className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingSettings ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Coach sharing preferences</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          All options are off by default. Nothing is shared unless you explicitly turn it on. You
          can change these at any time.
        </p>

        <form onSubmit={handleSavePrivacy} className="mt-5 space-y-4">
          <div className="space-y-4 well p-4">
            <CheckboxRow
              label="Share approximate cycle phase with coach"
              description="Your coach will see an estimated cycle day (e.g. 'Approx. day 14 of ~28'). This is an approximation only, not medical information."
              checked={privacy.shareCurrentPhaseWithCoach}
              onChange={(v) => setPrivacy((p) => ({ ...p, shareCurrentPhaseWithCoach: v }))}
            />
            <CheckboxRow
              label="Share last period date with coach"
              description="Your coach will see the date you entered for your last period start."
              checked={privacy.shareExactDatesWithCoach}
              onChange={(v) => setPrivacy((p) => ({ ...p, shareExactDatesWithCoach: v }))}
            />
            <CheckboxRow
              label="Share private notes with coach"
              description="Your coach will see the notes you have entered above."
              checked={privacy.shareNotesWithCoach}
              onChange={(v) => setPrivacy((p) => ({ ...p, shareNotesWithCoach: v }))}
            />
          </div>

          {privacyError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {privacyError}
            </p>
          ) : null}

          {privacySuccess ? (
            <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              {privacySuccess}
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmittingPrivacy}
              className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingPrivacy ? "Saving…" : "Save sharing preferences"}
            </button>
          </div>
        </form>
      </div>
      {/* Menopause preference toggle */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Preferences</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          You can change these at any time. They are private to you.
        </p>

        <div className="mt-4 well p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Menopause support information</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Educational content on strength training, nutrition, and recovery relevant to
                perimenopause and post-menopause.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSaveMenopause(!menopauseEnabled)}
              disabled={isSubmittingMenopause}
              className={`shrink-0 rounded-lg border px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                menopauseEnabled
                  ? "border-primary bg-primary/20 text-primary hover:bg-primary/30"
                  : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {isSubmittingMenopause ? "Saving…" : menopauseEnabled ? "On" : "Off"}
            </button>
          </div>
        </div>

        {menopauseError && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {menopauseError}
          </p>
        )}
        {menopauseSuccess && (
          <p className="mt-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {menopauseSuccess}
          </p>
        )}
      </div>

    </div>
  );
}

function GuidanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground pt-0.5">
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function MenopauseSection({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function CheckboxRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
