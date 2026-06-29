import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateJobRun } = vi.hoisted(() => ({
  mockCreateJobRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createJobRun: mockCreateJobRun,
}));

const succeedingJob = {
  name: "succeeding-job",
  description: "Always succeeds.",
  run: vi.fn().mockResolvedValue("All good."),
};

const failingJob = {
  name: "failing-job",
  description: "Always throws.",
  run: vi.fn().mockRejectedValue(new Error("Boom")),
};

vi.mock("@/lib/jobs/registry", () => ({
  ALL_JOBS: [succeedingJob, failingJob],
}));

describe("runJob", () => {
  beforeEach(() => {
    mockCreateJobRun.mockReset();
    succeedingJob.run.mockClear();
    failingJob.run.mockClear();
  });

  it("records a successful run", async () => {
    const { runJob } = await import("@/lib/jobs/runner");

    const outcome = await runJob(succeedingJob, "manual");

    expect(outcome.status).toBe("success");
    expect(outcome.summary).toBe("All good.");
    expect(mockCreateJobRun).toHaveBeenCalledTimes(1);
    const saved = mockCreateJobRun.mock.calls[0][0];
    expect(saved.jobName).toBe("succeeding-job");
    expect(saved.status).toBe("success");
    expect(saved.trigger).toBe("manual");
    expect(typeof saved.durationMs).toBe("number");
  });

  it("catches a thrown error and records it instead of propagating", async () => {
    const { runJob } = await import("@/lib/jobs/runner");

    const outcome = await runJob(failingJob, "cron");

    expect(outcome.status).toBe("error");
    expect(outcome.summary).toBe("Boom");
    const saved = mockCreateJobRun.mock.calls[0][0];
    expect(saved.status).toBe("error");
    expect(saved.trigger).toBe("cron");
  });
});

describe("runAllJobs", () => {
  beforeEach(() => {
    mockCreateJobRun.mockReset();
    succeedingJob.run.mockClear();
    failingJob.run.mockClear();
  });

  it("runs every registered job and keeps going after a failure", async () => {
    const { runAllJobs } = await import("@/lib/jobs/runner");

    const outcomes = await runAllJobs("manual");

    expect(outcomes).toHaveLength(2);
    expect(succeedingJob.run).toHaveBeenCalledTimes(1);
    expect(failingJob.run).toHaveBeenCalledTimes(1);
    expect(outcomes[0].status).toBe("success");
    expect(outcomes[1].status).toBe("error");
    expect(mockCreateJobRun).toHaveBeenCalledTimes(2);
  });
});
