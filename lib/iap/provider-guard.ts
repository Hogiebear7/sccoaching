// Audit helper for refused cross-provider writes. Kept apart from lib/iap/entitlement-conflict.ts so the rules stay pure.
//
// What a refusal records: the account id, the incoming provider, the provider that holds the entitlement, a stable code
// and the source (which handler refused it). The incoming provider's own reference (a subscription or checkout id) is
// stored only as a SHA-256 hash. No provider message, no payload field and no token is ever written.
import { appendIapEvent, hashPurchaseToken, type BillingProvider, type IapEventRecord } from "@/lib/db";

import type { EntitlementConflict } from "./entitlement-conflict";

export type ProviderGuardSource = "stripe_webhook" | "revolut_webhook" | "google_play_claim" | "google_play_notification";

export function recordProviderConflict(args: {
  userId: string;
  incoming: IapEventRecord["provider"];
  existingProvider: BillingProvider;
  conflict: EntitlementConflict;
  source: ProviderGuardSource;
  /** The incoming provider's own reference. Hashed before storage. */
  reference?: string | null;
}): void {
  appendIapEvent({
    provider: args.incoming,
    type: "provider_conflict_rejected",
    userId: args.userId,
    actor: "provider",
    detail: {
      code: args.conflict.code,
      incomingProvider: args.incoming,
      existingProvider: args.existingProvider,
      source: args.source,
      ...(args.reference ? { referenceHash: hashPurchaseToken(args.reference) } : {}),
    },
  });
}
