// Rate limiting on POST /api/staff/invites. Each invite stores a record and sends a
// platform-branded email to an arbitrary address, so it is capped per signed-in staff
// member (20/hour) and per gym (60/hour). BOTH keys come from the authenticated
// account, never the request, so a client cannot rotate them, and one gym's usage
// never affects another's. The limiter sits after authentication, authorization and
// validation, so a refused or malformed request never uses a slot, and before the
// invite is stored or any email is sent. No IP limit: no verified proxy policy yet.
//
// Real signed sessions, real can()/sameGym()/verifyRequestSession and the real
// limiter; only the datastore and the email sender are mocked. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), createInvite: vi.fn(), findInvites: vi.fn() }));
vi.mock("@/lib/db", () => h);

const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", () => mail);
vi.mock("@/lib/email-templates", () => ({ inviteEmail: () => ({ subject: "s", html: "h", text: "t" }) }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt });

// Tenant A = primary gym (gymId: null convention); Tenant B is a separate gym.
const A_ADMINS = ["admin-a1", "admin-a2", "admin-a3", "admin-a4"].map((id) => user(id, "admin", null));
const A_COACH = user("coach-a", "coach", null);
const A_MEMBER = user("member-a", "member", null);
const B_ADMIN = user("admin-b1", "admin", "gym-b");
const OPERATOR = user("operator", "platform_operator", null);
const ARCHIVED_ADMIN = user("admin-archived", "admin", null, "2026-09-01T00:00:00.000Z");
const WORLD = [...A_ADMINS, A_COACH, A_MEMBER, B_ADMIN, OPERATOR, ARCHIVED_ADMIN];

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
let counter = 0;
async function invite(as?: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) {
  const { POST } = await import("@/app/api/staff/invites/route");
  return POST(
    new NextRequest("http://localhost/api/staff/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}), ...headers },
      body: raw ?? JSON.stringify(body ?? { email: `guest${++counter}@x.test`, tier: "membership" }),
    })
  );
}
const sendMany = async (as: string, n: number) => {
  for (let i = 0; i < n; i++) expect((await invite(as)).status).toBe(201);
};

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.createInvite.mockImplementation((i: { email: string; tier: string }) => ({ invite: { id: `inv-${++counter}`, email: i.email, tier: i.tier }, token: "tok" }));
  h.findInvites.mockReturnValue([]);
  mail.sendEmail.mockResolvedValue(undefined);
});

