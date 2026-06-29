"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ClassCategoryRecord, JobRunRecord, SubscriptionStatus } from "@/lib/db";
import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_STYLE } from "@/lib/membership-status";
import { classCategoryLabel, formatRemainingSessions } from "@/lib/scheduling-status";
import type { ClassPressureSummary, MemberOperationalSummary } from "@/lib/staff-operations";

// Locale-default toLocaleString() can render "23/6/2026" — genuinely
// ambiguous between 23 Jun and (in a US-formatted locale) an invalid month
// 23. Always show an unambiguous month name instead.
function formatRunTimestamp(isoDate: string): string {
  return new Date(isoDate).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type FilterKey = "all" | "attention" | "active" | "pending" | "past_due" | "no_plan";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "past_due", label: "Past due" },
  { key: "no_plan", label: "No plan" },
];

function matchesFilter(member: MemberOperationalSummary, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return member.attentionReasons.length > 0;
    case "active":
      return member.subscriptionStatus === "active";
    case "pending":
      return member.subscriptionStatus === "pending";
    case "past_due":
      return member.subscriptionStatus === "past_due";
    case "no_plan":
      return member.subscriptionStatus === null || member.subscriptionStatus === "inactive";
    default:
      return true;
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
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Operations</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Staff overview</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Membership state, session usage, readiness, and class pressure at a glance.
        </p>
      </div>

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

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-zinc-50">Background jobs</h3>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={isRunning}
            className="self-start rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            {isRunning ? "Running…" : "Run housekeeping now"}
          </button>
        </div>

        {runError ? (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {runError}
          </p>
        ) : null}

        {runMessage ? (
          <p className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {runMessage}
          </p>
        ) : null}

        {latestRunPerJob.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">
            No housekeeping jobs have run yet. See <code>docs/scheduler.md</code> for how to schedule
            them automatically, or use the button above to run them now.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {latestRunPerJob.map((run) => (
              <div
                key={run.jobName}
                className="flex flex-col gap-1 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-200">{run.jobName}</p>
                  <p className="mt-1 text-xs text-zinc-500">{run.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      run.status === "success"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {run.status === "success" ? "OK" : "Error"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatRunTimestamp(run.startedAt)} · {run.trigger}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Upcoming classes</h3>

        {classes.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No upcoming classes scheduled.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {classes.map((classRecord) => (
              <div
                key={classRecord.classId}
                className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm text-zinc-500">
                    {classRecord.date} · {classRecord.startTime}
                  </p>
                  <p className="text-sm font-medium text-zinc-200">
                    {classRecord.title}{" "}
                    <span className="text-xs font-normal text-zinc-500">
                      ({classCategoryLabel(categories, classRecord.category, deletedLabels)})
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      classRecord.isFull
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {classRecord.bookedCount} of {classRecord.capacity} booked
                  </span>
                  {classRecord.waitlistCount > 0 ? (
                    <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
                      {classRecord.waitlistCount} waitlisted
                    </span>
                  ) : null}
                  <Link
                    href="/staff/classes"
                    className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500"
                  >
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Members</h3>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-teal-500 sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  filter === f.key
                    ? "bg-teal-500 text-black"
                    : "border border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredMembers.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">No members match this search/filter.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {filteredMembers.map((member) => (
              <Link
                key={member.userId}
                href={`/staff/members/${member.userId}`}
                className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-600"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {member.fullName ?? member.email}
                    </p>
                    <p className="text-xs text-zinc-500">{member.email}</p>
                    <p className="mt-2 text-sm text-zinc-400">
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
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      {formatRemainingSessions(member.remainingSessions)}
                    </span>
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
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
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-3 text-2xl font-bold text-zinc-50">{value}</p>
      <p className="mt-2 text-sm text-zinc-400">{detail}</p>
    </div>
  );
}
