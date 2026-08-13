"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type {
  ClassCategoryRecord,
  JobRunRecord,
  ReadinessAlertSettings,
  TransactionalEmailSettings,
  TransactionalEmailType,
} from "@/lib/db";
import type { ClassPressureSummary, MemberOperationalSummary } from "@/lib/staff-operations";
import { OperationsCalendar } from "./OperationsCalendar";

// Locale and time zone must be pinned: this renders during SSR, and any
// difference between the server's and browser's defaults (locale ordering
// or tz offset) produces a hydration mismatch. en-US matches the app's
// other date formatting; UTC is labeled so staff know the zone.
const RUN_TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatRunTimestamp(isoDate: string): string {
  return RUN_TIMESTAMP_FORMAT.format(new Date(isoDate));
}

export type ClassTypeRow = {
  id: string;
  name: string;
  slug: string;
  classCount: number;
  packageCount: number;
};

export function OperationsView({
  members,
  classes,
  jobRuns,
  categories,
  deletedLabels,
  classTypes,
  emailSettings,
  readinessAlertSettings,
}: {
  members: MemberOperationalSummary[];
  classes: ClassPressureSummary[];
  jobRuns: JobRunRecord[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  classTypes: ClassTypeRow[];
  emailSettings: TransactionalEmailSettings;
  readinessAlertSettings: ReadinessAlertSettings;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const attentionCount = members.filter((m) => m.attentionReasons.length > 0).length;
  const fullClasses = classes.filter((c) => c.isFull);
  const waitlistedClasses = classes.filter((c) => c.waitlistCount > 0);

  const latestRunPerJob = useMemo(() => {
    const seen = new Map<string, JobRunRecord>();
    for (const run of jobRuns) {
      if (!seen.has(run.jobName)) seen.set(run.jobName, run);
    }
    return Array.from(seen.values());
  }, [jobRuns]);

  async function handleRunNow() {
    setIsRunning(true);
    setRunError(null);
    setRunMessage(null);

    try {
      const res = await fetch("/api/cron/run", { method: "POST" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setRunError(data?.message ?? "Could not run housekeeping jobs.");
        return;
      }

      const failures = (data.outcomes ?? []).filter((o: { status: string }) => o.status === "error");
      setRunMessage(
        failures.length > 0
          ? `Ran ${data.outcomes.length} jobs — ${failures.length} failed. See details below.`
          : `Ran ${data.outcomes.length} jobs successfully.`
      );
      router.refresh();
    } catch {
      setRunError("Something went wrong. Please try again.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Staff overview</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Membership state, session usage, readiness, and class pressure at a glance.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryStat label="Members" value={String(members.length)} detail="Total member accounts." />
        <SummaryStat
          label="Needs attention"
          value={String(attentionCount)}
          detail="Lapsed, past due, no plan, no sessions, or awaiting a reply."
        />
        <SummaryStat
          label="Class pressure"
          value={String(fullClasses.length)}
          detail={`${fullClasses.length} full · ${waitlistedClasses.length} with a waitlist.`}
        />
      </div>

      {/* Background jobs */}
      <div className="panel p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold">Background jobs</h3>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={isRunning}
            className="self-start btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            {isRunning ? "Running…" : "Run housekeeping now"}
          </button>
        </div>

        {runError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {runError}
          </p>
        ) : null}

        {runMessage ? (
          <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            {runMessage}
          </p>
        ) : null}

        {latestRunPerJob.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No housekeeping jobs have run yet. See <code>docs/scheduler.md</code> for how to
            schedule them automatically, or use the button above to run them now.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {latestRunPerJob.map((run) => (
              <div
                key={run.jobName}
                className="flex flex-col gap-1 well p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{run.jobName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{run.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      run.status === "success"
                        ? "bg-primary/15 text-primary"
                        : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {run.status === "success" ? "OK" : "Error"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRunTimestamp(run.startedAt)} · {run.trigger}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Class types */}
      <ClassTypesManager classTypes={classTypes} />

      {/* Transactional email toggles */}
      <EmailSettingsManager settings={emailSettings} />

      {/* Readiness alert threshold */}
      <ReadinessAlertSettingsManager settings={readinessAlertSettings} />

      {/* Upcoming classes — condensed month calendar instead of a flat list */}
      <OperationsCalendar classes={classes} categories={categories} deletedLabels={deletedLabels} />
    </div>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel rounded-3xl p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-display text-[28px] tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

// Class-type (class category) management: create, rename, and guarded delete.
// The list shows live usage so it's clear what's safe to remove; the delete
// route blocks removal while any class or package still references the slug.
function ClassTypesManager({ classTypes }: { classTypes: ClassTypeRow[] }) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function post(url: string, body: unknown, key: string) {
    setBusyId(key);
    setBanner(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      setBanner({ ok: res.ok, message: data?.message ?? (res.ok ? "Saved." : "Something went wrong.") });
      if (res.ok) {
        setEditingId(null);
        setConfirmId(null);
        setNewName("");
        router.refresh();
      }
    } catch {
      setBanner({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Class types</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Categories used when scheduling classes and setting package eligibility. A type can&apos;t be
        deleted while classes or packages still use it.
      </p>

      {banner ? (
        <p
          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            banner.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      {/* Create */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) post("/api/staff/categories", { name: newName.trim() }, "new");
        }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New class type name"
          aria-label="New class type name"
          className="flex-1 input-field px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busyId === "new" || !newName.trim()}
          className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyId === "new" ? "Adding…" : "Add class type"}
        </button>
      </form>

      {/* List */}
      <div className="mt-4 space-y-2">
        {classTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No class types yet — add one above.</p>
        ) : (
          classTypes.map((ct) => {
            const inUse = ct.classCount > 0 || ct.packageCount > 0;
            const usage =
              inUse
                ? [
                    ct.classCount > 0 ? `${ct.classCount} class${ct.classCount === 1 ? "" : "es"}` : null,
                    ct.packageCount > 0 ? `${ct.packageCount} package${ct.packageCount === 1 ? "" : "s"}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Not in use";
            return (
              <div key={ct.id} className="well flex flex-wrap items-center justify-between gap-3 p-3">
                {editingId === ct.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editName.trim()) post("/api/staff/categories", { id: ct.id, name: editName.trim() }, ct.id);
                    }}
                    className="flex flex-1 flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label={`Rename ${ct.name}`}
                      className="flex-1 input-field px-3 py-1.5 text-sm"
                    />
                    <button type="submit" disabled={busyId === ct.id || !editName.trim()} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-accent">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {ct.name}
                        <span className="font-mono text-[11px] text-muted-foreground">{ct.slug}</span>
                      </p>
                      <p className={`text-[11px] ${inUse ? "text-muted-foreground" : "text-muted-foreground/60"}`}>{usage}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(ct.id);
                          setEditName(ct.name);
                          setConfirmId(null);
                        }}
                        className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        Rename
                      </button>
                      {confirmId === ct.id ? (
                        <>
                          <button type="button" disabled={busyId === ct.id} onClick={() => post("/api/staff/categories/delete", { id: ct.id }, ct.id)} className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-60">
                            Confirm
                          </button>
                          <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-accent">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={inUse}
                          title={inUse ? "In use — reassign or remove references first." : undefined}
                          onClick={() => setConfirmId(ct.id)}
                          className="rounded-lg border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground/50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const EMAIL_TOGGLES: { type: TransactionalEmailType; label: string; description: string }[] = [
  {
    type: "bookingConfirmation",
    label: "Booking confirmation",
    description: "Sent when a member books a class or accepts a waitlist offer.",
  },
  {
    type: "bookingCancellation",
    label: "Booking cancellation",
    description: "Sent when a member cancels their own booking.",
  },
  {
    type: "classCancelled",
    label: "Class cancelled by staff",
    description: "Sent to booked members when you delete a class.",
  },
  {
    type: "classReminder",
    label: "Class reminder",
    description: "Sent ahead of a booked class. In-app reminders are unaffected.",
  },
];

function EmailSettingsManager({ settings }: { settings: TransactionalEmailSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<TransactionalEmailSettings>(settings);
  const [busy, setBusy] = useState<TransactionalEmailType | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);

  async function toggle(type: TransactionalEmailType, enabled: boolean) {
    setBusy(type);
    setBanner(null);
    setValues((prev) => ({ ...prev, [type]: enabled })); // optimistic
    try {
      const res = await fetch("/api/staff/settings/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setValues((prev) => ({ ...prev, [type]: !enabled })); // revert
        setBanner({ ok: false, message: data?.message ?? "Something went wrong." });
        return;
      }
      if (data?.settings) setValues(data.settings);
      setBanner({ ok: true, message: data?.message ?? "Saved." });
      router.refresh();
    } catch {
      setValues((prev) => ({ ...prev, [type]: !enabled })); // revert
      setBanner({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Transactional emails</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Turn optional member emails on or off. In-app notifications are unaffected, and
        essential account and billing emails always send.
      </p>

      {banner ? (
        <p
          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            banner.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      <div className="mt-4 divide-y divide-border/60">
        {EMAIL_TOGGLES.map(({ type, label, description }) => {
          const on = values[type];
          return (
            <div key={type} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${label} email`}
                disabled={busy === type}
                onClick={() => toggle(type, !on)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                  on ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    on ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReadinessAlertSettingsManager({ settings }: { settings: ReadinessAlertSettings }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [threshold, setThreshold] = useState(String(settings.threshold));
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(next: { enabled: boolean; threshold: number }) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch("/api/staff/settings/readiness-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({ ok: false, message: data?.message ?? "Something went wrong." });
        return;
      }
      setBanner({ ok: true, message: data?.message ?? "Saved." });
      router.refresh();
    } catch {
      setBanner({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(next: boolean) {
    setEnabled(next);
    const parsedThreshold = Number(threshold);
    save({ enabled: next, threshold: Number.isFinite(parsedThreshold) ? parsedThreshold : settings.threshold });
  }

  function handleThresholdBlur() {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setThreshold(String(settings.threshold));
      return;
    }
    save({ enabled, threshold: parsed });
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Readiness alerts</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        When a member logs a readiness score below this threshold, every staff account gets
        notified so their session can be adjusted ahead of time.
      </p>

      {banner ? (
        <p
          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            banner.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Alert staff on low readiness</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Off by default.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Alert staff on low readiness"
          disabled={busy}
          onClick={() => handleToggle(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <label htmlFor="readiness-threshold" className="text-sm font-medium text-foreground">
          Threshold
        </label>
        <input
          id="readiness-threshold"
          type="number"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          onBlur={handleThresholdBlur}
          disabled={busy || !enabled}
          className="w-20 rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
        />
        <span className="text-xs text-muted-foreground">out of 100 — scores below this alert staff.</span>
      </div>
    </div>
  );
}
