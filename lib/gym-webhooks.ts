// Outgoing webhooks for a gym: when something happens (a member joins, a class is booked or cancelled, someone checks in), the gym's own address is called with a small signed JSON message.
// This is what Zapier ("Webhooks by Zapier, Catch Hook"), Make, n8n and similar tools listen for, so a gym can send new members to a mailing list, a booking to a spreadsheet, and so on, with
// no work from the platform owner. The gym owns the address and sees the secret once; every message is signed so the receiver can check it came from here.
//
// Safety: https addresses only; addresses that point at this server or a private network are refused (when saved AND when sent); no redirects are followed; a short time limit; and a
// webhook that keeps failing is switched off by itself. Sending never slows or breaks what the member was doing: it runs after the response and swallows every error.
import { createHmac, randomBytes, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";

import { findGymById, saveGym } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import type { GymRecord, GymWebhook } from "@/lib/gyms-schema";

export const WEBHOOK_EVENTS = [
  { type: "member.joined", label: "A new member joins", detail: "Name and email of the new member." },
  { type: "booking.created", label: "A class is booked", detail: "Who booked which class, and when." },
  { type: "booking.cancelled", label: "A booking is cancelled", detail: "Who cancelled which class." },
  { type: "class.checked_in", label: "A member is checked in", detail: "Who attended which class." },
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["type"] | "test.ping";
const EVENT_TYPES = new Set<string>(WEBHOOK_EVENTS.map((e) => e.type));

export const MAX_WEBHOOKS_PER_GYM = 5;
export const WEBHOOK_TIMEOUT_MS = 5000;
export const WEBHOOK_AUTO_DISABLE_AFTER = 10;

export function isEventType(value: unknown): value is Exclude<WebhookEventType, "test.ping"> {
  return typeof value === "string" && EVENT_TYPES.has(value);
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** True for an address that is private, loopback, link-local, or otherwise not a normal public internet address. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true; // not an IP: callers only pass IPs
}

export type UrlResult = { ok: true; url: string; host: string } | { ok: false; message: string };

/** Checks an address a gym typed (no network): https, a real host name, no credentials, a normal port, nothing that looks like this server or a private network. */
export function validateWebhookUrl(input: unknown): UrlResult {
  if (typeof input !== "string") return { ok: false, message: "Enter the address your tool gave you, starting with https://" };
  const raw = input.trim();
  if (raw.length > 500) return { ok: false, message: "That address is too long." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, message: "That does not look like an address. It should start with https://" };
  }
  if (u.protocol !== "https:") return { ok: false, message: "The address must start with https:// (a secure address)." };
  if (u.username || u.password) return { ok: false, message: "Remove the user name and password from the address." };
  if (u.port && u.port !== "443") return { ok: false, message: "Use a normal secure address (no custom port)." };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    return { ok: false, message: "That address points inside a private network, so it cannot be used." };
  }
  if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host.replace(/^\[|\]$/g, ""))) return { ok: false, message: "That address points inside a private network, so it cannot be used." };
  if (!host.includes(".") && !isIP(host.replace(/^\[|\]$/g, ""))) return { ok: false, message: "That does not look like a full web address." };
  return { ok: true, url: u.toString(), host };
}

