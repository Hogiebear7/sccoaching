// Optional-email preferences and unsubscribe links (owner plan 2026-11-17). Two optional topics, both separate from the emails a member needs (bookings,
// billing, password and security), which are never switched off here:
//   tips       getting-started and how-to emails (the welcome series). On by default for new members, stop with one click.
//   marketing  newsletters and offers. OFF until the member opts in (a ticked, never pre-ticked box at sign-up or in Settings).
import { createHmac, timingSafeEqual } from "crypto";

import { getConfiguredSessionSecret } from "@/lib/app-config";

export type OptionalTopic = "tips" | "marketing";
export type UnsubscribeTopic = OptionalTopic | "all";

export interface EmailPrefs {
  tips: boolean;
  marketing: boolean;
  /** When and where the member opted in to marketing (proof of consent). Null when they haven't. */
  marketingConsentAt: string | null;
  marketingConsentSource: string | null;
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = { tips: true, marketing: false, marketingConsentAt: null, marketingConsentSource: null };

export function effectivePrefs(stored: Partial<EmailPrefs> | null | undefined): EmailPrefs {
  return {
    tips: stored?.tips !== false,
    marketing: stored?.marketing === true,
    marketingConsentAt: stored?.marketingConsentAt ?? null,
    marketingConsentSource: stored?.marketingConsentSource ?? null,
  };
}

/** Records an opt-in or opt-out for one topic. Opting in to marketing stores when and where, as proof. */
export function setTopic(stored: Partial<EmailPrefs> | null | undefined, topic: OptionalTopic, on: boolean, source: string, now: Date = new Date()): EmailPrefs {
  const prefs = effectivePrefs(stored);
  if (topic === "tips") return { ...prefs, tips: on };
  return {
    ...prefs,
    marketing: on,
    marketingConsentAt: on ? now.toISOString() : prefs.marketingConsentAt,
    marketingConsentSource: on ? source : prefs.marketingConsentSource,
  };
}

export function unsubscribe(stored: Partial<EmailPrefs> | null | undefined, topic: UnsubscribeTopic, now: Date = new Date()): EmailPrefs {
  if (topic === "all") return setTopic(setTopic(stored, "tips", false, "unsubscribe", now), "marketing", false, "unsubscribe", now);
  return setTopic(stored, topic, false, "unsubscribe", now);
}

// ── Signed unsubscribe links: no login needed, can't be guessed or edited. ──
function sign(userId: string, topic: UnsubscribeTopic): string {
  const secret = getConfiguredSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return createHmac("sha256", secret).update(`unsub:${userId}:${topic}`).digest("hex");
}

export function unsubscribeToken(userId: string, topic: UnsubscribeTopic): string {
  return Buffer.from(`${userId}.${topic}.${sign(userId, topic)}`, "utf8").toString("base64url");
}

export function verifyUnsubscribeToken(token: string | null | undefined): { userId: string; topic: UnsubscribeTopic } | null {
  if (!token) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [userId, topic, sig] = decoded.split(".");
  if (!userId || !sig || (topic !== "tips" && topic !== "marketing" && topic !== "all")) return null;
  let expected: string;
  try {
    expected = sign(userId, topic);
  } catch {
    return null;
  }
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { userId, topic } : null;
}
