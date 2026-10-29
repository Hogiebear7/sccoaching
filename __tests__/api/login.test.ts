import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/password";
import { verifySession } from "@/lib/session";
import { resetRateLimits } from "@/lib/rate-limit";

const { mockFindUserByEmail } = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserByEmail: mockFindUserByEmail,
}));

async function callLogin(body: unknown, route: "web" | "mobile" = "web") {
  const { POST } = route === "web" ? await import("@/app/api/auth/login/route") : await import("@/app/api/mobile/auth/login/route");
  const request = new Request(route === "web" ? "http://localhost/api/auth/login" : "http://localhost/api/mobile/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    mockFindUserByEmail.mockReset();
    resetRateLimits();
  });

  it("rejects an unknown email with a generic message", async () => {
    mockFindUserByEmail.mockReturnValue(undefined);

    const res = await callLogin({ email: "nobody@example.com", password: "whatever" });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toEqual({ success: false, message: "Invalid email or password." });
  });

  it("rejects a known email with the wrong password", async () => {
    mockFindUserByEmail.mockReturnValue({
      id: "user-1",
      email: "athlete@example.com",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      createdAt: "now",
      updatedAt: "now",
    });

    const res = await callLogin({ email: "athlete@example.com", password: "wrong-password" });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.message).toBe("Invalid email or password.");
  });

  it("blocks an archived account even with valid credentials", async () => {
    mockFindUserByEmail.mockReturnValue({
      id: "user-1",
      email: "athlete@example.com",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      archivedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "now",
      updatedAt: "now",
    });

    const res = await callLogin({
      email: "athlete@example.com",
      password: "correct-horse-battery-staple",
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toContain("deactivated");
    expect(res.cookies.get("session")).toBeUndefined();
  });

  it("accepts valid credentials and sets a verifiable signed session cookie", async () => {
    mockFindUserByEmail.mockReturnValue({
      id: "user-1",
      email: "athlete@example.com",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      createdAt: "now",
      updatedAt: "now",
    });

    const res = await callLogin({
      email: "athlete@example.com",
      password: "correct-horse-battery-staple",
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const sessionCookie = res.cookies.get("session");
    expect(sessionCookie?.value).toBeTruthy();
    expect(verifySession(sessionCookie!.value)?.userId).toBe("user-1");
  });

  it("rejects a missing password with 400", async () => {
    const res = await callLogin({ email: "athlete@example.com" });
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated attempts against the same email", async () => {
    mockFindUserByEmail.mockReturnValue(undefined);

    for (let i = 0; i < 5; i++) {
      const res = await callLogin({ email: "target@example.com", password: "guess" });
      expect(res.status).toBe(401);
    }

    const blocked = await callLogin({ email: "target@example.com", password: "guess" });
    expect(blocked.status).toBe(429);

    // A different email is unaffected.
    const other = await callLogin({ email: "someone-else@example.com", password: "guess" });
    expect(other.status).toBe(401);
  });

  // Only failed sign-ins count towards the lockout (owner request 2026-10-29): signing in on several devices must never lock a member out.
  describe.each(["web", "mobile"] as const)("lockout counts only failed sign-ins (%s)", (route) => {
    const member = () => ({
      id: "user-1",
      email: "athlete@example.com",
      passwordHash: hashPassword("correct-horse-battery-staple"),
      createdAt: "now",
      updatedAt: "now",
    });

    it("many correct sign-ins in a row are never locked out", async () => {
      mockFindUserByEmail.mockReturnValue(member());
      for (let i = 0; i < 8; i++) {
        const res = await callLogin({ email: "athlete@example.com", password: "correct-horse-battery-staple" }, route);
        expect(res.status).toBe(200);
      }
    });

    it("a correct sign-in resets the count of earlier wrong passwords", async () => {
      mockFindUserByEmail.mockReturnValue(member());
      for (let i = 0; i < 4; i++) expect((await callLogin({ email: "athlete@example.com", password: "wrong" }, route)).status).toBe(401);
      expect((await callLogin({ email: "athlete@example.com", password: "correct-horse-battery-staple" }, route)).status).toBe(200);
      for (let i = 0; i < 4; i++) expect((await callLogin({ email: "athlete@example.com", password: "wrong" }, route)).status).toBe(401);
      expect((await callLogin({ email: "athlete@example.com", password: "wrong" }, route)).status).toBe(401);
      expect((await callLogin({ email: "athlete@example.com", password: "wrong" }, route)).status).toBe(429);
    });

    it("during a lockout the correct password is still refused", async () => {
      mockFindUserByEmail.mockReturnValue(member());
      for (let i = 0; i < 5; i++) await callLogin({ email: "athlete@example.com", password: "wrong" }, route);
      const res = await callLogin({ email: "athlete@example.com", password: "correct-horse-battery-staple" }, route);
      expect(res.status).toBe(429);
    });
  });
});