/** The same check plus a look-up of where the name really points, so a name that resolves to a private address is refused too. */
export async function checkWebhookHost(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = validateWebhookUrl(url);
  if (!parsed.ok) return parsed;
  const bare = parsed.host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return { ok: true };
  try {
    const addresses = await lookup(bare, { all: true });
    if (addresses.length === 0) return { ok: false, message: "We could not find that address on the internet." };
    if (addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, message: "That address points inside a private network, so it cannot be used." };
    return { ok: true };
  } catch {
    return { ok: false, message: "We could not find that address on the internet. Check it and try again." };
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** The signature a receiver checks: HMAC-SHA256 of "<timestamp>.<body>" with the webhook's secret, as hex. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export interface WebhookMessage {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
}

export function buildMessage(type: WebhookEventType, data: Record<string, unknown>, now: Date = new Date()): WebhookMessage {
  return { id: `evt_${randomUUID()}`, type, createdAt: now.toISOString(), data };
}

// ── Sending ──────────────────────────────────────────────────────────────────

export type SendResult = { ok: true; status: number } | { ok: false; error: string };

/** One attempt. Never throws. */
export async function sendWebhook(hook: Pick<GymWebhook, "url" | "secret">, message: WebhookMessage, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const hostCheck = await checkWebhookHost(hook.url);
  if (!hostCheck.ok) return { ok: false, error: hostCheck.message };
  const body = JSON.stringify(message);
  const timestamp = String(Math.floor(Date.parse(message.createdAt) / 1000));
  try {
    const res = await fetchImpl(hook.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "SC-Platform-Webhooks/1",
        "X-SC-Event": message.type,
        "X-SC-Event-Id": message.id,
        "X-SC-Timestamp": timestamp,
        "X-SC-Signature": `sha256=${signWebhook(hook.secret, timestamp, body)}`,
      },
      body,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, error: res.status >= 300 && res.status < 400 ? "The address redirected, which is not followed. Use the final address." : `The receiver answered with an error (${res.status}).` };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? "The receiver took too long to answer." : "We could not reach the receiver." };
  }
}

/** Records the outcome on the webhook (read fresh, so a change made meanwhile is kept). A hook that keeps failing is switched off. */
function recordOutcome(gymId: string, hookId: string, result: SendResult, now: Date) {
  const gym = findGymById(gymId);
  const hooks = gym?.webhooks;
  if (!gym || !hooks) return;
  const next = hooks.map((h): GymWebhook => {
    if (h.id !== hookId) return h;
    if (result.ok) return { ...h, lastDeliveryAt: now.toISOString(), lastStatus: "ok", lastError: null, consecutiveFailures: 0 };
    const failures = (h.consecutiveFailures ?? 0) + 1;
    return { ...h, lastDeliveryAt: now.toISOString(), lastStatus: "failed", lastError: result.error, consecutiveFailures: failures, enabled: failures >= WEBHOOK_AUTO_DISABLE_AFTER ? false : h.enabled };
  });
  saveGym({ ...gym, webhooks: next });
}

/**
 * Tells every webhook of this gym that wants this event. Fire and forget: call it AFTER the request has been answered and do not await it. It never throws, and a slow or broken receiver
 * cannot affect the member. The original S&C gym has gymId null (its record is found by slug in the staff screens), so pass the gym record's id via gymKey when known.
 */
export type EventData = Record<string, unknown> | (() => Record<string, unknown>);

export function emitGymEvent(gym: Pick<GymRecord, "id"> | null | undefined, type: Exclude<WebhookEventType, "test.ping">, data: EventData): void {
  try {
    if (!gym) return;
    const record = findGymById(gym.id);
    const hooks = (record?.webhooks ?? []).filter((h) => h.enabled && h.events.includes(type));
    if (hooks.length === 0) return;
    const message = buildMessage(type, typeof data === "function" ? data() : data);
    for (const hook of hooks) {
      void sendWebhook(hook, message)
        .then((result) => recordOutcome(gym.id, hook.id, result, new Date()))
        .catch(() => undefined);
    }
  } catch {
    // Never let a webhook problem reach the caller.
  }
}

/** The same, for the common case of "something happened to this person": finds their gym (the original S&C gym included) inside the safety wrapper, so a route can call it in one line. */
export function emitUserEvent(user: { gymId?: string | null }, type: Exclude<WebhookEventType, "test.ping">, data: EventData): void {
  try {
    emitGymEvent(gymRecordForUser(user), type, data);
  } catch {
    // Never let a webhook problem reach the caller.
  }
}
