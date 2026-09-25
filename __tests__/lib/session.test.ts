// Session-expiry enforcement. Previously lib/session.ts had no iat/exp
// concept at all — a signed token was valid forever, and logout (cookie
// deletion) was the only way to invalidate it, which does nothing against a
// copy of the token held outside the browser (XSS, disk capture, etc.).
// This slice adds an absolute, tiered expiry (member: 7 days, staff/admin:
// 24 hours) enforced inside verifySession() itself, the single choke point
// shared by verifyRequestSession() (cookie + Bearer), authorizeStaffRequest()
// and requireStaffPage() (cookie-only). See
// docs/tenant-boundary-audit-2026-09.md for the originating audit item.
//
// requireStaffPage() is NOT independently tested here — it calls the exact
// same verifySession() as authorizeStaffRequest() (lib/staff-auth.ts:27 vs
// :58), so expiry rejection is covered by construction. Building a
// server-component test harness for it is out of scope for this slice.
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/password";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  MEMBER_SESSION_LIFETIME_MS,
  STAFF_SESSION_LIFETIME_MS,
  signSession,
  verifySession,
} from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  consumeMobileHandoffToken: vi.fn(),
  createGym: vi.fn(),
  createUserWithRole: vi.fn(),
  findGymBySlug: vi.fn(),
  setUserGymId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// Matches the SESSION_SECRET the test env sets (vitest.config.ts) — used
// only to forge raw tokens with a correct signature but a malformed payload,
// so we can exercise verifySession's defensive parsing directly rather than
// only through the public signSession() shape.
const TEST_SECRET = "test-session-secret-do-not-use-in-production";

function rawSign(encodedPayload: string): string {
  return createHmac("sha256", TEST_SECRET).update(encodedPayload).digest("hex");
}

