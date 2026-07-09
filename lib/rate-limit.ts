// Minimal in-memory sliding-window rate limiter.
//
// Suitable for this app's single-process deployment; swap for a shared store
// if the app is ever scaled horizontally. State is per-process and resets on
// restart, which is acceptable for a spend/abuse guard on the AI chat.

interface WindowState {
  timestamps: number[];
}

const buckets = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest counted event leaves the window (when blocked). */
  retryAfterSecs: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const state = buckets.get(key) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  state.timestamps = state.timestamps.filter((t) => t > cutoff);

  if (state.timestamps.length >= limit) {
    buckets.set(key, state);
    const oldest = state.timestamps[0];
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  state.timestamps.push(now);
  buckets.set(key, state);
  return { allowed: true, retryAfterSecs: 0 };
}

// Test hook — clears all limiter state.
export function resetRateLimits() {
  buckets.clear();
}
