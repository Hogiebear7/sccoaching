// verifyRequestSession (lib/mobile-auth.ts) — the one place every route resolves
// a request's session. A validly signed, unexpired token is only honoured while
// its account exists and is not archived. Tokens are stateless, so archiving
// can't revoke them; checking the account per request makes deactivation take
// effect on the next request, and restoring the account makes the SAME token
// work again (no schema change, no token-version mechanism).
//   * cookie and Bearer transports are both covered
//   * an archived or deleted account reads exactly like no session (null), so
//     callers keep their existing unauthorized response and nothing reveals
//     which of the two it was
//   * invalid / expired tokens are still rejected before any account lookup
//   * a Bearer token whose account is archived is NOT retried against the cookie
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyRequestSession } from "@/lib/mobile-auth";
import { MEMBER_SESSION_LIFETIME_MS, STAFF_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db", () => h);

type U = { id: string; role: string; archivedAt: string | null };
let users: Record<string, U>;

const token = (userId: string, lifetime = MEMBER_SESSION_LIFETIME_MS) => signSession({ userId }, lifetime);
const withCookie = (t: string) => new NextRequest("http://localhost/api/x", { headers: { Cookie: `session=${t}` } });
const withBearer = (t: string, cookie?: string) =>
  new NextRequest("http://localhost/api/x", { headers: { Authorization: `Bearer ${t}`, ...(cookie ? { Cookie: `session=${cookie}` } : {}) } });

beforeEach(() => {
  vi.clearAllMocks();
  users = {
    live: { id: "live", role: "admin", archivedAt: null },
    gone: { id: "gone", role: "member", archivedAt: "2026-09-01T00:00:00.000Z" },
  };
  h.findUserById.mockImplementation((id: string) => users[id]);
});
afterEach(() => vi.useRealTimers());

describe("verifyRequestSession: account state", () => {
  it("accepts a non-archived user (cookie and Bearer)", () => {
    expect(verifyRequestSession(withCookie(token("live")))).toEqual({ userId: "live" });
    expect(verifyRequestSession(withBearer(token("live")))).toEqual({ userId: "live" });
  });

  it("rejects a valid session cookie for an archived user", () => {
    expect(verifyRequestSession(withCookie(token("gone")))).toBeNull();
  });

  it("rejects a valid Bearer token for an archived user", () => {
    expect(verifyRequestSession(withBearer(token("gone", STAFF_SESSION_LIFETIME_MS)))).toBeNull();
  });

  it("accepts the SAME token again once the account is restored (no re-login, no token change)", () => {
    const t = token("gone");
    expect(verifyRequestSession(withCookie(t))).toBeNull();

    users.gone.archivedAt = null; // restored

    expect(verifyRequestSession(withCookie(t))).toEqual({ userId: "gone" });
    expect(verifyRequestSession(withBearer(t))).toEqual({ userId: "gone" });
  });

  it("rejects the token of a deleted user (cookie and Bearer)", () => {
    const t = token("deleted-user");

    expect(verifyRequestSession(withCookie(t))).toBeNull();
    expect(verifyRequestSession(withBearer(t))).toBeNull();
  });

  it("an archived user, a deleted user and no session at all are indistinguishable (all null)", () => {
    const results = [
      verifyRequestSession(withCookie(token("gone"))),
      verifyRequestSession(withCookie(token("deleted-user"))),
      verifyRequestSession(new NextRequest("http://localhost/api/x")),
    ];

    expect(results).toEqual([null, null, null]);
  });

  it("does not fall back to the cookie when a valid Bearer token belongs to an archived account", () => {
    // Otherwise a request could silently authenticate as a DIFFERENT account.
    expect(verifyRequestSession(withBearer(token("gone"), token("live")))).toBeNull();
  });

  it("still falls back to the cookie when the Bearer token itself is invalid (existing behaviour)", () => {
    expect(verifyRequestSession(withBearer("not-a-real-token", token("live")))).toEqual({ userId: "live" });
  });
});

describe("verifyRequestSession: token validity is still enforced first", () => {
  it("rejects a tampered or garbage token without looking the account up", () => {
    expect(verifyRequestSession(withCookie("garbage.token"))).toBeNull();
    expect(verifyRequestSession(withBearer("garbage.token"))).toBeNull();
    expect(h.findUserById).not.toHaveBeenCalled();
  });

  it("rejects an expired token without looking the account up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const t = token("live", STAFF_SESSION_LIFETIME_MS);
    vi.setSystemTime(STAFF_SESSION_LIFETIME_MS + 1);

    expect(verifyRequestSession(withCookie(t))).toBeNull();
    expect(verifyRequestSession(withBearer(t))).toBeNull();
    expect(h.findUserById).not.toHaveBeenCalled();
  });
});
