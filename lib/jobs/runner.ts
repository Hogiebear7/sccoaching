import { randomUUID } from "crypto";

import { createJobRun, type JobRunRecord } from "@/lib/db";
import { ALL_JOBS } from "./registry";
import type { JobDefinition, JobOutcome } from "./types";

// Generous headroom over what should be sub-second local JSON-DB operations
// (observed job durations are single-digit-to-low-hundreds of ms) — this
// exists to bound a job that hangs on something with no timeout of its own,
// not to constrain a normally-fast one. A job doing real external I/O with a
// legitimately longer worst case overrides it via JobDefinition.timeoutMs.
const DEFAULT_JOB_TIMEOUT_MS = 15_000;

// The external scheduler calling /api/cron/run (GitHub Actions' curl, see
// .github/workflows/housekeeping.yml) caps its own wait at 180s. Staying
// comfortably under that turns "one job hangs → the whole request hangs
// forever → the scheduler sees a bare connection timeout with zero
// diagnostic information" into "that job reports a timeout error, the rest
// of the run still completes, and the response comes back with a record of
// exactly what happened" — this is what actually surfaced the missing
// per-job timeout in the first place (two consecutive housekeeping runs
// timed out in production with no indication of which job was responsible).
const GLOBAL_DEADLINE_MS = 150_000;

// Runs one job, times it, never lets it hang or throw past this point, and
// persists exactly what happened — the one place that turns a plain async
// function into an observable, recorded, time-bounded operation.
export async function runJob(
  job: JobDefinition,
  trigger: "cron" | "manual",
  timeoutMs: number = DEFAULT_JOB_TIMEOUT_MS
): Promise<JobOutcome> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  let status: "success" | "error";
  let summary: string;

  try {
    summary = await Promise.race([
      job.run(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s.`)),
          timeoutMs
        );
      }),
    ]);
    status = "success";
  } catch (error) {
    status = "error";
    summary = error instanceof Error ? error.message : "Unknown error.";
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAtMs;

  const record: JobRunRecord = {
    id: randomUUID(),
    jobName: job.name,
    status,
    summary,
    startedAt,
    finishedAt,
    durationMs,
    trigger,
  };

  createJobRun(record);

  return { jobName: job.name, status, summary, startedAt, finishedAt, durationMs };
}

// Runs every registered job in sequence (not in parallel — several jobs
// touch overlapping subscription/waitlist data, and sequential execution
// keeps behavior simple to reason about and test). One job failing doesn't
// stop the others from running. Each job's timeout is also capped by
// whatever's left of the overall deadline, so a run can never overshoot
// GLOBAL_DEADLINE_MS regardless of how many jobs are individually slow —
// once the budget's gone, remaining jobs are recorded as skipped rather
// than started.
export async function runAllJobs(trigger: "cron" | "manual"): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  const deadlineAtMs = Date.now() + GLOBAL_DEADLINE_MS;

  for (const job of ALL_JOBS) {
    const remainingMs = deadlineAtMs - Date.now();

    if (remainingMs <= 0) {
      const now = new Date().toISOString();
      const record: JobRunRecord = {
        id: randomUUID(),
        jobName: job.name,
        status: "error",
        summary: "Skipped — the housekeeping run's overall time budget was used up by earlier jobs.",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        trigger,
      };
      createJobRun(record);
      outcomes.push({
        jobName: job.name,
        status: record.status,
        summary: record.summary,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: record.durationMs,
      });
      continue;
    }

    const timeoutMs = Math.min(job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS, remainingMs);
    outcomes.push(await runJob(job, trigger, timeoutMs));
  }

  return outcomes;
}
