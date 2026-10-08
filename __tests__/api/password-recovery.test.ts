// Password recovery regression suite. The flow (POST /api/auth/forgot-password, then POST /api/auth/reset-password) was inspected and is
// complete and safe: tokens are random, stored only as a hash, expire after 15 minutes, work once, and a successful reset invalidates the
// member's other outstanding tokens; the forgot-password answer and its rate limit are identical for known and unknown addresses; a weak
// password is rejected before the token is spent. There was no test for any of it, so this pins the behaviour.
//
// REAL routes, REAL login route, REAL temporary datastore, fake accounts only. The email sender is spied on (no email is sent) so the
// token the member would receive can be read back from the message the route builds.
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;
let sent: { to: string; html: string; text: string }[];

const OLD_PASSWORD = "Old-password-123!";
const NEW_PASSWORD = "New-password-456!";
const GENERIC = "If an account exists for that email, a password reset link has been sent.";
const INVALID = "This reset link is invalid or has expired.";

async function post(route: string, body: unknown) {
  const mod = await import(`@/app/api/auth/${route}/route`);
  return mod.POST(
    new NextRequest(`http://localhost/api/auth/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}
const forgot = (email: string) => post("forgot-password", { email });
const reset = (token: unknown, password: unknown) => post("reset-password", { token, password });
const login = (email: string, password: string) => post("login", { email, password });

/** The token the member would receive, read from the email the route built. */
function tokenFromLastEmail(): string {
  const last = sent.at(-1);
  expect(last).toBeDefined();
  const m = last!.text.match(/reset-password\?token=([a-f0-9]{64})/);
  expect(m, "reset link in email").not.toBeNull();
  return m![1];
}

function storedResetTokens(): { tokenHash: string; userId: string; expiresAt: string }[] {
  return JSON.parse(readFileSync(path.join(fx.dir, "db.json"), "utf8")).resetTokens;
}

let member: { id: string; email: string };

beforeEach(async () => {
  fx = await createFixture();
  sent = [];
  const email = await import("@/lib/email");
  vi.spyOn(email, "sendEmail").mockImplementation(async (payload) => {
    sent.push({ to: payload.to, html: payload.html ?? "", text: payload.text ?? "" });
  });
  const { hashPassword } = await import("@/lib/password");
  const user = fx.db.createUserWithRole("recover@example.test", hashPassword(OLD_PASSWORD), "member", null);
  member = { id: user.id, email: "recover@example.test" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fx.cleanup();
});

describe("requesting a reset", () => {
  it("gives the same answer for a known and an unknown address, and only a known one gets a token and an email", async () => {
    const known = await forgot(member.email);
    const unknown = await forgot("nobody-here@example.test");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await known.json()).toEqual({ success: true, message: GENERIC });
    expect(await unknown.json()).toEqual({ success: true, message: GENERIC });

    expect(sent.map((s) => s.to)).toEqual([member.email]);
    expect(storedResetTokens().map((t) => t.userId)).toEqual([member.id]);
  });

  it("matches the address case-insensitively", async () => {
    await forgot("RECOVER@Example.Test");
    expect(sent).toHaveLength(1);
  });

  it("stores only a hash of the token, never the token", async () => {
    await forgot(member.email);
    const token = tokenFromLastEmail();
    const stored = storedResetTokens();
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(token);
    expect(readFileSync(path.join(fx.dir, "db.json"), "utf8")).not.toContain(token);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rate-limits per address with the same 429 for a real and a made-up address, so the limit reveals nothing", async () => {
    const statuses = async (email: string) => [(await forgot(email)).status, (await forgot(email)).status, (await forgot(email)).status, (await forgot(email)).status];
    expect(await statuses(member.email)).toEqual([200, 200, 200, 429]);
    expect(await statuses("ghost@example.test")).toEqual([200, 200, 200, 429]);
    expect(sent).toHaveLength(3);
  });

  it("rejects a missing or non-string email without creating anything", async () => {
    for (const bad of [undefined, null, "", "   ", 5]) expect((await post("forgot-password", { email: bad })).status).toBe(400);
    expect(storedResetTokens()).toHaveLength(0);
  });
});

describe("resetting with a valid token", () => {
  it("sets the new password for the right account, keeps the account intact, and the old password stops working", async () => {
    const before = { ...fx.db.findUserById(member.id)! };
    await forgot(member.email);

    const res = await reset(tokenFromLastEmail(), NEW_PASSWORD);

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Password updated. You can now log in.");
    expect((await login(member.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(member.email, OLD_PASSWORD)).status).toBe(401);

    const after = fx.db.findUserById(member.id)!;
    expect(after).toMatchObject({ id: before.id, email: before.email, role: before.role });
    expect(after.gymId ?? null).toBe(before.gymId ?? null);
    expect(after.passwordHash).not.toBe(before.passwordHash);
  });

  it("changes only the account the token was issued for", async () => {
    const { hashPassword } = await import("@/lib/password");
    const other = fx.db.createUserWithRole("bystander@example.test", hashPassword(OLD_PASSWORD), "member", null);
    const otherHash = fx.db.findUserById(other.id)!.passwordHash;
    await forgot(member.email);
    await reset(tokenFromLastEmail(), NEW_PASSWORD);
    expect(fx.db.findUserById(other.id)!.passwordHash).toBe(otherHash);
    expect((await login("bystander@example.test", OLD_PASSWORD)).status).toBe(200);
  });

  it("invalidates the member's other outstanding tokens", async () => {
    await forgot(member.email);
    const first = tokenFromLastEmail();
    const { createResetToken } = fx.db;
    const second = createResetToken(member.id).token;
    expect(storedResetTokens()).toHaveLength(2);

    expect((await reset(second, NEW_PASSWORD)).status).toBe(200);

    expect(storedResetTokens()).toHaveLength(0);
    const replay = await reset(first, "Another-password-789!");
    expect(replay.status).toBe(400);
    expect((await login(member.email, NEW_PASSWORD)).status).toBe(200);
  });
});

describe("a token cannot be reused", () => {
  it("the second use of a spent token is refused with the generic message and changes nothing", async () => {
    await forgot(member.email);
    const token = tokenFromLastEmail();
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);

    const again = await reset(token, "Attacker-password-1!");
    expect(again.status).toBe(400);
    expect((await again.json()).message).toBe(INVALID);
    expect((await login(member.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(member.email, "Attacker-password-1!")).status).toBe(401);
  });
});

describe("an expired token", () => {
  it("is refused with the same generic message after 15 minutes, and leaves the password alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    await forgot(member.email);
    const token = tokenFromLastEmail();
    expect(storedResetTokens()[0].expiresAt).toBe("2026-10-08T10:15:00.000Z");

    vi.setSystemTime(new Date("2026-10-08T10:15:01Z"));
    const res = await reset(token, NEW_PASSWORD);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe(INVALID);
    expect((await login(member.email, OLD_PASSWORD)).status).toBe(200);
  });

  it("still works one minute before it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    await forgot(member.email);
    const token = tokenFromLastEmail();
    vi.setSystemTime(new Date("2026-10-08T10:14:00Z"));
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
  });
});

describe("an invalid token", () => {
  it("is refused with the same message as an expired or spent one, so the error says nothing about why", async () => {
    for (const token of ["f".repeat(64), "not-a-real-token", "0".repeat(10)]) {
      const res = await reset(token, NEW_PASSWORD);
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe(INVALID);
    }
    expect((await login(member.email, OLD_PASSWORD)).status).toBe(200);
  });

  it("requires a token and a password, and rejects non-strings", async () => {
    expect((await reset(undefined, NEW_PASSWORD)).status).toBe(400);
    expect((await reset("", NEW_PASSWORD)).status).toBe(400);
    expect((await reset({ $ne: "" }, NEW_PASSWORD)).status).toBe(400);
    expect((await reset("t".repeat(64), undefined)).status).toBe(400);
    expect((await reset("t".repeat(64), "   ")).status).toBe(400);
  });
});

describe("a weak password", () => {
  it("is refused before the token is spent, so the member can try again with the same link", async () => {
    await forgot(member.email);
    const token = tokenFromLastEmail();

    const weak = await reset(token, "short");
    expect(weak.status).toBe(400);
    expect(storedResetTokens()).toHaveLength(1);
    expect((await login(member.email, OLD_PASSWORD)).status).toBe(200);

    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
  });
});

describe("tenant and payment records", () => {
  it("are untouched by a reset", async () => {
    const subsBefore = JSON.stringify(fx.db.findAllSubscriptions());
    const gymBefore = fx.db.findUserById(member.id)!.gymId ?? null;
    await forgot(member.email);
    await reset(tokenFromLastEmail(), NEW_PASSWORD);
    expect(JSON.stringify(fx.db.findAllSubscriptions())).toBe(subsBefore);
    expect(fx.db.findUserById(member.id)!.gymId ?? null).toBe(gymBefore);
  });
});
