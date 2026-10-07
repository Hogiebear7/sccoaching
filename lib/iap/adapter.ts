// The provider boundary for in-app subscriptions.
//
// Everything in lib/iap/service.ts talks to a PlayAdapter, never to a provider module directly. That
// keeps three things true: a provider failure is a closed set of codes (never a message to leak), the
// tests and the staging harness can drive the whole lifecycle with a fake and no network, and a future
// iOS provider can be added beside this one without touching the service's rules.
//
// Android and Google Play only (owner default D6). There is deliberately no Apple adapter.

export type ProviderErrorCode =
  | "not_configured"
  | "timeout"
  | "network"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "server_error"
  | "invalid_response";

// A failure the caller may usefully retry later (a transient provider or configuration problem), as
// opposed to one that will answer the same way every time (an unknown or malformed token).
export function isRetryableProviderError(code: ProviderErrorCode): boolean {
  return code !== "not_found" && code !== "bad_request";
}

export interface AdapterFailure {
  ok: false;
  code: ProviderErrorCode;
  retryable: boolean;
}

// The provider's view of one subscription purchase at one moment, in provider-neutral terms.
export interface ProviderSubscriptionSnapshot {
  /** The provider's raw state string. Mapped to an app status by PlayAdapter.mapState. */
  state: string;
  productId: string | null;
  basePlanId: string | null;
  orderId: string | null;
  linkedPurchaseToken: string | null;
  startTimeMillis: number | null;
  expiryTimeMillis: number | null;
  autoRenewing: boolean;
  acknowledged: boolean;
  /** The one-way account identifier the client set at purchase time, echoed back by the provider. */
  accountBinding: string | null;
}

export interface MappedState {
  /** Storage-level status for GooglePlayPurchaseRecord.status. */
  playStatus: string;
  /** SubscriptionRecord status this implies, or null when the state is not confident enough to grant. */
  appStatus: string | null;
}

export interface PlayAdapter {
  readonly name: string;
  /** True when credentials and package name are present. Says nothing about the kill switch. */
  isConfigured(): boolean;
  /** The Android application id this adapter serves, used to ignore notifications for another app. */
  expectedPackageName(): string | null;
  fetchSubscription(purchaseToken: string): Promise<{ ok: true; snapshot: ProviderSubscriptionSnapshot } | AdapterFailure>;
  acknowledge(purchaseToken: string): Promise<{ ok: true } | AdapterFailure>;
  mapState(state: string, expiryTimeMillis: number | null): MappedState;
}

let override: PlayAdapter | null = null;
let defaultAdapter: PlayAdapter | null = null;

// Registered once by lib/iap/google-adapter.ts so this module never imports a provider.
export function registerDefaultPlayAdapter(adapter: PlayAdapter): void {
  defaultAdapter = adapter;
}

// The adapter in use. Tests and the staging harness install a fake with setPlayAdapterForTesting and
// remove it with null. There is no environment variable that selects a fake: a deployment cannot be
// switched onto a fake by configuration.
export function getPlayAdapter(): PlayAdapter {
  if (override) return override;
  if (!defaultAdapter) throw new Error("No Google Play adapter is registered.");
  return defaultAdapter;
}

export function setPlayAdapterForTesting(adapter: PlayAdapter | null): void {
  override = adapter;
}
