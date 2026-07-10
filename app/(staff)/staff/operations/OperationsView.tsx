"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ClassCategoryRecord, JobRunRecord, SubscriptionStatus } from "@/lib/db";
import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_STYLE } from "@/lib/membership-status";
import { classCategoryLabel, formatRemainingSessions } from "@/lib/scheduling-status";
import type { ClassPressureSummary, MemberOperationalSummary } from "@/lib/staff-operations";

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

type FilterKey = "all" | "attention" | "active" | "pending" | "past_due" | "no_plan";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "active",    label: "Active" },
  { key: "pending",   label: "Pending" },
  { key: "past_due",  label: "Past due" },
  { key: "no_plan",   label: "No plan" },
];

function matchesFilter(member: MemberOperationalSummary, filter: FilterKey): boolean {
  switch (filter) {
    case "all":       return true;
    case "attention": return member.attentionReasons.length > 0;
    case "active":    return member.subscriptionStatus === "active";
    case "pending":   return member.subscriptionStatus === "pending";
    case "past_due":  return member.subscriptionStatus === "past_due";
    case "no_plan":
      return member.subscriptionStatus === null || member.subscriptionStatus === "inactive";
    default:          return true;
  }
}

export function OperationsView({
  members,
  classes,
  jobRuns,
  categories,
  deletedLabels,
}: {
  members: MemberOperationalSummary[];
  classes: ClassPressureSummary[];
  jobRuns: JobRunRecord[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((member) => {
      if (!matchesFilter(member, filter)) return false;
      if (!query) return true;
      return (
        member.email.toLowerCase().includes(query) ||
        (member.fullName ?? "").toLowerCase().includes(query)
      );
    });
  }, [members, search, filter]);

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

      {/* Upcoming classes */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Upcoming classes</h3>

        {classes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No upcoming classes scheduled.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {classes.map((classRecord) => (
              <div
                key={classRecord.classId}
                className="flex flex-col gap-2 well p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-xs text-muted-foreground">
                    {classRecord.date} · {classRecord.startTime}
                  </p>
                  <p className="text-sm font-medium">
                    {classRecord.title}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({classCategoryLabel(categories, classRecord.category, deletedLabels)})
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      classRecord.isFull
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {classRecord.bookedCount} of {classRecord.capacity} booked
                  </span>
                  {classRecord.waitlistCount > 0 ? (
                    <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold">
                      {classRecord.waitlistCount} waitlisted
                    </span>
                  ) : null}
                  <Link
                    href="/staff/classes"
                    className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                  >
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Members table */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Members</h3>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-xl border border-border bg-input px-4 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15 sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredMembers.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No members match this search/filter.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {filteredMembers.map((member) => (
              <Link
                key={member.userId}
                href={`/staff/members/${member.userId}`}
                className="block well p-4 transition hover:border-primary/30 hover:bg-accent/30"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {member.fullName ?? member.email}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {member.planName ?? "No plan selected"}
                      {member.subscriptionStatus ? (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${SUBSCRIPTION_STATUS_STYLE[member.subscriptionStatus as SubscriptionStatus]}`}
                        >
                          {SUBSCRIPTION_STATUS_LABEL[member.subscriptionStatus as SubscriptionStatus]}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatRemainingSessions(member.remainingSessions)}
                    </span>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      Readiness {member.latestReadinessScore ?? "—"}
                    </span>
                  </div>
                </div>

                {member.attentionReasons.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {member.attentionReasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
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
