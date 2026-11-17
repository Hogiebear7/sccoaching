// Resend delivery events: signature check (Svix scheme, which Resend uses) and turning an event into a stored record plus, for a hard bounce or a spam
// complaint, a suppression. Pure and dependency-free so it is testable; the route (app/api/webhooks/resend) does the reading and writing.
import { createHmac, timingSafeEqual } from "crypto";

const TOLERANCE_SECONDS = 5 * 60;

/** Verifies a Svix-signed webhook: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 secret after "whsec_". */
export function verifySvixSignature(opts: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  nowSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signatureHeader, body } = opts;
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  // The header holds one or more space-separated "v1,<base64>" signatures.
  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export interface ParsedEmailEvent {
  type: string;
  emailId: string | null;
  to: string | null;
  detail: string | null;
  /** Set when this event means the address must not be emailed again. */
  suppress: "bounced" | "complained" | null;
}

/** Reads a Resend webhook payload. Only a permanent bounce or a complaint suppresses; a temporary bounce or a delay never does. */
export function parseResendEvent(payload: unknown): ParsedEmailEvent | null {
  const p = (payload ?? {}) as { type?: unknown; data?: Record<string, unknown> };
  if (typeof p.type !== "string" || !p.type.startsWith("email.")) return null;
  const data = p.data ?? {};
  const toField = data.to;
  const to = Array.isArray(toField) ? (typeof toField[0] === "string" ? toField[0] : null) : typeof toField === "string" ? toField : null;
  const emailId = typeof data.email_id === "string" ? data.email_id : null;

  const bounce = (data.bounce ?? {}) as { type?: unknown; subType?: unknown; message?: unknown };
  const bounceType = typeof bounce.type === "string" ? bounce.type : null;
  const reason = typeof bounce.message === "string" ? bounce.message.slice(0, 200) : null;

  let suppress: ParsedEmailEvent["suppress"] = null;
  let detail: string | null = null;
  if (p.type === "email.bounced") {
    detail = [bounceType, reason].filter(Boolean).join(": ") || null;
    // "Permanent" is a hard bounce (no such mailbox). Transient and undetermined bounces are left alone.
    if (bounceType?.toLowerCase() === "permanent") suppress = "bounced";
  } else if (p.type === "email.complained") {
    suppress = "complained";
  } else if (p.type === "email.failed" || p.type === "email.delivery_delayed") {
    detail = typeof data.reason === "string" ? data.reason.slice(0, 200) : null;
  }

  return { type: p.type, emailId, to: to ? to.trim().toLowerCase() : null, detail, suppress };
}
