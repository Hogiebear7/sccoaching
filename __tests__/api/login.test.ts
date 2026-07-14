import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/password";
import { verifySession } from "@/lib/session";

const { mockFindUserByEmail } = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserByEmail: mockFindUserByEmail,
}));

async function callLogin(body: unknown) {
  const { POST } = await import("@/app/api/auth/login/route");
  const request = new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    mockFindUserByEmail.mockReset();
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
});
