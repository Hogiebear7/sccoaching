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

// The run lease is exercised against real processes in __tests__/datastore/shared-state.test.ts; here it is a stand-in so the runner's own behaviour is what is tested.
const lease = vi.hoisted(() => ({ claim: vi.fn(() => "lease-1" as string | null), release: vi.fn() }));
vi.mock("@/lib/jobs/lease", () => ({
  claimJobRunLease: lease.claim,
  releaseJobRunLease: lease.release,
  JobRunInProgressError: class JobRunInProgressError extends Error {},
}));

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

  it("times out a job that never resolves instead of hanging forever", async () => {
    const { runJob } = await import("@/lib/jobs/runner");

    const hangingJob = {
      name: "hanging-job",
      description: "Never resolves.",
      run: () => new Promise<string>(() => {}),
    };

    const outcome = await runJob(hangingJob, "cron", 10);

    expect(outcome.status).toBe("error");
    expect(outcome.summary).toBe("Timed out after 0s.");
  });
});

describe("runAllJobs", () => {
  beforeEach(() => {
    lease.claim.mockClear();
    lease.release.mockClear();
    lease.claim.mockReturnValue("lease-1");
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
    expect(lease.claim).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledWith("lease-1");
  });

  it("runs nothing and throws JobRunInProgressError when another run holds the lease", async () => {
    lease.claim.mockReturnValueOnce(null);
    const { runAllJobs } = await import("@/lib/jobs/runner");
    const { JobRunInProgressError } = await import("@/lib/jobs/lease");

    await expect(runAllJobs("cron")).rejects.toBeInstanceOf(JobRunInProgressError);
    expect(succeedingJob.run).not.toHaveBeenCalled();
    expect(mockCreateJobRun).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled(); // it never held it
  });

  it("releases the lease even when the run throws", async () => {
    mockCreateJobRun.mockImplementationOnce(() => {
      throw new Error("datastore write failed");
    });
    const { runAllJobs } = await import("@/lib/jobs/runner");

    await expect(runAllJobs("manual")).rejects.toThrow("datastore write failed");
    expect(lease.release).toHaveBeenCalledWith("lease-1");
  });
});
