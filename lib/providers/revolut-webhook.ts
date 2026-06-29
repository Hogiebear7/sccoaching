import { createHmac, timingSafeEqual } from "crypto";

import type { SubscriptionStatus } from "@/lib/db";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function getWebhookSigningSecret(): string | null {
  return process.env.REVOLUT_WEBHOOK_SIGNING_SECRET?.trim() || null;
}

export function isRevolutWebhookConfigured(): boolean {
  return getWebhookSigningSecret() !== null;
}

// Implements Revolut's documented v1 HMAC-SHA256 webhook signature scheme:
// payload_to_sign = "v1." + timestamp + "." + rawBody
// signature        = "v1=" + hex(hmacSha256(signingSecret, payload_to_sign))
// The `Revolut-Signature` header may contain multiple comma-separated
// signatures (e.g. during signing-secret rotation). Accept if any match.
export function verifyRevolutSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null
): boolean {
  const signingSecret = getWebhookSigningSecret();

  if (!signingSecret || !timestampHeader || !signatureHeader) return false;

  const payloadToSign = `v1.${timestampHeader}.${rawBody}`;
  const expected = `v1=${createHmac("sha256", signingSecret).update(payloadToSign).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);

  return signatureHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((sig) => {
      const sigBuffer = Buffer.from(sig);
      return (
        sigBuffer.length === expectedBuffer.length && timingSafeEqual(expectedBuffer, sigBuffer)
      );
    });
}

// Mitigates replay attacks: Revolut sends the exact delivery time in
// Revolut-Request-Timestamp (epoch ms). Reject anything outside a 5-minute window.
export function isRevolutTimestampFresh(timestampHeader: string | null): boolean {
  if (!timestampHeader) return false;

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) return false;

  return Math.abs(Date.now() - timestampMs) <= TIMESTAMP_TOLERANCE_MS;
}

// Maps a Revolut webhook event type to a normalized internal subscription
// status. Returns null for events this app doesn't act on.
export function mapRevolutEventToStatus(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case "ORDER_COMPLETED":
    case "ORDER_AUTHORISED":
    case "SUBSCRIPTION_INITIATED":
      return "active";
    case "ORDER_FAILED":
    case "ORDER_PAYMENT_DECLINED":
    case "ORDER_PAYMENT_FAILED":
    case "SUBSCRIPTION_OVERDUE":
      return "past_due";
    case "ORDER_CANCELLED":
    case "SUBSCRIPTION_CANCELLED":
    case "SUBSCRIPTION_FINISHED":
      return "canceled";
    default:
      return null;
  }
}
