// The provider boundary for App Store subscriptions, the counterpart of ./adapter (Google Play).
//
// ./apple-service talks to an AppStoreAdapter, never to a provider module directly. The adapter owns the two things that
// touch Apple: verifying a signed payload against the pinned roots, and reading a subscription's live state. Tests and the
// staging harness install a fake that verifies against a GENERATED test root and answers status from memory, so the whole
// lifecycle (including real signature and chain verification) runs with no network and no Apple account.
//
// There is no environment variable that selects a fake: a deployment cannot be switched onto one by configuration.

import type { AdapterFailure } from "./adapter";
import type { JwsResult } from "@/lib/providers/app-store-jws";
import type { AppStoreStatusResult } from "@/lib/providers/app-store";

export interface AppStoreAdapter {
  readonly name: string;
  /** True when bundle id, API credentials and the pinned roots are all present. Says nothing about the kill switch. */
  isConfigured(): boolean;
  /** The bundle identifier this adapter serves. Payloads for another app are ignored. */
  expectedBundleId(): string | null;
  /** Verifies an Apple-signed JWS (chain to the pinned root, signature) and returns its payload. */
  verifySigned<T>(jws: unknown): JwsResult<T>;
  /** The subscription's current state, read from Apple. */
  fetchStatus(originalTransactionId: string, environment: "production" | "sandbox"): Promise<{ ok: true; result: AppStoreStatusResult } | AdapterFailure>;
}

let override: AppStoreAdapter | null = null;
let defaultAdapter: AppStoreAdapter | null = null;

// Registered once by ./apple-real-adapter so this module never imports a provider.
export function registerDefaultAppStoreAdapter(adapter: AppStoreAdapter): void {
  defaultAdapter = adapter;
}

export function getAppStoreAdapter(): AppStoreAdapter {
  if (override) return override;
  if (!defaultAdapter) throw new Error("No App Store adapter is registered.");
  return defaultAdapter;
}

export function setAppStoreAdapterForTesting(adapter: AppStoreAdapter | null): void {
  override = adapter;
}
