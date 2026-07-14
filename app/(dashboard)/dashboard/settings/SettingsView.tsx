"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MeasurementUnits, ProfileRecord } from "@/lib/profile-schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppearancePanel } from "@/components/settings/AppearancePanel";

// Inlined at build time via the NEXT_PUBLIC_ prefix. Null when not configured.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

// Converts a URL-safe base64 VAPID public key to the Uint8Array expected by
// pushManager.subscribe(). Standard conversion required by the Push API spec.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const DEFAULT_REMINDER_TIMINGS_MINS = [1440, 360, 180, 60];

const PRESET_REMINDER_TIMINGS = [
  { mins: 1440, label: "24 hr" },
  { mins: 360,  label: "6 hr" },
  { mins: 180,  label: "3 hr" },
  { mins: 60,   label: "1 hr" },
];

function formatTimingLabel(mins: number): string {
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60} hr`;
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }
  return `${mins} min`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

interface MembershipInfo {
  planName: string | null;
  statusLabel: string | null;
  statusIsActive: boolean;
  startedAt: string | null;
  renewsAt: string | null;
}

export function SettingsView({
  email,
  profile,
  membership,
}: {
  email: string;
  profile: ProfileRecord;
  membership: MembershipInfo;
}) {
  // ── Password reset ────────────────────────────────────────────────
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handlePasswordReset() {
    setResetSending(true);
    setResetError(null);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
    } catch {
      setResetError("Something went wrong. Please try again.");
    } finally {
      setResetSending(false);
    }
  }

  // ── Measurement units ─────────────────────────────────────────────
  const [units, setUnits] = useState<MeasurementUnits>(profile.preferredUnits ?? "metric");
  const [unitsSaving, setUnitsSaving] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);

  async function handleUnitsChange(next: MeasurementUnits) {
    if (next === units || unitsSaving) return;
    const previous = units;
    setUnits(next); // optimistic
    setUnitsSaving(true);
    setUnitsError(null);
    try {
      const res = await fetch("/api/profile/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredUnits: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
    } catch (err) {
      setUnits(previous); // revert
      setUnitsError(err instanceof Error ? err.message : "Failed to save. Try again.");
    } finally {
      setUnitsSaving(false);
    }
  }

  // ── Class reminders ───────────────────────────────────────────────
  const [reminderTimings, setReminderTimings] = useState<number[]>(
    () => profile.reminderTimingsMins ?? DEFAULT_REMINDER_TIMINGS_MINS
  );
  const [customMins, setCustomMins] = useState("");
  const [customMinsError, setCustomMinsError] = useState<string | null>(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState<string | null>(null);

  // ── Email notifications ───────────────────────────────────────────
  const [emailEnabled, setEmailEnabled] = useState(
    () => profile.emailNotificationsEnabled !== false
  );
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // ── Push notifications ────────────────────────────────────────────
  type PushPermState = "checking" | "unsupported" | "default" | "granted" | "denied";
  const [pushPermission, setPushPermission] = useState<PushPermState>("checking");
  const [pushEnabled, setPushEnabled] = useState(() => profile.pushNotificationsEnabled === true);
  const [pushWorking, setPushWorking] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushSuccess, setPushSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setPushPermission("unsupported");
      return;
    }
    setPushPermission(Notification.permission as PushPermState);
  }, []);

  // Called from the "Enable push notifications" button (default permission state).
  // Requests OS permission, then immediately subscribes if granted.
  async function handleEnablePush() {
    setPushWorking(true);
    setPushError(null);
    setPushSuccess(null);
    try {
      const perm = await Notification.requestPermission();
      setPushPermission(perm as PushPermState);
      if (perm !== "granted") return;
      await subscribePushAndSave();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Could not enable push notifications.");
    } finally {
      setPushWorking(false);
    }
  }

  // Called from the toggle when permission is already granted.
  async function handleTogglePush(enabled: boolean) {
    setPushWorking(true);
    setPushError(null);
    setPushSuccess(null);
    setPushEnabled(enabled); // optimistic
    try {
      if (enabled) {
        await subscribePushAndSave();
      } else {
        await unsubscribePushAndSave();
      }
    } catch (err) {
      setPushEnabled(!enabled); // revert on failure
      setPushError(err instanceof Error ? err.message : "Failed to save. Try again.");
    } finally {
      setPushWorking(false);
    }
  }

  async function subscribePushAndSave() {
    if (!VAPID_PUBLIC_KEY) {
      throw new Error("Push notifications are not configured on this server.");
    }
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    const endpoint = json.endpoint ?? "";
    const p256dh = json.keys?.p256dh ?? "";
    const auth = json.keys?.auth ?? "";

    const subRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, keys: { p256dh, auth }, userAgent: navigator.userAgent }),
    });
    if (!subRes.ok) throw new Error("Failed to register device.");

    const prefRes = await fetch("/api/profile/push-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pushNotificationsEnabled: true }),
    });
    if (!prefRes.ok) throw new Error("Failed to save preference.");

    setPushEnabled(true);
    setPushSuccess("Push notifications enabled for this device.");
  }

  async function unsubscribePushAndSave() {
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    }
    const prefRes = await fetch("/api/profile/push-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pushNotificationsEnabled: false }),
    });
    if (!prefRes.ok) throw new Error("Failed to save preference.");

    setPushEnabled(false);
    setPushSuccess("Push notifications disabled.");
  }

  async function handleEmailToggle(enabled: boolean) {
    setEmailEnabled(enabled);
    setEmailSaving(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      const res = await fetch("/api/profile/email-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNotificationsEnabled: enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setEmailSuccess(enabled ? "Email notifications enabled." : "Email notifications disabled.");
    } catch (err) {
      setEmailEnabled(!enabled); // revert
      setEmailError(err instanceof Error ? err.message : "Failed to save. Try again.");
    } finally {
      setEmailSaving(false);
    }
  }

  function toggleTiming(mins: number) {
    setReminderTimings((prev) =>
      prev.includes(mins)
        ? prev.filter((m) => m !== mins)
        : [...prev, mins].sort((a, b) => b - a)
    );
    setReminderSuccess(null);
  }

  function addCustomTiming() {
    const n = parseInt(customMins.trim(), 10);
    if (!Number.isInteger(n) || n <= 0 || n > 10080) {
      setCustomMinsError("Enter a whole number between 1 and 10080.");
      return;
    }
    setCustomMinsError(null);
    setCustomMins("");
    if (!reminderTimings.includes(n)) {
      setReminderTimings((prev) => [...prev, n].sort((a, b) => b - a));
    }
    setReminderSuccess(null);
  }

  function removeTiming(mins: number) {
    setReminderTimings((prev) => prev.filter((m) => m !== mins));
    setReminderSuccess(null);
  }

  function resetToDefaults() {
    setReminderTimings(DEFAULT_REMINDER_TIMINGS_MINS);
    setReminderSuccess(null);
  }

  async function handleReminderSave() {
    setReminderError(null);
    setReminderSuccess(null);
    setReminderSaving(true);
    try {
      const res = await fetch("/api/profile/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timings: reminderTimings.length > 0 ? reminderTimings : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setReminderError(data?.message ?? "Could not save reminder preferences.");
        return;
      }
      setReminderSuccess(data?.message ?? "Reminder preferences saved.");
    } catch {
      setReminderError("Something went wrong. Please try again.");
    } finally {
      setReminderSaving(false);
    }
  }

  return (
    <section className="anim-rise space-y-8">

      <PageHeader eyebrow="Account" title="Settings" />

      {/* Account */}
      <div>
        <h2 className="label-caps mb-2.5">Account Details</h2>
        <div className="panel divide-y divide-white/[0.05] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-zinc-400">Name</p>
            <p className="text-sm font-medium text-zinc-100">{profile.fullName}</p>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-zinc-400">Email</p>
            <p className="truncate text-sm font-medium text-zinc-100">{email}</p>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-sm text-zinc-400">Password</p>
              {resetSent && (
                <p className="mt-1 text-xs text-teal-400">
                  Reset link sent to {email}. Check your inbox.
                </p>
              )}
              {resetError && <p className="mt-1 text-xs text-destructive">{resetError}</p>}
            </div>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={resetSending || resetSent}
              className="shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3.5 py-2 text-[13px] font-medium text-zinc-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resetSending ? "Sending…" : resetSent ? "Link sent" : "Reset password"}
            </button>
          </div>
        </div>
      </div>

      {/* Membership */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="label-caps">Membership</h2>
          <Link href="/dashboard/membership" className="text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300">Manage →</Link>
        </div>
        <div className="panel divide-y divide-white/[0.05] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-zinc-400">Plan</p>
            <div className="flex items-center gap-2.5">
              <p className="text-sm font-medium text-zinc-100">{membership.planName ?? "No active plan"}</p>
              {membership.statusLabel && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none ${membership.statusIsActive ? "border-white/[0.1] bg-white/[0.05] text-zinc-300" : "border-white/[0.06] text-zinc-500"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${membership.statusIsActive ? "bg-teal-400" : "bg-zinc-500"}`} />
                  {membership.statusLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-zinc-400">Member since</p>
            <p className="text-sm font-medium text-zinc-100 tabular-nums">{formatDate(membership.startedAt)}</p>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-zinc-400">Renews on</p>
            <p className="text-sm font-medium text-zinc-100 tabular-nums">{formatDate(membership.renewsAt)}</p>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="label-caps mb-2.5">Preferences</h2>
        <div className="panel px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-100">Measurement units</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {units === "metric" ? "Kilograms, kilometres, centimetres" : "Pounds, miles, inches"}
              </p>
              {unitsError && <p className="mt-1 text-xs text-destructive">{unitsError}</p>}
            </div>
            <div className="flex gap-0.5 rounded-lg border border-white/[0.09] bg-white/[0.03] p-0.5">
              {(["metric", "imperial"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => handleUnitsChange(u)}
                  disabled={unitsSaving}
                  className={`rounded-lg px-4 py-1.5 text-xs font-medium capitalize transition-colors duration-150 disabled:cursor-not-allowed ${
                    units === u
                      ? "bg-white/[0.08] text-zinc-50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div>
        <h2 className="label-caps mb-2.5">Appearance</h2>
        <AppearancePanel
          fullName={profile.fullName}
          initialAvatarDataUrl={profile.avatarDataUrl ?? null}
          initialPalette={profile.palette ?? null}
        />
      </div>

      {/* Notifications */}
      <div>
        <h2 className="label-caps mb-2.5">Notifications</h2>
        <div className="space-y-4">

          {/* Class reminder preferences */}
          <div className="panel p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-100">Class reminders</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  In-app notification before each booked class.
                </p>
              </div>
              {reminderTimings.length > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                  {reminderTimings.length} active
                </span>
              )}
            </div>

            {reminderError ? (
              <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {reminderError}
              </p>
            ) : null}
            {reminderSuccess ? (
              <p className="mb-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                {reminderSuccess}
              </p>
            ) : null}

            <p className="mb-2 text-sm font-medium">Remind me before class</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {PRESET_REMINDER_TIMINGS.map(({ mins, label }) => {
                const active = reminderTimings.includes(mins);
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => toggleTiming(mins)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="mb-2 text-sm font-medium">Custom reminder (minutes before class)</p>
            <div className="mb-1 flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10080}
                value={customMins}
                onChange={(e) => { setCustomMins(e.target.value); setCustomMinsError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addCustomTiming(); }
                }}
                placeholder="e.g. 120"
                className={`input-field flex-1 tabular-nums ${customMinsError ? "border-destructive" : ""}`}
              />
              <button
                type="button"
                onClick={addCustomTiming}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                Add
              </button>
            </div>
            {customMinsError ? (
              <p className="mb-3 text-xs text-destructive">{customMinsError}</p>
            ) : (
              <div className="mb-3" />
            )}

            {reminderTimings.length > 0 ? (
              <div className="mb-4">
                <p className="mb-2 text-xs text-muted-foreground">Active reminders</p>
                <div className="flex flex-wrap gap-2">
                  {reminderTimings.map((mins) => (
                    <span
                      key={mins}
                      className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary"
                    >
                      {formatTimingLabel(mins)}
                      <button
                        type="button"
                        onClick={() => removeTiming(mins)}
                        className="flex h-4 w-4 shrink-0 items-center justify-center text-primary/60 transition hover:text-primary"
                        aria-label={`Remove ${formatTimingLabel(mins)} reminder`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted-foreground">
                No reminders set — defaults (24 hr, 6 hr, 3 hr, 1 hr) will be used.
              </p>
            )}

            <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
              <button
                type="button"
                onClick={resetToDefaults}
                className="text-sm text-muted-foreground transition hover:text-foreground"
              >
                Use defaults
              </button>
              <button
                type="button"
                onClick={handleReminderSave}
                disabled={reminderSaving}
                className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reminderSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* Email notifications */}
          <div className="panel p-5">
            <p className="mb-1 text-sm font-medium text-zinc-100">Email notifications</p>
            <p className="mb-4 text-xs text-zinc-500">
              Receive emails for time-sensitive events like waitlist offers. In-app notifications are always sent regardless of this setting.
            </p>

            {emailError && (
              <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {emailError}
              </p>
            )}
            {emailSuccess && (
              <p className="mb-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                {emailSuccess}
              </p>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={emailEnabled}
              disabled={emailSaving}
              onClick={() => handleEmailToggle(!emailEnabled)}
              className="well flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition disabled:opacity-60"
            >
              <span className="text-sm">Email notifications</span>
              <span
                className={[
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
                  emailEnabled
                    ? "border-primary bg-primary"
                    : "border-border bg-muted",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                    emailEnabled ? "translate-x-4" : "translate-x-0.5",
                  ].join(" ")}
                />
              </span>
            </button>
          </div>

          {/* Push notifications */}
          {pushPermission !== "checking" && (
            <div className="panel p-5">
              <p className="mb-1 text-sm font-medium text-zinc-100">Push notifications</p>
              <p className="mb-4 text-xs text-zinc-500">
                Receive alerts on this device even when the app is in the background.
              </p>

              {pushError && (
                <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {pushError}
                </p>
              )}
              {pushSuccess && (
                <p className="mb-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  {pushSuccess}
                </p>
              )}

              {pushPermission === "unsupported" && (
                <p className="text-sm text-muted-foreground">
                  Push notifications are not supported in this browser.
                </p>
              )}

              {pushPermission === "denied" && (
                <p className="text-sm text-muted-foreground">
                  Push notifications are blocked. Enable them in your browser or OS settings, then reload this page.
                </p>
              )}

              {pushPermission === "default" && (
                <div className="well p-4">
                  <p className="mb-3 text-sm text-foreground">
                    Allow push notifications to receive alerts for waitlist offers and class reminders directly on this device.
                  </p>
                  <button
                    type="button"
                    disabled={pushWorking}
                    onClick={handleEnablePush}
                    className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pushWorking ? "Enabling…" : "Enable push notifications"}
                  </button>
                </div>
              )}

              {pushPermission === "granted" && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={pushEnabled}
                  disabled={pushWorking}
                  onClick={() => handleTogglePush(!pushEnabled)}
                  className="well flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition disabled:opacity-60"
                >
                  <span className="text-sm">Push notifications</span>
                  <span
                    className={[
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
                      pushEnabled
                        ? "border-primary bg-primary"
                        : "border-border bg-muted",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                        pushEnabled ? "translate-x-4" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

    </section>
  );
}
