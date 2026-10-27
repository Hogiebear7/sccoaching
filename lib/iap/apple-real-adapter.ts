// The real App Store adapter: a thin wrapper over lib/providers/app-store.ts that turns its results into the shapes in
// ./apple-adapter. Provider message text never crosses this boundary (the provider module already returns only codes).

import {
  configuredBundleId,
  fetchAppStoreSubscriptionStatus,
  isAppStoreConfigured,
  verifyWithConfiguredRoots,
} from "@/lib/providers/app-store";

import { isRetryableProviderError, type ProviderErrorCode } from "./adapter";
import { registerDefaultAppStoreAdapter, type AppStoreAdapter } from "./apple-adapter";

export const appStoreAdapter: AppStoreAdapter = {
  name: "app_store",

  isConfigured: () => isAppStoreConfigured(),

  expectedBundleId: () => configuredBundleId(),

  verifySigned: (jws) => verifyWithConfiguredRoots(jws),

  async fetchStatus(originalTransactionId, environment) {
    const result = await fetchAppStoreSubscriptionStatus(originalTransactionId, environment);
    if (!result.ok) {
      const code = result.code as ProviderErrorCode;
      return { ok: false, code, retryable: isRetryableProviderError(code) };
    }
    return { ok: true, result: result.result };
  },
};

registerDefaultAppStoreAdapter(appStoreAdapter);