describe("per-staff limit (20 per hour)", () => {
  it("allows 20 invites, then answers the 21st with 429 — nothing stored, no email sent", async () => {
    await sendMany(A_ADMINS[0].id, 20);

    const over = await invite(A_ADMINS[0].id);

    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ success: false, message: "Too many invites sent. Try again later." });
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(h.createInvite).toHaveBeenCalledTimes(20);
    expect(mail.sendEmail).toHaveBeenCalledTimes(20);
  });

  it("another staff member in the same gym is not blocked by the first one's quota", async () => {
    await sendMany(A_ADMINS[0].id, 20);

    expect((await invite(A_ADMINS[0].id)).status).toBe(429);
    expect((await invite(A_ADMINS[1].id)).status).toBe(201);
  });

  it("a platform operator is limited by the same rule, per account", async () => {
    await sendMany(OPERATOR.id, 20);

    expect((await invite(OPERATOR.id)).status).toBe(429);
  });

  it("the quota resets after an hour", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      await sendMany(A_ADMINS[0].id, 20);
      expect((await invite(A_ADMINS[0].id)).status).toBe(429);

      vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000 + 1000));

      expect((await invite(A_ADMINS[0].id)).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("per-gym backstop (60 per hour) and cross-gym independence", () => {
  it("several staff in one gym cannot together exceed 60 invites an hour", async () => {
    for (const admin of A_ADMINS.slice(0, 3)) await sendMany(admin.id, 20); // 3 x 20 = 60

    const fourth = await invite(A_ADMINS[3].id); // a fresh staff quota, but the gym is spent

    expect(fourth.status).toBe(429);
    expect(h.createInvite).toHaveBeenCalledTimes(60);
  });

  it("Tenant B is unaffected by Tenant A exhausting its staff and gym limits", async () => {
    for (const admin of A_ADMINS.slice(0, 3)) await sendMany(admin.id, 20);
    expect((await invite(A_ADMINS[3].id)).status).toBe(429);

    const b = await invite(B_ADMIN.id);

    expect(b.status).toBe(201);
    expect(h.createInvite).toHaveBeenLastCalledWith(expect.objectContaining({ invitedByStaffId: B_ADMIN.id }));
  });

  it("Tenant A is unaffected by Tenant B exhausting its own quota", async () => {
    await sendMany(B_ADMIN.id, 20);
    expect((await invite(B_ADMIN.id)).status).toBe(429);

    expect((await invite(A_ADMINS[0].id)).status).toBe(201);
  });
});

describe("client-controlled input cannot move or reset a quota", () => {
  it("rotating IP-style headers does not bypass the per-staff limit (no header is consulted)", async () => {
    await sendMany(A_ADMINS[0].id, 20);

    for (let i = 0; i < 10; i++) {
      const res = await invite(A_ADMINS[0].id, undefined, { "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `198.51.100.${i}`, "cf-connecting-ip": `192.0.2.${i}` });
      expect(res.status).toBe(429);
    }
  });

  it("a staff id, gym id or tenant id in the body is ignored: the quota always follows the session", async () => {
    await sendMany(A_ADMINS[0].id, 20);

    const res = await invite(A_ADMINS[0].id, { email: "guest@x.test", tier: "membership", invitedByStaffId: B_ADMIN.id, staffId: B_ADMIN.id, gymId: "gym-b", tenantId: "gym-b" });

    expect(res.status).toBe(429); // still Tenant A's admin, not Tenant B's
    expect(h.createInvite).toHaveBeenCalledTimes(20);
  });
});

describe("refused and malformed requests do not use a slot", () => {
  it.each([
    ["no session", undefined],
    ["a coach (below members.billing)", A_COACH.id],
    ["a plain member", A_MEMBER.id],
    ["an ARCHIVED admin's still-valid session", ARCHIVED_ADMIN.id],
    ["a DELETED account's token", "no-such-actor"],
  ])("%s -> 403, nothing stored or sent, and no quota consumed", async (_label, actor) => {
    for (let i = 0; i < 30; i++) {
      const res = await invite(actor);
      expect(res.status).toBe(403);
      expect((await res.json()).message).toBe("Only staff can manage invites.");
    }
    expect(h.createInvite).not.toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();

    // The real admin still has the full quota afterwards.
    await sendMany(A_ADMINS[0].id, 20);
  });

  it("invalid JSON, a bad email and a bad tier are 400s that consume nothing", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await invite(A_ADMINS[0].id, undefined, {}, "{not json")).status).toBe(400);
      expect((await invite(A_ADMINS[0].id, { email: "not-an-email", tier: "membership" })).status).toBe(400);
      expect((await invite(A_ADMINS[0].id, { email: "guest@x.test", tier: "free" })).status).toBe(400);
    }
    expect(h.createInvite).not.toHaveBeenCalled();

    await sendMany(A_ADMINS[0].id, 20);
  });

  it("a restored admin can invite again with the same session", async () => {
    expect((await invite(ARCHIVED_ADMIN.id)).status).toBe(403);

    ARCHIVED_ADMIN.archivedAt = null;
    try {
      expect((await invite(ARCHIVED_ADMIN.id)).status).toBe(201);
    } finally {
      ARCHIVED_ADMIN.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});

describe("existing behaviour under the limit", () => {
  it("still stores the invite against the acting staff member and emails it (201)", async () => {
    const res = await invite(A_ADMINS[0].id, { email: "  guest@x.test  ", tier: "app_subscription" });

    expect(res.status).toBe(201);
    expect(h.createInvite).toHaveBeenCalledWith({ email: "guest@x.test", tier: "app_subscription", invitedByStaffId: A_ADMINS[0].id });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("listing invites (GET) is not rate limited and stays gym-scoped", async () => {
    await sendMany(A_ADMINS[0].id, 20);
    const { GET } = await import("@/app/api/staff/invites/route");

    const res = await GET(new NextRequest("http://localhost/api/staff/invites", { headers: { Cookie: cookie(A_ADMINS[0].id) } }));

    expect(res.status).toBe(200);
  });
});
