// Minimal in-memory sliding-window rate limiter.
//
// TWO BACKINGS, same algorithm.
//   * Process-local (the default in development and tests): state lives in this Node process only and resets on restart.
//   * SHARED across processes on one host (the default when NODE_ENV=production, override with SANDC_RATE_LIMIT_SHARED=0 or =1): the counters live in a small side file
//     beside db.json (rate-limits.json), read and written under the datastore's cross-process lock, so N server processes enforce ONE limit instead of N times the limit.
//     If that file or lock cannot be used (for example the lock wait runs out), the check FALLS BACK to the process-local counters and logs it: a login is never
//     refused only because the shared store was busy.
//   It is still single-HOST protection; two hosts would each keep their own file.
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
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

import { replaceFileAtomically, withFileLock } from "@/lib/datastore/core";
import { dataDirectory } from "@/lib/db";

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

function sharedMode(): boolean {
  const v = process.env.SANDC_RATE_LIMIT_SHARED;
  if (v === "1") return true;
  if (v === "0") return false;
  return process.env.NODE_ENV === "production";
}

const SHARED_FILE_VERSION = 1;
const sharedFile = () => path.join(dataDirectory(), "rate-limits.json");

function checkShared(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const file = sharedFile();
  return withFileLock(file, () => {
    const store = new Map<string, WindowState>();
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (raw?.v === SHARED_FILE_VERSION && raw.buckets && typeof raw.buckets === "object") {
        for (const [k, v] of Object.entries(raw.buckets as Record<string, { t?: unknown; w?: unknown }>)) {
          if (Array.isArray(v?.t) && typeof v?.w === "number") store.set(k, { timestamps: v.t.filter((n): n is number => typeof n === "number"), windowMs: v.w });
        }
      }
    } catch {
      // missing or unreadable counters start empty: rate-limit state is disposable
    }
    const result = decide(store, key, limit, windowMs, now, true);
    if (result.allowed) {
      const out: Record<string, { t: number[]; w: number }> = {};
      for (const [k, v] of store) out[k] = { t: v.timestamps, w: v.windowMs };
      replaceFileAtomically(file, JSON.stringify({ v: SHARED_FILE_VERSION, buckets: out }));
    }
    return result;
  });
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  if (sharedMode()) {
    try {
      return checkShared(key, limit, windowMs, now);
    } catch (e) {
      console.error("[rate-limit] shared counters unavailable, using this process's own counters for this check:", e instanceof Error ? e.message : e);
    }
  }
  return decide(buckets, key, limit, windowMs, now, false);
}

// The algorithm, against whichever store is passed in. `sweepAlways` is true for the shared file (swept on every write, it must stay small); the in-memory store
// sweeps at most once per SWEEP_INTERVAL_MS.
function decide(store: Map<string, WindowState>, key: string, limit: number, windowMs: number, now: number, sweepAlways: boolean): RateLimitResult {
  const bucketKey = boundedKey(key);

  if (sweepAlways) {
    for (const [k, st] of store) {
      const newest = st.timestamps[st.timestamps.length - 1];
      if (newest === undefined || newest + st.windowMs <= now) store.delete(k);
    }
  } else if (now - lastSweepAt >= SWEEP_INTERVAL_MS) sweepExpired(now);

  const existing = store.get(bucketKey);
  if (existing) {
    store.delete(bucketKey); // re-inserted below, marking it most recently used
  } else {
    while (store.size >= MAX_RATE_LIMIT_BUCKETS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  const state: WindowState = existing ?? { timestamps: [], windowMs };
  state.windowMs = windowMs;
  const cutoff = now - windowMs;
  state.timestamps = state.timestamps.filter((t) => t > cutoff);

  if (state.timestamps.length >= limit) {
    store.set(bucketKey, state);
    const oldest = state.timestamps[0];
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  state.timestamps.push(now);
  store.set(bucketKey, state);
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
