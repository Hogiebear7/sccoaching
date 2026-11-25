// Stripe webhook verification — implements the documented Stripe-Signature
// scheme (HMAC-SHA256 over "<timestamp>.<rawBody>" with the whsec_ secret)
// without the SDK, mirroring lib/providers/revolut-webhook.ts.

import { createHmac, timingSafeEqual } from "crypto";

import { getConfiguredStripeWebhookSecret } from "@/lib/app-config";

const TOLERANCE_SECONDS = 300;

function getSigningSecret(): string | null {
  const secret = getConfiguredStripeWebhookSecret();
  return secret ? secret : null;
}

export function isStripeWebhookConfigured(): boolean {
  return getSigningSecret() !== null;
}

// Header shape: "t=1699999999,v1=abc...,v1=def...,v0=..."
function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t") timestamp = Number(value);
    if (key?.trim() === "v1" && value) signatures.push(value.trim());
  }
  return { timestamp, signatures };
}

export function verifyStripeSignature(rawBody: string, header: string | null): boolean {
  return verifyStripeSignatureWithSecret(getSigningSecret(), rawBody, header);
}

/** The same check against a given signing secret (the tenant platform-billing endpoint has its own). A missing secret or header never verifies. */
export function verifyStripeSignatureWithSecret(secret: string | null | undefined, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false;

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  // Replay window: reject signatures older than the tolerance.
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  return signatures.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, "utf8");
    return (
      candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)
    );
  });
}
