// lib/client-ip.ts — client identification for IP rate limiting under a conservative
// TRUSTED-PROXY POLICY. TRUSTED_PROXY_HOPS defaults to 0: no forwarded header is
// trusted, every request shares one (higher-capped) bucket, and nothing a client
// sends can pick its own bucket. With N>0 the client is the Nth entry of
// X-Forwarded-For from the RIGHT; entries to its left, and every other header, are
// ignored. Synthetic addresses only (documentation ranges).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNRESOLVED_CLIENT_LIMIT_MULTIPLIER, checkClientRateLimit, resolveClientIp, trustedProxyHops } from "@/lib/client-ip";
import { resetRateLimits } from "@/lib/rate-limit";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { method: "POST", headers });
const xff = (value: string) => req({ "x-forwarded-for": value });
const HOUR = 60 * 60 * 1000;
const T0 = 1_000_000_000;

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("trustedProxyHops", () => {
  it("defaults to 0 when unset", () => {
    expect(trustedProxyHops()).toBe(0);
  });

  it.each(["1", "2", "5"])("accepts %s", (v) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", v);
    expect(trustedProxyHops()).toBe(Number(v));
  });

  it.each(["", " ", "0", "-1", "6", "99", "abc", "1.5", "1e1", "0x1", "1 2"])("treats %j as 0 (trust nothing)", (v) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", v);
    expect(trustedProxyHops()).toBe(0);
  });
});

describe("resolveClientIp — default policy (hops = 0): no forwarded header is trusted", () => {
  it("resolves nothing even when a plausible X-Forwarded-For is sent", () => {
    expect(resolveClientIp(xff("203.0.113.9"))).toBeNull();
    expect(resolveClientIp(xff("198.51.100.1, 203.0.113.9"))).toBeNull();
  });

  it("resolves nothing when the header is missing", () => {
    expect(resolveClientIp(req())).toBeNull();
  });
});

