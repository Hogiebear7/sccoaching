import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests under the limit", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("user-1", 5, 60_000, t0 + i).allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit and reports retry time", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, 60_000, t0 + i * 1000);
    }
    const blocked = checkRateLimit("user-1", 3, 60_000, t0 + 10_000);
    expect(blocked.allowed).toBe(false);
    // Oldest event at t0 leaves the window at t0 + 60s → 50s from now.
    expect(blocked.retryAfterSecs).toBe(50);
  });

  it("allows again once the window slides past old events", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, 60_000, t0);
    }
    expect(checkRateLimit("user-1", 3, 60_000, t0 + 1).allowed).toBe(false);
    expect(checkRateLimit("user-1", 3, 60_000, t0 + 60_001).allowed).toBe(true);
  });

  it("tracks users independently", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, 60_000, t0);
    }
    expect(checkRateLimit("user-1", 3, 60_000, t0 + 1).allowed).toBe(false);
    expect(checkRateLimit("user-2", 3, 60_000, t0 + 1).allowed).toBe(true);
  });
});
