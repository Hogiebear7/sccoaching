import { randomUUID } from "crypto";

import { createJobRun, type JobRunRecord } from "@/lib/db";
import { ALL_JOBS } from "./registry";
import type { JobDefinition, JobOutcome } from "./types";

// Runs one job, times it, never lets it throw past this point, and
// persists exactly what happened — the one place that turns a plain async
// function into an observable, recorded operation.
export async function runJob(
  job: JobDefinition,
  trigger: "cron" | "manual"
): Promise<JobOutcome> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  let status: "success" | "error";
  let summary: string;

  try {
    summary = await job.run();
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
// stop the others from running.
export async function runAllJobs(trigger: "cron" | "manual"): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];

  for (const job of ALL_JOBS) {
    outcomes.push(await runJob(job, trigger));
  }

  return outcomes;
}
