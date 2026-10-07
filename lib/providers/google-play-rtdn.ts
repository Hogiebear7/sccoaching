// Google Play RTDN (Real-time Developer Notifications) — auth + envelope
// parsing for the Pub/Sub push webhook. See app/api/webhooks/google-play's
// route for what actually happens once a notification is authenticated and
// parsed.
//
// Auth approach: a shared secret in the push endpoint URL (?token=...),
// checked with a constant-time comparison — deliberately NOT full OIDC
// JWT/JWKS verification of Pub/Sub's signed token. That's fully
// implementable with Node's built-in crypto (createPublicKey from a JWK +
// crypto.verify), but it can't be exercised against a real Google-signed
// token in this environment, so there's no way to catch a subtle bug in
// that path before it ships. A shared secret is trivially and fully
// testable, and — configured as the URL itself, which only this server and
// whoever sets up the Pub/Sub push subscription ever see — gives
// essentially the same practical protection here. Mirrors the rigor of
// lib/providers/stripe-webhook.ts's HMAC check without the unverifiable
// complexity.

import { timingSafeEqual } from "crypto";

export function isGooglePlayRtdnConfigured(): boolean {
  return !!process.env.GOOGLE_PLAY_RTDN_TOKEN?.trim();
}

export function verifyRtdnToken(providedToken: string | null): boolean {
  const expected = process.env.GOOGLE_PLAY_RTDN_TOKEN?.trim();
  if (!expected || !providedToken) return false;

  const a = Buffer.from(providedToken);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly so a wrong-length token doesn't 500 instead of 401.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface PubSubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

// Google's DeveloperNotification JSON (base64-encoded inside the Pub/Sub
// message). Only the two shapes this app acts on are typed — see
// https://developers.google.com/android-publisher/rtdn/subscriptions for
// the full schema. Deliberately NOT typing/reading subscriptionNotification's
// numeric notificationType — every notification is treated identically, as
// a "go re-verify this purchase token live" signal (see the webhook route),
// so the specific type Google claims happened is never trusted or needed.
export interface GooglePlayDeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
  // Sent when a purchase is refunded, charged back or otherwise voided. productType 1 is a subscription,
  // 2 a one-time product. refundType is informational. The service treats it as a trigger to re-check the
  // purchase AND as the signal that a voided current order ends access (lib/iap/service.ts).
  voidedPurchaseNotification?: {
    purchaseToken: string;
    orderId?: string;
    productType?: number;
    refundType?: number;
  };
  // Sent by Play Console's Monetization setup "Send test notification"
  // button — not a real event, just confirms the endpoint is reachable.
  testNotification?: { version: string };
}

// Pub/Sub's own message id: the idempotency key for a delivery. Null when absent or not a string.
export function pubSubMessageId(body: unknown): string | null {
  const id = (body as PubSubPushEnvelope | null)?.message?.messageId;
  return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : null;
}

export function parsePubSubPushEnvelope(body: unknown): GooglePlayDeveloperNotification | null {
  const envelope = body as PubSubPushEnvelope | null;
  const dataB64 = envelope?.message?.data;
  if (typeof dataB64 !== "string" || !dataB64) return null;

  try {
    const json = Buffer.from(dataB64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Partial<GooglePlayDeveloperNotification>;
    if (typeof parsed.packageName !== "string") return null;
    return parsed as GooglePlayDeveloperNotification;
  } catch {
    return null;
  }
}
