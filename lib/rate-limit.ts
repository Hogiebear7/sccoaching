// Minimal in-memory sliding-window rate limiter.
//
// PROCESS-LOCAL, NOT DISTRIBUTED. State lives in this Node process only and resets
// on restart. That is acceptable for this app's single long-lived process (see the
// README's Deployment section) and for an abuse/spend guard, but it is NOT
// distributed protection: two instances would each keep their own counters, so
// swap this for a shared store if the app is ever scaled horizontally.
//
// Bounded memory: keys can be attacker-controlled (an unauthenticated email, a
// client IP), so the store is capped three ways:
//   * a key longer than MAX_RATE_LIMIT_KEY_LENGTH is replaced by its SHA-256, so a
//     giant key cannot be used to bloat memory;
//   * a bucket holds at most `limit` timestamps (blocked requests are not recorded);
//   * at most MAX_RATE_LIMIT_BUCKETS buckets exist. Expired buckets are swept at
//     most once per SWEEP_INTERVAL_MS, and if the store is still full the
//     least-recently-used bucket is evicted to make room. The trade-off, accepted
//     deliberately: an attacker who can present more than MAX_RATE_LIMIT_BUCKETS
//     distinct keys within one window can push OLD keys out and reset their counters
//     — bounded memory is chosen over unbounded state.
import { createHash } from "crypto";

interface WindowState {
  timestamps: number[];
  windowMs: number;
}

export const MAX_RATE_LIMIT_BUCKETS = 10_000;
export const MAX_RATE_LIMIT_KEY_LENGTH = 128;
const SWEEP_INTERVAL_MS = 60_000;

// Map iteration order is insertion order; every check re-inserts its bucket, so the
// first entry is always the least recently used.
const buckets = new Map<string, WindowState>();
let lastSweepAt = 0;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest counted event leaves the window (when blocked). */
  retryAfterSecs: number;
}

function boundedKey(key: string): string {
  if (key.length <= MAX_RATE_LIMIT_KEY_LENGTH) return key;
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

// Drop every bucket whose newest event has left its window.
function sweepExpired(now: number): void {
  for (const [key, state] of buckets) {
    const newest = state.timestamps[state.timestamps.length - 1];
    if (newest === undefined || newest + state.windowMs <= now) buckets.delete(key);
  }
  lastSweepAt = now;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const bucketKey = boundedKey(key);

  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) sweepExpired(now);

  const existing = buckets.get(bucketKey);
  if (existing) {
    buckets.delete(bucketKey); // re-inserted below, marking it most recently used
  } else {
    while (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  const state: WindowState = existing ?? { timestamps: [], windowMs };
  state.windowMs = windowMs;
  const cutoff = now - windowMs;
  state.timestamps = state.timestamps.filter((t) => t > cutoff);

  if (state.timestamps.length >= limit) {
    buckets.set(bucketKey, state);
    const oldest = state.timestamps[0];
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  state.timestamps.push(now);
  buckets.set(bucketKey, state);
  return { allowed: true, retryAfterSecs: 0 };
}

// Test hooks.
export function resetRateLimits() {
  buckets.clear();
  lastSweepAt = 0;
}

export function getRateLimitBucketCount(): number {
  return buckets.size;
}
