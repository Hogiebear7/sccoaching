// Shared by the staff routes that manage a gym's webhooks: who is asking, which gym it is (always the asker's own, from the account, never from the request), and what a webhook looks like
// when it is shown back (the secret is never shown again after it is first created).
import type { GymWebhook } from "@/lib/gyms-schema";

export function publicWebhook(h: GymWebhook) {
  return {
    id: h.id,
    url: h.url,
    events: h.events,
    enabled: h.enabled,
    createdAt: h.createdAt,
    lastDeliveryAt: h.lastDeliveryAt ?? null,
    lastStatus: h.lastStatus ?? null,
    lastError: h.lastError ?? null,
    secretHint: `…${h.secret.slice(-4)}`,
  };
}
