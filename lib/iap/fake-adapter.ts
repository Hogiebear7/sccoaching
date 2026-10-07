// An in-memory Google Play adapter for tests and the local end-to-end harness. It never makes a
// network call and never reads a credential. It exists in lib/ (not __tests__/) so the PR 6 harness and
// any future staging smoke test can use the same fake, but nothing selects it by configuration:
// it only takes effect when code calls setPlayAdapterForTesting(new FakePlayAdapter()).
//
// Realism it provides, because the service's correctness depends on it:
//  - a snapshot is CAPTURED when fetchSubscription is called, so a gated (slow) call returns the state
//    as it was when issued, which is exactly how an out-of-order provider response behaves;
//  - programmable failures by code, once or N times;
//  - a call log, so tests can assert what was and was not sent to the provider.
// Fake tokens only. Do not put a real purchase token in a test.

import { mapGooglePlaySubscriptionState } from "@/lib/providers/google-play";

import { isRetryableProviderError, type AdapterFailure, type MappedState, type PlayAdapter, type ProviderErrorCode, type ProviderSubscriptionSnapshot } from "./adapter";

export const FAKE_PACKAGE_NAME = "com.example.fake.app";

export function fakeSnapshot(over: Partial<ProviderSubscriptionSnapshot> = {}): ProviderSubscriptionSnapshot {
  return {
    state: "SUBSCRIPTION_STATE_ACTIVE",
    productId: "app_subscription",
    basePlanId: "monthly",
    orderId: "GPA.fake-0001",
    linkedPurchaseToken: null,
    startTimeMillis: Date.now() - 86_400_000,
    expiryTimeMillis: Date.now() + 29 * 86_400_000,
    autoRenewing: true,
    acknowledged: false,
    accountBinding: null,
    ...over,
  };
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

export class FakePlayAdapter implements PlayAdapter {
  readonly name = "fake";
  configured = true;
  packageName: string | null = FAKE_PACKAGE_NAME;

  private snapshots = new Map<string, ProviderSubscriptionSnapshot>();
  private fetchFailures: ProviderErrorCode[] = [];
  private ackFailures: ProviderErrorCode[] = [];
  private nextGate: Gate | null = null;

  readonly fetchCalls: string[] = [];
  readonly ackCalls: string[] = [];
  /** Tokens the provider has been told to acknowledge successfully. */
  readonly acknowledged = new Set<string>();

  isConfigured(): boolean {
    return this.configured;
  }

  expectedPackageName(): string | null {
    return this.packageName;
  }

  /** Sets (or replaces) the provider's state for a token. */
  setSnapshot(token: string, over: Partial<ProviderSubscriptionSnapshot> = {}): ProviderSubscriptionSnapshot {
    const next = fakeSnapshot({ ...(this.snapshots.get(token) ?? {}), ...over });
    this.snapshots.set(token, next);
    return next;
  }

  /** Makes the next N fetches fail with this code. */
  failFetch(code: ProviderErrorCode, times = 1): void {
    for (let i = 0; i < times; i++) this.fetchFailures.push(code);
  }

  failAcknowledge(code: ProviderErrorCode, times = 1): void {
    for (let i = 0; i < times; i++) this.ackFailures.push(code);
  }

  /** Holds the next fetch open until release() is called. Its answer is the state at CALL time. */
  gateNextFetch(): { release: () => void } {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextGate = { promise, release };
    return { release };
  }

  async fetchSubscription(token: string) {
    this.fetchCalls.push(token);
    const failure = this.fetchFailures.shift();
    if (failure) return fail(failure);

    const captured = this.snapshots.get(token);
    const gate = this.nextGate;
    this.nextGate = null;
    if (gate) await gate.promise;

    if (!captured) return fail("not_found");
    return { ok: true as const, snapshot: { ...captured } };
  }

  async acknowledge(token: string) {
    this.ackCalls.push(token);
    const failure = this.ackFailures.shift();
    if (failure) return fail(failure);
    this.acknowledged.add(token);
    const current = this.snapshots.get(token);
    if (current) this.snapshots.set(token, { ...current, acknowledged: true });
    return { ok: true as const };
  }

  mapState(state: string, expiryTimeMillis: number | null): MappedState {
    return mapGooglePlaySubscriptionState(state, expiryTimeMillis);
  }
}

function fail(code: ProviderErrorCode): AdapterFailure {
  return { ok: false, code, retryable: isRetryableProviderError(code) };
}
