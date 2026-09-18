import { createHmac, timingSafeEqual } from "crypto";

import { getConfiguredSessionSecret } from "./app-config";

export interface SessionPayload {
  userId: string;
}

// Internal signed shape only — iat/exp never reach callers (verifySession
// returns just SessionPayload). They exist purely so the server can enforce
// absolute expiry without a database-backed session store.
interface SignedPayload extends SessionPayload {
  iat: number;
  exp: number;
}

export const MEMBER_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const STAFF_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

function getSessionSecret(): string {
  const secret = getConfiguredSessionSecret();

  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. See .env.local.example."
    );
  }

  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("hex");
}

// lifetimeMs is required (not optional/defaulted) so every caller must
// deliberately choose a lifetime — see MEMBER_SESSION_LIFETIME_MS /
// STAFF_SESSION_LIFETIME_MS rather than silently getting one.
export function signSession(payload: SessionPayload, lifetimeMs: number): string {
  const iat = Date.now();
  const signed: SignedPayload = { userId: payload.userId, iat, exp: iat + lifetimeMs };

  const encodedPayload = Buffer.from(JSON.stringify(signed), "utf-8").toString(
    "base64url"
  );

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySession(
  cookieValue: string | undefined
): SessionPayload | null {
  if (!cookieValue) return null;

  const [encodedPayload, signature] = cookieValue.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = sign(encodedPayload);

  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    ) as { userId?: unknown; iat?: unknown; exp?: unknown };

    if (typeof parsed.userId !== "string") return null;
    if (typeof parsed.iat !== "number" || !Number.isFinite(parsed.iat)) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    if (Date.now() >= parsed.exp) return null;

    return { userId: parsed.userId };
  } catch {
    return null;
  }
}
