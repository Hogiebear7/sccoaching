import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockRunAllJobs } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockRunAllJobs: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
}));

vi.mock("@/lib/jobs/runner", () => ({
  runAllJobs: mockRunAllJobs,
}));

function makeRequest(headers: Record<string, string> = {}, cookie?: string) {
  return new NextRequest("http://localhost/api/cron/run", {
    method: "GET",
    headers: { ...headers, ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
  });
}

describe("GET /api/cron/run", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    mockFindUserById.mockReset();
    mockRunAllJobs.mockReset();
    mockRunAllJobs.mockResolvedValue([{ jobName: "test-job", status: "success", summary: "ok", startedAt: "now", finishedAt: "now", durationMs: 1 }]);
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a request with no auth at all", async () => {
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockRunAllJobs).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));

    expect(res.status).toBe(401);
    expect(mockRunAllJobs).not.toHaveBeenCalled();
  });

  it("accepts the correct bearer token and runs as cron", async () => {
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.trigger).toBe("cron");
    expect(mockRunAllJobs).toHaveBeenCalledWith("cron");
  });

  it("rejects an unconfigured CRON_SECRET even with a bearer header sent", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest({ authorization: "Bearer anything" }));

    expect(res.status).toBe(401);
  });

  it("accepts a staff session and runs as manual", async () => {
    delete process.env.CRON_SECRET;
    mockFindUserById.mockReturnValue({ id: "staff-1", email: "coach@example.com", role: "staff" });
    const cookie = signSession({ userId: "staff-1" });
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest({}, cookie));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.trigger).toBe("manual");
    expect(mockRunAllJobs).toHaveBeenCalledWith("manual");
  });

  it("rejects a member session", async () => {
    delete process.env.CRON_SECRET;
    mockFindUserById.mockReturnValue({ id: "member-1", email: "member@example.com", role: "member" });
    const cookie = signSession({ userId: "member-1" });
    const { GET } = await import("@/app/api/cron/run/route");

    const res = await GET(makeRequest({}, cookie));

    expect(res.status).toBe(401);
    expect(mockRunAllJobs).not.toHaveBeenCalled();
  });

  it("POST delegates to the same authorization and behavior", async () => {
    const { POST } = await import("@/app/api/cron/run/route");

    const res = await POST(makeRequest({ authorization: "Bearer test-secret" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.trigger).toBe("cron");
  });
});
