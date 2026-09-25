// lib/rate-limit.ts — the hardening added on top of the existing sliding-window
// limiter: bounded memory (key length, bucket count, sweep + LRU eviction) and the
// original semantics preserved. Process-local by design; nothing here is
// distributed protection. Fake timestamps are passed explicitly, so no timers run.
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_RATE_LIMIT_BUCKETS,
  MAX_RATE_LIMIT_KEY_LENGTH,
  checkRateLimit,
  getRateLimitBucketCount,
  resetRateLimits,
} from "@/lib/rate-limit";

const T0 = 1_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeEach(() => resetRateLimits());

describe("original semantics are preserved", () => {
  it("allows requests under the limit, blocks the first one over it, and reports when to retry", () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, HOUR, T0 + i * 1000).allowed).toBe(true);

    const blocked = checkRateLimit("k", 3, HOUR, T0 + 10_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSecs).toBe(3590); // the oldest event (T0) leaves the window 3590s from now
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("a", 3, HOUR, T0);

    expect(checkRateLimit("a", 3, HOUR, T0 + 1).allowed).toBe(false);
    expect(checkRateLimit("b", 3, HOUR, T0 + 1).allowed).toBe(true);
  });

  it("allows again once the window has passed (expiry / reset)", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("k", 3, HOUR, T0);

    expect(checkRateLimit("k", 3, HOUR, T0 + HOUR - 1).allowed).toBe(false);
    expect(checkRateLimit("k", 3, HOUR, T0 + HOUR + 1).allowed).toBe(true);
  });

  it("a blocked request is not recorded, so it does not extend the block", () => {
    for (let i = 0; i < 2; i++) checkRateLimit("k", 2, HOUR, T0);
    for (let i = 0; i < 50; i++) checkRateLimit("k", 2, HOUR, T0 + 1000 + i); // hammering while blocked

    expect(checkRateLimit("k", 2, HOUR, T0 + HOUR + 1).allowed).toBe(true);
  });

  it("resetRateLimits clears everything", () => {
    checkRateLimit("k", 1, HOUR, T0);
    resetRateLimits();

    expect(getRateLimitBucketCount()).toBe(0);
    expect(checkRateLimit("k", 1, HOUR, T0).allowed).toBe(true);
  });
});

describe("bounded memory", () => {
  it("never holds more than MAX_RATE_LIMIT_BUCKETS buckets, however many distinct keys arrive", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 2_500; i++) checkRateLimit(`attacker-key-${i}`, 5, HOUR, T0);

    expect(getRateLimitBucketCount()).toBe(MAX_RATE_LIMIT_BUCKETS);
  });

  it("a bucket holds at most `limit` timestamps: hammering one key does not grow it", () => {
    for (let i = 0; i < 5_000; i++) checkRateLimit("one-key", 3, HOUR, T0 + i);

    expect(getRateLimitBucketCount()).toBe(1);
    // Still blocked and still recovers exactly one window after the 3rd (last recorded) event.
    expect(checkRateLimit("one-key", 3, HOUR, T0 + 2).allowed).toBe(false);
    expect(checkRateLimit("one-key", 3, HOUR, T0 + 2 + HOUR + 1).allowed).toBe(true);
  });

  it("at capacity the LEAST-recently-used bucket is evicted, not a recently used one", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) checkRateLimit(`k-${i}`, 1, HOUR, T0);
    checkRateLimit("k-0", 1, HOUR, T0 + 1); // touch the oldest key: now most recently used (and blocked)

    checkRateLimit("brand-new-key", 1, HOUR, T0 + 2); // forces one eviction

    expect(getRateLimitBucketCount()).toBe(MAX_RATE_LIMIT_BUCKETS);
    expect(checkRateLimit("k-0", 1, HOUR, T0 + 3).allowed).toBe(false); // survived, still blocked
    expect(checkRateLimit("k-1", 1, HOUR, T0 + 3).allowed).toBe(true); // the LRU one was evicted, so it started fresh
  });

  it("expired buckets are swept out once the sweep interval has passed", () => {
    for (let i = 0; i < 500; i++) checkRateLimit(`short-${i}`, 5, 1_000, T0); // 1s window
    expect(getRateLimitBucketCount()).toBe(500);

    checkRateLimit("trigger", 5, 1_000, T0 + 2 * MIN);

    expect(getRateLimitBucketCount()).toBe(1); // only the new key remains
  });

  it("the sweep never removes a bucket that is still inside its window", () => {
    for (let i = 0; i < 20; i++) checkRateLimit(`live-${i}`, 1, HOUR, T0);

    checkRateLimit("trigger", 1, HOUR, T0 + 2 * MIN); // well past the sweep interval, well inside the window

    expect(getRateLimitBucketCount()).toBe(21);
    expect(checkRateLimit("live-0", 1, HOUR, T0 + 2 * MIN + 1).allowed).toBe(false); // still limited
  });

  it("a very long key is bounded: it is hashed, stays independent of other long keys, and is one bucket", () => {
    const longA = `login:${"a".repeat(1_000_000)}`; // 1 MB, e.g. a giant unauthenticated email
    const longB = `login:${"a".repeat(999_999)}b`;
    expect(longA.length).toBeGreaterThan(MAX_RATE_LIMIT_KEY_LENGTH);

    for (let i = 0; i < 3; i++) expect(checkRateLimit(longA, 3, HOUR, T0).allowed).toBe(true);

    expect(checkRateLimit(longA, 3, HOUR, T0).allowed).toBe(false); // same long key still counts together
    expect(checkRateLimit(longB, 3, HOUR, T0).allowed).toBe(true); // a different long key is independent
    expect(getRateLimitBucketCount()).toBe(2);
  });

  it("a key exactly at the length limit is used as-is (two of them stay distinct)", () => {
    const a = "x".repeat(MAX_RATE_LIMIT_KEY_LENGTH);
    const b = `${"x".repeat(MAX_RATE_LIMIT_KEY_LENGTH - 1)}y`;

    checkRateLimit(a, 1, HOUR, T0);

    expect(checkRateLimit(a, 1, HOUR, T0).allowed).toBe(false);
    expect(checkRateLimit(b, 1, HOUR, T0).allowed).toBe(true);
  });
});
