// Client identification for IP-based rate limiting — with a deliberately
// conservative TRUSTED-PROXY POLICY.
//
// A client can send any X-Forwarded-For / X-Real-IP / CF-Connecting-IP value it
// likes, so those headers are only meaningful if a proxy WE control (or trust) sits
// in front of the app and sets or appends them. This repository cannot tell what
// the production host's proxy does, so nothing is trusted by default:
//
//   TRUSTED_PROXY_HOPS (env, default 0)
//     0  -> trust NO forwarded header. Every request resolves to "no client IP"
//           and shares one bucket (see below). Nothing a client sends can move it
//           into a bucket of its own, so there is no header-spoofing bypass.
//     N>0 -> the app is behind exactly N trusted proxies, each appending the
//           address it saw to X-Forwarded-For. The client is the Nth entry from
//           the RIGHT. Entries to its left were supplied by the client or an
//           earlier, untrusted hop and are ignored, so prepending fake addresses
//           changes nothing. (Too few entries, or a malformed entry, resolves to
//           "no client IP" rather than guessing.)
//
// Set TRUSTED_PROXY_HOPS only after verifying, on the deployed host, how many
// proxies append to X-Forwarded-For. Too small a value keys everyone by a proxy's
// address (over-aggressive shared buckets); a value above the real proxy count
// would trust client-supplied entries. No other header (X-Real-IP,
// CF-Connecting-IP, Forwarded, ...) is ever consulted.
//
// When no client IP resolves, the request is limited under one SHARED bucket with a
// UNRESOLVED_CLIENT_LIMIT_MULTIPLIER times higher cap — a site-wide flood guard
// rather than a per-client limit, so a host whose proxy headers are not configured
// yet is protected but not locked out.
//
// IPv6 clients are keyed by their /64 (a single subscriber typically controls a
// whole /64, so per-address keys would be trivially rotated); IPv4-mapped IPv6
// addresses are keyed as the IPv4 address. Raw addresses are never logged.
import { isIP } from "net";

import { checkRateLimit, type RateLimitResult } from "./rate-limit";

export const UNRESOLVED_CLIENT_LIMIT_MULTIPLIER = 10;
const MAX_TRUSTED_PROXY_HOPS = 5;

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const hops = Number(raw);
  return hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS ? hops : 0;
}

function stripPort(entry: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  if (bracketed) return bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(entry);
  return v4WithPort ? v4WithPort[1] : entry;
}

// The /64 prefix of an IPv6 address as four hextets, or null for anything this
// cannot expand safely (e.g. an embedded dotted-quad suffix).
function ipv6Prefix64(ip: string): string | null {
  if (ip.includes(".")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

// The client key for `request` under the trusted-proxy policy above, or null.
export function resolveClientIp(request: Request): string | null {
  const hops = trustedProxyHops();
  if (hops === 0) return null;

  const header = request.headers.get("x-forwarded-for");
  if (!header) return null;

  const entries = header.split(",").map((e) => e.trim());
  if (entries.length < hops) return null;

  let candidate = stripPort(entries[entries.length - hops]).toLowerCase();
  if (!isIP(candidate)) return null;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(candidate);
  if (mapped && isIP(mapped[1]) === 4) candidate = mapped[1];

  if (isIP(candidate) === 6) {
    const prefix = ipv6Prefix64(candidate);
    return prefix ? `${prefix}::/64` : null;
  }
  return candidate;
}

// Limit `bucket` by client. With a resolved IP the cap is `limit` per client; with
// none it is the shared, UNRESOLVED_CLIENT_LIMIT_MULTIPLIER-times-higher cap.
export function checkClientRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number,
  now?: number
): RateLimitResult {
  const ip = resolveClientIp(request);
  return ip
    ? checkRateLimit(`${bucket}:ip:${ip}`, limit, windowMs, now)
    : checkRateLimit(`${bucket}:ip:unresolved`, limit * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER, windowMs, now);
}
