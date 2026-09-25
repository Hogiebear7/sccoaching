// Rate limiting on the three public signup endpoints:
//   * POST /api/gyms/signup        (3 per client per hour) — creates a tenant + staff account
//   * POST /api/auth/signup        (10 per client per hour)
//   * POST /api/mobile/auth/signup (10 per client per hour)
//
// Where the limiter sits: AFTER the request's own fields validate and BEFORE the first
// datastore lookup. So malformed requests cost nothing and do not use a slot, while an
// attempt that reaches the duplicate-email check, hashing or account creation always
// counts — including one that fails there (which also bounds email probing).
//
// A "client" comes from lib/client-ip.ts: by default (TRUSTED_PROXY_HOPS unset) no
// forwarded header is trusted and every request shares one site-wide bucket with a
// 10x cap; with TRUSTED_PROXY_HOPS=1 the rightmost X-Forwarded-For entry is the client.
// Real routes, real limiter and real client-ip logic; only the datastore, invite
// redemption and password hashing are mocked. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNRESOLVED_CLIENT_LIMIT_MULTIPLIER } from "@/lib/client-ip";
import { resetRateLimits } from "@/lib/rate-limit";

const h = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  findGymBySlug: vi.fn(),
  createUserWithRole: vi.fn(),
  createGym: vi.fn(),
  setUserGymId: vi.fn(),
  createUser: vi.fn(),
  saveProfile: vi.fn(),
  saveCycleSettings: vi.fn(),
  saveCyclePrivacy: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/invites", () => ({ redeemInviteForUser: vi.fn() }));
vi.mock("@/lib/password", async () => {
  const actual = await vi.importActual<typeof import("@/lib/password")>("@/lib/password");
  return { ...actual, hashPassword: () => "salt:hash" };
});

const HOUR = 60 * 60 * 1000;
const STRONG = "Str0ng!Passw0rd";
let counter = 0;
const nextEmail = () => `person${++counter}@x.test`;

const gymBody = (over: Record<string, unknown> = {}) => ({ gymName: "Test Gym", addressLine: "1 Test Street", ownerEmail: nextEmail(), password: STRONG, ...over });
const memberBody = (over: Record<string, unknown> = {}) => ({
  email: nextEmail(),
  password: STRONG,
  fullName: "Test Person",
  phone: "0851234567",
  dateOfBirth: "1990-01-01",
  gender: "Other",
  primaryGoal: "General Health",
  ...over,
});

const ROUTES = [
  { name: "gyms/signup", mod: "@/app/api/gyms/signup/route", limit: 3, body: gymBody, weak: (b: Record<string, unknown>) => ({ ...b, password: "weak" }), emailKey: "ownerEmail" },
  { name: "auth/signup", mod: "@/app/api/auth/signup/route", limit: 10, body: memberBody, weak: (b: Record<string, unknown>) => ({ ...b, password: "weak" }), emailKey: "email" },
  { name: "mobile/auth/signup", mod: "@/app/api/mobile/auth/signup/route", limit: 10, body: memberBody, weak: (b: Record<string, unknown>) => ({ ...b, password: "weak" }), emailKey: "email" },
] as const;

