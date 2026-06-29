import type { JobStatus } from "@/lib/db";

// A job is just a plain async function with a stable name — explicit,
// directly callable, and trivially unit-testable without any scheduler
// machinery involved. The runner (lib/jobs/runner.ts) is what adds timing,
// error handling, and persistence around a call to run().
export interface JobDefinition {
  name: string;
  description: string;
  run: () => Promise<string>;
}

export interface JobOutcome {
  jobName: string;
  status: JobStatus;
  summary: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
