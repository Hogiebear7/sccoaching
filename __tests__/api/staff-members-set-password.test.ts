// POST /api/staff/members/set-password: an admin sets a temporary password for a MEMBER who can't use email.
// Real signed sessions, real can() / sameGym() / guards; only the datastore and the email sender are mocked.
// What this proves: same-gym + admin-only + members-only; a blocked target reads exactly like a missing one and
// nothing is written or emailed; the password is returned once (no-store), stored only as a verifying hash, never
// logged and never put in the email; it always satisfies the password rules.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyPassword, validatePasswordStrength } from "@/lib/password";
import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";
import { generateTempPassword } from "@/lib/temp-password";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  updateUserPassword: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ findUserById: h.findUserById, updateUserPassword: h.updateUserPassword }));
vi.mock("@/lib/email", () => ({ sendEmail: h.sendEmail }));

const ADMIN_A = { id: "admin-a", email: "admina@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const ADMIN_B = { id: "admin-b", email: "adminb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const COACH_A = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const MEMBER_A = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const MEMBER_B = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
const NOT_FOUND = { success: false, message: "Member not found." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const mod = await import("@/app/api/staff/members/set-password/route");
  const req = new NextRequest("http://localhost/api/staff/members/set-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` } : {}),
    },
    body: rawBody ?? JSON.stringify(body),
  });
  return mod.POST(req);
}
const setPw = (userId: string, as: string = ADMIN_A.id) => post({ userId }, as);

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  h.findUserById.mockImplementation((id: string) => [ADMIN_A, ADMIN_B, COACH_A, MEMBER_A, MEMBER_B].find((u) => u.id === id));
});
afterEach(() => logSpy.mockRestore());

const nothingHappened = () => {
  expect(h.updateUserPassword).not.toHaveBeenCalled();
  expect(h.sendEmail).not.toHaveBeenCalled();
};

describe("setting a temporary password", () => {
  it("an admin sets one for a same-gym member: returned once, stored only as a hash that verifies", async () => {
    const res = await setPw(MEMBER_A.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(data.success).toBe(true);
    expect(validatePasswordStrength(data.temporaryPassword)).toBeNull();

    expect(h.updateUserPassword).toHaveBeenCalledTimes(1);
    const [userId, hash] = h.updateUserPassword.mock.calls[0];
    expect(userId).toBe(MEMBER_A.id);
    expect(hash).not.toContain(data.temporaryPassword);
    expect(verifyPassword(data.temporaryPassword, hash)).toBe(true);
  });

  it("never logs the password and never puts it in the email; the member's address gets a notice", async () => {
    const data = await (await setPw(MEMBER_A.id)).json();

    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(data.temporaryPassword);
    expect(JSON.stringify(logSpy.mock.calls)).toContain("member-a");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(MEMBER_A.email);
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain(data.temporaryPassword);
  });

  it("works within the second gym too", async () => {
    expect((await setPw(MEMBER_B.id, ADMIN_B.id)).status).toBe(200);
    expect(h.updateUserPassword.mock.calls[0][0]).toBe(MEMBER_B.id);
  });

  it("each call makes a different password", async () => {
    const a = (await (await setPw(MEMBER_A.id)).json()).temporaryPassword;
    const b = (await (await setPw(MEMBER_A.id)).json()).temporaryPassword;
    expect(a).not.toBe(b);
  });
});

describe("who may, and on whom", () => {
  it("a cross-gym target is the same 404 as a missing one, and nothing is written or sent", async () => {
    const cross = await setPw(MEMBER_B.id, ADMIN_A.id);
    const crossBody = await cross.json();
    const missing = await setPw("member-missing");
    expect(cross.status).toBe(404);
    expect(crossBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossBody);
    expect("temporaryPassword" in crossBody).toBe(false);
    nothingHappened();
  });

  it("a staff account is refused as a target even for an admin in the same gym (members only), reading as not found", async () => {
    for (const target of [COACH_A.id, ADMIN_A.id]) {
      const res = await setPw(target);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    nothingHappened();
  });

  it("a coach lacks members.account: 403, nothing written", async () => {
    const res = await setPw(MEMBER_A.id, COACH_A.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "Only staff can manage members." });
    nothingHappened();
  });

  it("an unauthenticated request is 401", async () => {
    const res = await post({ userId: MEMBER_A.id });
    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("validates the request without writing anything", async () => {
    expect((await post(undefined, ADMIN_A.id, "{not json")).status).toBe(400);
    expect((await post({}, ADMIN_A.id)).status).toBe(400);
    nothingHappened();
  });
});

describe("generateTempPassword", () => {
  it("is always valid under the app's password rules, easy to read aloud, and well spread", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const p = generateTempPassword();
      expect(validatePasswordStrength(p)).toBeNull();
      expect(p).toMatch(/^[A-HJ-NP-Z][a-km-z]{3}-[a-km-z]{4}-[2-9]{4}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(500);
  });
});
