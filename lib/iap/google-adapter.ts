// The real Google Play adapter: a thin wrapper over lib/providers/google-play.ts that turns its
// results into the provider-neutral shapes in lib/iap/adapter.ts. Provider message text never crosses
// this boundary (the provider module already returns only codes).

import {
  acknowledgeGooglePlaySubscription,
  configuredGooglePlayPackageName,
  isGooglePlayConfigured,
  mapGooglePlaySubscriptionState,
  verifyGooglePlaySubscriptionPurchase,
} from "@/lib/providers/google-play";

import { isRetryableProviderError, registerDefaultPlayAdapter, type PlayAdapter } from "./adapter";

export const googlePlayAdapter: PlayAdapter = {
  name: "google_play",

  isConfigured: () => isGooglePlayConfigured(),

  expectedPackageName: () => configuredGooglePlayPackageName(),

  async fetchSubscription(purchaseToken) {
    const result = await verifyGooglePlaySubscriptionPurchase(purchaseToken);
    if (!result.ok) return { ok: false, code: result.code, retryable: isRetryableProviderError(result.code) };
    const s = result.subscription;
    return {
      ok: true,
      snapshot: {
        state: s.subscriptionState,
        productId: s.productId,
        basePlanId: s.basePlanId,
        orderId: s.orderId,
        linkedPurchaseToken: s.linkedPurchaseToken,
        startTimeMillis: s.startTimeMillis,
        expiryTimeMillis: s.expiryTimeMillis,
        autoRenewing: s.autoRenewing,
        acknowledged: s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        accountBinding: s.obfuscatedExternalAccountId,
      },
    };
  },

  async acknowledge(purchaseToken) {
    const result = await acknowledgeGooglePlaySubscription(purchaseToken);
    return result.ok ? { ok: true } : { ok: false, code: result.code, retryable: isRetryableProviderError(result.code) };
  },

  mapState: (state, expiryTimeMillis) => mapGooglePlaySubscriptionState(state, expiryTimeMillis),
};

registerDefaultPlayAdapter(googlePlayAdapter);
