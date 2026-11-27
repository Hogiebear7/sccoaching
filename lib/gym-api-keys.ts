// API keys for a gym, so another tool (Zapier "Webhooks by Zapier > Custom Request", Make, n8n ...) can ask the platform to do a small set of things for that gym: list upcoming classes,
// look up a member by email, send a membership invite. A key belongs to ONE gym and can only ever act on that gym. Only a hash is stored, the key is shown once, and a key can be revoked at
// once. Every call is rate limited. Keys are made by the gym's admin in Staff > Integrations.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGyms, saveGym } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GymApiKey, GymRecord } from "@/lib/gyms-schema";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";

export const MAX_API_KEYS_PER_GYM = 5;
export const API_RATE_LIMIT_PER_MINUTE = 60;
const LAST_USED_WRITE_MS = 10 * 60_000;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newApiKey(name: string): { key: string; record: GymApiKey } {
  const key = `scp_${randomBytes(24).toString("hex")}`;
  return { key, record: { id: randomUUID(), name: name.trim().slice(0, 60), hash: hashApiKey(key), prefix: key.slice(0, 12), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null } };
}

/** What a person sees for a key afterwards (never the hash). */
export function publicApiKey(k: GymApiKey) {
  return { id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null, revoked: Boolean(k.revokedAt) };
}

/** The key out of an Authorization: Bearer header or an X-API-Key header, or null. */
export function readKeyFromRequest(request: Pick<NextRequest, "headers">): string | null {
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim() || null;
  const header = request.headers.get("x-api-key");
  return header?.trim() || null;
}

/** The gym and the key a presented key belongs to (not revoked), or null. Compares hashes in constant time. */
export function findGymByApiKey(key: string): { gym: GymRecord; keyRecord: GymApiKey } | null {
  if (!/^scp_[0-9a-f]{48}$/.test(key)) return null;
  const hash = Buffer.from(hashApiKey(key), "hex");
  for (const gym of findGyms()) {
    for (const k of gym.apiKeys ?? []) {
      if (k.revokedAt) continue;
      const stored = Buffer.from(k.hash, "hex");
      if (stored.length === hash.length && timingSafeEqual(stored, hash)) return { gym, keyRecord: k };
    }
  }
  return null;
}

/** The id the datastore uses for this gym's classes and accounts: null for the original S&C gym. */
export function gymKeyOf(gym: Pick<GymRecord, "id" | "slug">): string | null {
  return gym.slug === PRIMARY_GYM_SLUG ? null : gym.id;
}

export type ApiAuth = { ok: true; gym: GymRecord; keyId: string } | { ok: false; response: NextResponse };

const fail = (status: number, message: string, headers?: Record<string, string>) => ({ ok: false as const, response: NextResponse.json({ success: false, message }, { status, headers }) });

/** Checks the key, the gym, and the rate limit for one API call. Remembers when the key was last used (at most every 10 minutes). */
export function authenticateApiRequest(request: NextRequest, now: Date = new Date()): ApiAuth {
  const key = readKeyFromRequest(request);
  if (!key) return fail(401, "Send your API key as 'Authorization: Bearer scp_...'.");
  const found = findGymByApiKey(key);
  if (!found) return fail(401, "That API key is not valid, or it has been revoked.");
  const rate = checkRateLimit(`api:${found.keyRecord.id}`, API_RATE_LIMIT_PER_MINUTE, 60_000);
  if (!rate.allowed) return fail(429, "Too many requests. Wait a minute and try again.", { "Retry-After": String(rate.retryAfterSecs) });

  const last = found.keyRecord.lastUsedAt ? Date.parse(found.keyRecord.lastUsedAt) : 0;
  if (now.getTime() - (Number.isNaN(last) ? 0 : last) > LAST_USED_WRITE_MS) {
    try {
      saveGym({ ...found.gym, apiKeys: (found.gym.apiKeys ?? []).map((k) => (k.id === found.keyRecord.id ? { ...k, lastUsedAt: now.toISOString() } : k)) });
    } catch {
      // Remembering the time is a nicety; it never blocks the call.
    }
  }
  return { ok: true, gym: found.gym, keyId: found.keyRecord.id };
}