async function post(mod: string, body: unknown, headers: Record<string, string> = {}, raw?: string) {
  const { POST } = await import(mod);
  return POST(
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    })
  ) as Promise<Response>;
}
const fromIp = (ip: string) => ({ "x-forwarded-for": ip });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  h.findUserByEmail.mockReturnValue(undefined);
  h.findGymBySlug.mockReturnValue(undefined);
  h.createUserWithRole.mockImplementation(() => ({ id: `owner-${++counter}` }));
  h.createUser.mockImplementation(() => ({ id: `member-${++counter}` }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const created = (route: (typeof ROUTES)[number]) => (route.name === "gyms/signup" ? h.createUserWithRole : h.createUser);

describe.each(ROUTES)("$name — per-client limit (TRUSTED_PROXY_HOPS=1)", (route) => {
  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_HOPS", "1"));

  it("allows legitimate signups up to the limit, then answers the first request over it with 429", async () => {
    for (let i = 0; i < route.limit; i++) {
      const ok = await post(route.mod, route.body(), fromIp("203.0.113.9"));
      expect(ok.status).toBe(201);
    }

    const over = await post(route.mod, route.body(), fromIp("203.0.113.9"));

    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ success: false, message: "Too many attempts. Try again later." });
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(created(route)).toHaveBeenCalledTimes(route.limit); // the 429'd attempt created nothing
  });

  it("a different client is unaffected (independent keys)", async () => {
    for (let i = 0; i < route.limit; i++) await post(route.mod, route.body(), fromIp("203.0.113.9"));

    expect((await post(route.mod, route.body(), fromIp("203.0.113.9"))).status).toBe(429);
    expect((await post(route.mod, route.body(), fromIp("203.0.113.10"))).status).toBe(201);
  });

  it("client-controlled headers cannot bypass the limit (left-of-proxy entries, X-Real-IP, CF-Connecting-IP)", async () => {
    for (let i = 0; i < route.limit; i++) await post(route.mod, route.body(), fromIp("203.0.113.9"));

    for (let i = 0; i < 12; i++) {
      const res = await post(route.mod, route.body(), {
        "x-forwarded-for": `10.1.1.${i}, 172.16.5.${i}, 203.0.113.9`,
        "x-real-ip": `198.51.100.${i}`,
        "cf-connecting-ip": `192.0.2.${i}`,
      });
      expect(res.status).toBe(429);
    }
  });

  it("malformed or missing forwarded headers share one unresolved bucket rather than earning a private one", async () => {
    const cap = route.limit * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;
    // Duplicate-email attempts are cheap and count, so the shared cap can be filled quickly.
    h.findUserByEmail.mockReturnValue({ id: "existing" });

    for (let i = 0; i < cap; i++) {
      const headers = i % 3 === 0 ? {} : i % 3 === 1 ? fromIp("not-an-ip") : fromIp("999.1.1.1");
      expect((await post(route.mod, route.body(), headers)).status).toBe(400);
    }

    expect((await post(route.mod, route.body(), fromIp("also-garbage"))).status).toBe(429);
    // ...while a well-formed client is unaffected by that shared bucket.
    expect((await post(route.mod, route.body(), fromIp("203.0.113.44"))).status).toBe(400); // duplicate email, not 429
  });

  it("the quota resets after an hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    for (let i = 0; i < route.limit; i++) await post(route.mod, route.body(), fromIp("203.0.113.9"));
    expect((await post(route.mod, route.body(), fromIp("203.0.113.9"))).status).toBe(429);

    vi.setSystemTime(new Date(Date.now() + HOUR + 1000));

    expect((await post(route.mod, route.body(), fromIp("203.0.113.9"))).status).toBe(201);
  });

  it("malformed requests do NOT use a slot: invalid JSON, missing fields and weak passwords are free", async () => {
    for (let i = 0; i < route.limit * 3; i++) {
      expect((await post(route.mod, null, fromIp("203.0.113.9"), "{not json")).status).toBe(400);
      expect((await post(route.mod, route.weak(route.body()), fromIp("203.0.113.9"))).status).toBe(400);
      expect((await post(route.mod, {}, fromIp("203.0.113.9"))).status).toBe(400);
    }

    for (let i = 0; i < route.limit; i++) expect((await post(route.mod, route.body(), fromIp("203.0.113.9"))).status).toBe(201);
  });

  it("an attempt that reaches the duplicate-email check DOES use a slot, so email probing is bounded too", async () => {
    h.findUserByEmail.mockReturnValue({ id: "existing" });

    for (let i = 0; i < route.limit; i++) {
      const res = await post(route.mod, route.body(), fromIp("203.0.113.9"));
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("Unable to create account.");
    }

    h.findUserByEmail.mockReturnValue(undefined); // even a genuinely new email is now refused
    expect((await post(route.mod, route.body(), fromIp("203.0.113.9"))).status).toBe(429);
    expect(created(route)).not.toHaveBeenCalled();
  });

  it("the 429 body is generic: it reveals nothing about the account, the limit or the client", async () => {
    for (let i = 0; i < route.limit; i++) await post(route.mod, route.body(), fromIp("203.0.113.9"));

    const text = JSON.stringify(await (await post(route.mod, route.body(), fromIp("203.0.113.9"))).json());

    expect(text).not.toMatch(/203\.0\.113|@x\.test|limit|ip/i);
  });
});

describe.each(ROUTES)("$name — default policy (TRUSTED_PROXY_HOPS unset): no header is trusted", (route) => {
  it("every request shares one site-wide bucket with a raised cap; spoofed headers cannot escape it", async () => {
    const cap = route.limit * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;
    h.findUserByEmail.mockReturnValue({ id: "existing" }); // cheap path that still counts

    for (let i = 0; i < cap; i++) {
      const res = await post(route.mod, route.body(), { "x-forwarded-for": `203.0.113.${i % 250}`, "x-real-ip": `198.51.100.${i % 250}` });
      expect(res.status).toBe(400);
    }

    const over = await post(route.mod, route.body(), { "x-forwarded-for": "203.0.113.251", "x-real-ip": "198.51.100.251" });
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).not.toBeNull();
  });

  it("legitimate signups still succeed under the raised shared cap", async () => {
    const res = await post(route.mod, route.body(), fromIp("203.0.113.9"));

    expect(res.status).toBe(201);
    expect(created(route)).toHaveBeenCalledTimes(1);
  });
});

describe("the three endpoints keep separate buckets", () => {
  it("exhausting gym signup does not limit member signup, and web and mobile signup are independent", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 3; i++) await post(ROUTES[0].mod, ROUTES[0].body(), fromIp("203.0.113.9"));
    expect((await post(ROUTES[0].mod, ROUTES[0].body(), fromIp("203.0.113.9"))).status).toBe(429);

    for (let i = 0; i < 10; i++) await post(ROUTES[1].mod, ROUTES[1].body(), fromIp("203.0.113.9"));
    expect((await post(ROUTES[1].mod, ROUTES[1].body(), fromIp("203.0.113.9"))).status).toBe(429);

    expect((await post(ROUTES[2].mod, ROUTES[2].body(), fromIp("203.0.113.9"))).status).toBe(201); // mobile untouched
  });
});