describe("resolveClientIp — one trusted proxy (hops = 1)", () => {
  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_HOPS", "1"));

  it("uses the RIGHTMOST entry (the one the trusted proxy appended)", () => {
    expect(resolveClientIp(xff("203.0.113.9"))).toBe("203.0.113.9");
    expect(resolveClientIp(xff("198.51.100.1, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("ignores client-prepended entries: spoofing the left side changes nothing", () => {
    const a = resolveClientIp(xff("1.1.1.1, 2.2.2.2, 203.0.113.9"));
    const b = resolveClientIp(xff("9.9.9.9, 203.0.113.9"));
    const c = resolveClientIp(xff("203.0.113.9"));

    expect([a, b]).toEqual([c, c]);
  });

  it("resolves nothing when the header is missing", () => {
    expect(resolveClientIp(req())).toBeNull();
  });

  it.each(["", " ", ",", "unknown", "garbage", "999.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.4/24", "<script>", "203.0.113.9, unknown", "203.0.113.9,"])(
    "resolves nothing for a malformed rightmost entry (%j) rather than guessing",
    (value) => {
      expect(resolveClientIp(xff(value))).toBeNull();
    }
  );

  it("strips a port from an IPv4 entry and brackets/port from an IPv6 entry", () => {
    expect(resolveClientIp(xff("203.0.113.9:51234"))).toBe("203.0.113.9");
    expect(resolveClientIp(xff("[2001:db8:0:1::7]:443"))).toBe("2001:db8:0:1::/64");
  });

  it("keys an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(resolveClientIp(xff("::ffff:203.0.113.9"))).toBe("203.0.113.9");
  });

  it("keys IPv6 clients by their /64, so rotating the host part does not change the key", () => {
    const a = resolveClientIp(xff("2001:db8:0:1:aaaa:bbbb:cccc:dddd"));
    const b = resolveClientIp(xff("2001:DB8::1:0:0:0:1"));
    const c = resolveClientIp(xff("2001:db8:0:1::ffff"));
    const other = resolveClientIp(xff("2001:db8:0:2::1"));

    expect(a).toBe("2001:db8:0:1::/64");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(other).toBe("2001:db8:0:2::/64");
    expect(other).not.toBe(a);
  });

  it("resolves nothing for an IPv6 form it cannot expand safely", () => {
    expect(resolveClientIp(xff("2001:db8::1::2"))).toBeNull();
    expect(resolveClientIp(xff("::ffff:1.2.3"))).toBeNull();
  });

  it("consults ONLY X-Forwarded-For: X-Real-IP, CF-Connecting-IP, True-Client-IP, X-Client-IP and Forwarded are ignored", () => {
    const spoofOnly = req({
      "x-real-ip": "198.51.100.77",
      "cf-connecting-ip": "198.51.100.78",
      "true-client-ip": "198.51.100.79",
      "x-client-ip": "198.51.100.80",
      forwarded: "for=198.51.100.81",
    });
    expect(resolveClientIp(spoofOnly)).toBeNull();

    const withXff = req({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.77", "cf-connecting-ip": "198.51.100.78" });
    expect(resolveClientIp(withXff)).toBe("203.0.113.9");
  });
});

describe("resolveClientIp — two trusted proxies (hops = 2)", () => {
  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_HOPS", "2"));

  it("uses the SECOND entry from the right", () => {
    expect(resolveClientIp(xff("203.0.113.9, 198.51.100.5"))).toBe("203.0.113.9");
    expect(resolveClientIp(xff("1.1.1.1, 203.0.113.9, 198.51.100.5"))).toBe("203.0.113.9");
  });

  it("resolves nothing when there are fewer entries than trusted hops (does not fall back to the left)", () => {
    expect(resolveClientIp(xff("203.0.113.9"))).toBeNull();
  });
});

describe("checkClientRateLimit", () => {
  it("default policy: every request shares ONE bucket with a raised cap, and no header can escape it", () => {
    const cap = 3 * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;

    for (let i = 0; i < cap; i++) {
      // A different spoofed address (and every spoofable header) on each request.
      const r = req({ "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `198.51.100.${i}`, "cf-connecting-ip": `192.0.2.${i}` });
      expect(checkClientRateLimit(r, "signup", 3, HOUR, T0).allowed).toBe(true);
    }

    const next = req({ "x-forwarded-for": "203.0.113.250", "x-real-ip": "198.51.100.250" });
    expect(checkClientRateLimit(next, "signup", 3, HOUR, T0).allowed).toBe(false);
  });

  it("hops = 1: each client gets its own bucket at the stated limit", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    for (let i = 0; i < 3; i++) expect(checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0).allowed).toBe(true);

    expect(checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0).allowed).toBe(false); // first over the limit
    expect(checkClientRateLimit(xff("203.0.113.10"), "signup", 3, HOUR, T0).allowed).toBe(true); // independent client
  });

  it("hops = 1: rotating client-controlled entries or headers does not bypass the limit", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0);

    for (let i = 0; i < 25; i++) {
      const spoofed = req({ "x-forwarded-for": `10.0.0.${i}, 172.16.0.${i}, 203.0.113.9`, "x-real-ip": `198.51.100.${i}` });
      expect(checkClientRateLimit(spoofed, "signup", 3, HOUR, T0).allowed).toBe(false);
    }
  });

  it("hops = 1: an IPv6 client rotating its host bits stays in one /64 bucket", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) checkClientRateLimit(xff(`2001:db8:0:1::${i + 1}`), "signup", 3, HOUR, T0);

    expect(checkClientRateLimit(xff("2001:db8:0:1::ffff"), "signup", 3, HOUR, T0).allowed).toBe(false);
  });

  it("malformed or missing headers under hops = 1 fall into the shared unresolved bucket, not a private one", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const cap = 2 * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;

    for (let i = 0; i < cap; i++) {
      expect(checkClientRateLimit(i % 2 ? req() : xff("not-an-ip"), "signup", 2, HOUR, T0).allowed).toBe(true);
    }

    expect(checkClientRateLimit(xff("also-not-an-ip"), "signup", 2, HOUR, T0).allowed).toBe(false);
  });

  it("the resolved and unresolved buckets are separate, and different bucket names never share a count", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0);

    expect(checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0).allowed).toBe(false);
    expect(checkClientRateLimit(xff("203.0.113.9"), "gym-signup", 3, HOUR, T0).allowed).toBe(true);
    expect(checkClientRateLimit(req(), "signup", 3, HOUR, T0).allowed).toBe(true); // unresolved is its own bucket
  });

  it("resets after the window", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0);

    expect(checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0 + HOUR - 1).allowed).toBe(false);
    expect(checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0 + HOUR + 1).allowed).toBe(true);
  });

  it("reports a Retry-After for a blocked client", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0);

    const blocked = checkClientRateLimit(xff("203.0.113.9"), "signup", 3, HOUR, T0 + 1000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSecs).toBe(3599);
  });
});
