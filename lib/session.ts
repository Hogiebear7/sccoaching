import { createHmac, timingSafeEqual } from "crypto";

export interface SessionPayload {
  userId: string;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

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

export function signSession(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString(
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
    ) as { userId?: unknown };

    return typeof parsed.userId === "string" ? { userId: parsed.userId } : null;
  } catch {
    return null;
  }
}