function buildRawToken(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${rawSign(encoded)}`;
}

function decodeToken(token: string): { userId?: unknown; iat?: unknown; exp?: unknown } {
  const [encoded] = token.split(".");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signSession / verifySession round trip", () => {
  it("signs and verifies a member-lifetime token", () => {
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    expect(verifySession(token)).toEqual({ userId: "member-1" });
  });

  it("signs and verifies a staff-lifetime token", () => {
    const token = signSession({ userId: "staff-1" }, STAFF_SESSION_LIFETIME_MS);
    expect(verifySession(token)).toEqual({ userId: "staff-1" });
  });

  it("never exposes iat/exp to the caller", () => {
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const result = verifySession(token);
    expect(result).toEqual({ userId: "member-1" });
    expect(Object.keys(result ?? {})).toEqual(["userId"]);
  });
});

describe("expiry enforcement", () => {
  it("rejects an expired member token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);

    vi.setSystemTime(MEMBER_SESSION_LIFETIME_MS + 1);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects an expired staff token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "staff-1" }, STAFF_SESSION_LIFETIME_MS);

    vi.setSystemTime(STAFF_SESSION_LIFETIME_MS + 1);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects exactly at Date.now() === exp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);

    vi.setSystemTime(MEMBER_SESSION_LIFETIME_MS);
    expect(verifySession(token)).toBeNull();
  });

  it("accepts at Date.now() === exp - 1", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);

    vi.setSystemTime(MEMBER_SESSION_LIFETIME_MS - 1);
    expect(verifySession(token)).toEqual({ userId: "member-1" });
  });
});

describe("malformed timestamp defenses", () => {
  it("rejects a token with a missing iat", () => {
    const token = buildRawToken({ userId: "u1", exp: Date.now() + 1000 });
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token with a non-numeric iat", () => {
    const token = buildRawToken({ userId: "u1", iat: "not-a-number", exp: Date.now() + 1000 });
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token with a missing exp", () => {
    const token = buildRawToken({ userId: "u1", iat: Date.now() });
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token with a non-numeric exp", () => {
    const token = buildRawToken({ userId: "u1", iat: Date.now(), exp: "not-a-number" });
    expect(verifySession(token)).toBeNull();
  });
});

describe("tamper resistance (regression guard on existing behaviour)", () => {
  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const [encoded, signature] = token.split(".");
    const payload = decodeToken(token);
    const tamperedEncoded = Buffer.from(
      JSON.stringify({ ...payload, userId: "someone-else" }),
      "utf-8"
    ).toString("base64url");

    expect(verifySession(`${tamperedEncoded}.${signature}`)).toBeNull();
    expect(encoded).not.toBe(tamperedEncoded); // sanity: the tamper actually changed the payload
  });

  it("rejects a tampered signature", () => {
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const [encoded, signature] = token.split(".");
    const flipped = (signature[0] === "0" ? "1" : "0") + signature.slice(1);

    expect(verifySession(`${encoded}.${flipped}`)).toBeNull();
  });

  it("rejects an incorrect signature length", () => {
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const [encoded, signature] = token.split(".");

    expect(verifySession(`${encoded}.${signature.slice(0, -4)}`)).toBeNull();
  });
});

describe("verifyRequestSession integration (lib/mobile-auth)", () => {
  // verifyRequestSession also requires the token's account to exist and not be
  // archived (see __tests__/lib/verify-request-session-archived.test.ts), so a
  // live account is set up here for the "accepts" cases.
  beforeEach(() => {
    h.findUserById.mockReturnValue({ id: "member-1", role: "member", archivedAt: null });
  });

  it("accepts a valid session cookie", async () => {
    const { verifyRequestSession } = await import("@/lib/mobile-auth");
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const req = new NextRequest("http://localhost/api/whatever", {
      headers: { Cookie: `session=${token}` },
    });
    expect(verifyRequestSession(req)).toEqual({ userId: "member-1" });
  });

  it("accepts a valid Bearer token", async () => {
    const { verifyRequestSession } = await import("@/lib/mobile-auth");
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    const req = new NextRequest("http://localhost/api/whatever", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(verifyRequestSession(req)).toEqual({ userId: "member-1" });
  });

  it("rejects an expired session cookie", async () => {
    const { verifyRequestSession } = await import("@/lib/mobile-auth");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    vi.setSystemTime(MEMBER_SESSION_LIFETIME_MS + 1);

    const req = new NextRequest("http://localhost/api/whatever", {
      headers: { Cookie: `session=${token}` },
    });
    expect(verifyRequestSession(req)).toBeNull();
  });

  it("rejects an expired Bearer token", async () => {
    const { verifyRequestSession } = await import("@/lib/mobile-auth");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "staff-1" }, STAFF_SESSION_LIFETIME_MS);
    vi.setSystemTime(STAFF_SESSION_LIFETIME_MS + 1);

    const req = new NextRequest("http://localhost/api/whatever", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(verifyRequestSession(req)).toBeNull();
  });
});

describe("authorizeStaffRequest integration (lib/staff-auth)", () => {
  it("rejects an expired staff session with the existing 401 shape", async () => {
    const { authorizeStaffRequest } = await import("@/lib/staff-auth");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "staff-1" }, STAFF_SESSION_LIFETIME_MS);
    vi.setSystemTime(STAFF_SESSION_LIFETIME_MS + 1);

    const req = new NextRequest("http://localhost/api/staff/whatever", {
      headers: { Cookie: `session=${token}` },
    });
    const result = authorizeStaffRequest(req, "classes.manage");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.message).toBe("You must be signed in.");
    }
    // Expiry is caught before any user lookup — same as a missing session.
    expect(h.findUserById).not.toHaveBeenCalled();
  });
});

describe("/api/mobile/auth/me rejection", () => {
  it("returns the existing plain 401 shape for an expired Bearer token", async () => {
    const { GET } = await import("@/app/api/mobile/auth/me/route");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signSession({ userId: "member-1" }, MEMBER_SESSION_LIFETIME_MS);
    vi.setSystemTime(MEMBER_SESSION_LIFETIME_MS + 1);

    const req = new NextRequest("http://localhost/api/mobile/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "Not signed in." });
    expect(h.findUserById).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login lifetime classification", () => {
  async function callLogin(body: unknown) {
    const { POST } = await import("@/app/api/auth/login/route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(request);
  }

  it("issues a 7-day cookie for a member", async () => {
    h.findUserByEmail.mockReturnValue({
      id: "member-1",
      email: "member@example.com",
      role: "member",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      archivedAt: null,
    });

    const res = await callLogin({ email: "member@example.com", password: "correct-horse-battery-staple" });
    expect(res.status).toBe(200);

    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(MEMBER_SESSION_LIFETIME_MS / 1000);
    const payload = decodeToken(cookie!.value);
    expect((payload.exp as number) - (payload.iat as number)).toBe(MEMBER_SESSION_LIFETIME_MS);
  });

  it("issues a 24-hour cookie for a staff/admin user", async () => {
    h.findUserByEmail.mockReturnValue({
      id: "staff-1",
      email: "staff@example.com",
      role: "admin_manager",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      archivedAt: null,
    });

    const res = await callLogin({ email: "staff@example.com", password: "correct-horse-battery-staple" });
    expect(res.status).toBe(200);

    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(STAFF_SESSION_LIFETIME_MS / 1000);
    const payload = decodeToken(cookie!.value);
    expect((payload.exp as number) - (payload.iat as number)).toBe(STAFF_SESSION_LIFETIME_MS);
  });
});

describe("POST /api/mobile/auth/login lifetime classification", () => {
  async function callMobileLogin(body: unknown) {
    const { POST } = await import("@/app/api/mobile/auth/login/route");
    const request = new Request("http://localhost/api/mobile/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(request);
  }

  it("issues a member-lifetime token", async () => {
    h.findUserByEmail.mockReturnValue({
      id: "member-1",
      email: "member@example.com",
      role: "member",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      archivedAt: null,
    });

    const res = await callMobileLogin({ email: "member@example.com", password: "correct-horse-battery-staple" });
    const data = await res.json();
    const payload = decodeToken(data.token);
    expect((payload.exp as number) - (payload.iat as number)).toBe(MEMBER_SESSION_LIFETIME_MS);
  });

  it("issues a staff-lifetime token for a coach/admin/admin_manager user", async () => {
    h.findUserByEmail.mockReturnValue({
      id: "coach-1",
      email: "coach@example.com",
      role: "coach",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      archivedAt: null,
    });

    const res = await callMobileLogin({ email: "coach@example.com", password: "correct-horse-battery-staple" });
    const data = await res.json();
    const payload = decodeToken(data.token);
    expect((payload.exp as number) - (payload.iat as number)).toBe(STAFF_SESSION_LIFETIME_MS);
  });
});

describe("POST /api/gyms/signup lifetime classification", () => {
  it("issues a 24-hour cookie for the new gym owner (always admin_manager)", async () => {
    h.findUserByEmail.mockReturnValue(undefined);
    h.findGymBySlug.mockReturnValue(undefined);
    h.createUserWithRole.mockReturnValue({ id: "owner-1", email: "owner@example.com", role: "admin_manager" });

    const { POST } = await import("@/app/api/gyms/signup/route");
    const req = new NextRequest("http://localhost/api/gyms/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gymName: "Iron Peak Fitness",
        addressLine: "123 Main St, Cork",
        ownerEmail: "owner@example.com",
        password: "TestPass123!",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(STAFF_SESSION_LIFETIME_MS / 1000);
    const payload = decodeToken(cookie!.value);
    expect((payload.exp as number) - (payload.iat as number)).toBe(STAFF_SESSION_LIFETIME_MS);
  });
});

describe("GET /api/auth/web-handoff lifetime classification", () => {
  async function callHandoff(token: string) {
    const { GET } = await import("@/app/api/auth/web-handoff/route");
    const request = new NextRequest(`http://localhost/api/auth/web-handoff?token=${token}`);
    return GET(request);
  }

  it("sets a 7-day cookie for a member handoff", async () => {
    h.consumeMobileHandoffToken.mockReturnValue("member-1");
    h.findUserById.mockReturnValue({ id: "member-1", role: "member", archivedAt: null });

    const res = await callHandoff("handoff-token");
    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(MEMBER_SESSION_LIFETIME_MS / 1000);
    const payload = decodeToken(cookie!.value);
    expect((payload.exp as number) - (payload.iat as number)).toBe(MEMBER_SESSION_LIFETIME_MS);
  });

  it("sets a 24-hour cookie for a staff/admin handoff", async () => {
    h.consumeMobileHandoffToken.mockReturnValue("staff-1");
    h.findUserById.mockReturnValue({ id: "staff-1", role: "admin", archivedAt: null });

    const res = await callHandoff("handoff-token");
    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(STAFF_SESSION_LIFETIME_MS / 1000);
    const payload = decodeToken(cookie!.value);
    expect((payload.exp as number) - (payload.iat as number)).toBe(STAFF_SESSION_LIFETIME_MS);
  });

  it("does not mint a session and redirects to login when the resolved user no longer exists", async () => {
    h.consumeMobileHandoffToken.mockReturnValue("deleted-user");
    h.findUserById.mockReturnValue(undefined);

    const res = await callHandoff("handoff-token");
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get("session")).toBeUndefined();
  });
});
