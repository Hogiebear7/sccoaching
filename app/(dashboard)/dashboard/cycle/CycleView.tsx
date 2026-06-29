"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type {
  CyclePrivacyPreferencesRecord,
  CycleRegularity,
  CycleSettingsRecord,
} from "@/lib/profile-schema";

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
  return "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-teal-500";
}

export function CycleView({
  cycleTrackingEnabled,
  cycleSettings,
  cyclePrivacy,
}: {
  cycleTrackingEnabled: boolean;
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

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Cycle tracking</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Your cycle tracker</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          {hasExistingData || cycleTrackingEnabled
            ? "View and update your cycle information. You control what, if anything, your coach can see."
            : "Add your cycle information below. Everything is private by default — you choose what, if anything, to share with your coach."}
        </p>
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-500">
          This information is only used to help personalise your coaching context. It is never shared
          without your explicit permission below.
        </div>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Cycle information</h3>
        <p className="mt-2 text-sm text-zinc-400">
          These details are private to you unless you choose to share them below.
        </p>

        <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-200">
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
              <span className="mb-2 block text-sm font-medium text-zinc-200">
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
              <span className="mb-2 block text-sm font-medium text-zinc-200">
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
              <span className="mb-2 block text-sm font-medium text-zinc-200">Regularity</span>
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
            <span className="mb-2 block text-sm font-medium text-zinc-200">Private notes</span>
            <textarea
              value={settings.privateNotes}
              onChange={(e) => setSettings((s) => ({ ...s, privateNotes: e.target.value }))}
              className={`${inputClass()} min-h-[100px] resize-y`}
              placeholder="Symptoms, patterns, or other notes — visible only to you unless you share notes below"
            />
          </label>

          {settingsError ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {settingsError}
            </p>
          ) : null}

          {settingsSuccess ? (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {settingsSuccess}
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmittingSettings}
              className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingSettings ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Coach sharing preferences</h3>
        <p className="mt-2 text-sm text-zinc-400">
          All options are off by default. Nothing is shared unless you explicitly turn it on. You
          can change these at any time.
        </p>

        <form onSubmit={handleSavePrivacy} className="mt-5 space-y-4">
          <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
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
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {privacyError}
            </p>
          ) : null}

          {privacySuccess ? (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {privacySuccess}
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmittingPrivacy}
              className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingPrivacy ? "Saving…" : "Save sharing preferences"}
            </button>
          </div>
        </form>
      </div>
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
        className="mt-1 h-4 w-4 shrink-0 accent-teal-500"
      />
      <span>
        <span className="block text-sm font-medium text-zinc-100">{label}</span>
        <span className="mt-0.5 block text-xs text-zinc-400">{description}</span>
      </span>
    </label>
  );
}
