// POST /api/staff/invites/bulk: preview reads only; send sends to the ready ones, skips people already in the gym or already invited, never reveals another gym's accounts, and is
// limited per gym and per staff member. Real signed sessions and limiter; the datastore and the email sender are mocked. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), createInvite: vi.fn(), findInvites: vi.fn(), findUserByEmail: vi.fn() }));
vi.mock("@/lib/db", () => h);
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", () => mail);
vi.mock("@/lib/email-templates", () => ({ inviteEmail: () => ({ subject: "s", html: "h", text: "t" }) }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, email = `${id}@x.test`): U => ({ id, email, role, gymId, archivedAt: null });
const ADMIN_A = user("admin-a", "admin", null);
const ADMIN_A2 = user("admin-a2", "admin", null);
const COACH_A = user("coach-a", "coach", null);
const MEMBER_A = user("member-a", "member", null, "inside@x.test");
const MEMBER_B = user("member-b", "member", "gym-b", "other@x.test");
const WORLD = [ADMIN_A, ADMIN_A2, COACH_A, MEMBER_A, MEMBER_B];
const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
let counter = 0;

async function post(as: string | undefined, body: unknown) {
  const { POST } = await import("@/app/api/staff/invites/bulk/route");
  return POST(new NextRequest("http://localhost/api/staff/invites/bulk", { method: "POST", headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) }, body: JSON.stringify(body) }));
}
const LIST = "new1@example.com\nnew2@example.com\ninside@x.test\nother@x.test\nnew1@example.com\nbroken";

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.findUserByEmail.mockImplementation((email: string) => WORLD.find((u) => u.email === email));
  h.findInvites.mockReturnValue([]);
  h.createInvite.mockImplementation((i: { email: string; tier: string }) => ({ invite: { id: `inv-${++counter}`, email: i.email, tier: i.tier }, token: "tok" }));
  mail.sendEmail.mockResolvedValue(undefined);
});

describe("access", () => {
  it("is for staff who can manage billing only", async () => {
    expect((await post(undefined, { mode: "preview", tier: "membership", text: LIST })).status).toBe(403);
    expect((await post(COACH_A.id, { mode: "preview", tier: "membership", text: LIST })).status).toBe(403);
    expect((await post(MEMBER_A.id, { mode: "preview", tier: "membership", text: LIST })).status).toBe(403);
  });

  it("refuses a bad mode, tier or empty list", async () => {
    expect((await post(ADMIN_A.id, { mode: "go", tier: "membership", text: LIST })).status).toBe(400);
    expect((await post(ADMIN_A.id, { mode: "send", tier: "free", text: LIST })).status).toBe(400);
    expect((await post(ADMIN_A.id, { mode: "send", tier: "membership", text: "   " })).status).toBe(400);
    expect((await post(ADMIN_A.id, { mode: "send", tier: "membership", text: "no emails here" })).status).toBe(400);
  });
});

describe("preview", () => {
  it("says what would happen to each address and sends nothing", async () => {
    const res = await post(ADMIN_A.id, { mode: "preview", tier: "membership", text: LIST });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const status = Object.fromEntries(data.rows.map((r: { email: string; status: string }) => [r.email, r.status]));
    expect(status).toEqual({ "new1@example.com": "ready", "new2@example.com": "ready", "inside@x.test": "already_member", "other@x.test": "ready" });
    expect(data.duplicates).toHaveLength(1);
    expect(data.invalid).toHaveLength(1);
    expect(h.createInvite).not.toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("never reveals an account in another gym: it reads as a new person", async () => {
    const { data } = await (await post(ADMIN_A.id, { mode: "preview", tier: "membership", text: "other@x.test" })).json();
    expect(data.rows[0].status).toBe("ready");
  });

  it("marks an address with an unused, unexpired invite from the same gym as already invited", async () => {
    h.findInvites.mockReturnValue([{ email: "new1@example.com", status: "pending", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), invitedByStaffId: ADMIN_A2.id }]);
    const { data } = await (await post(ADMIN_A.id, { mode: "preview", tier: "membership", text: "new1@example.com" })).json();
    expect(data.rows[0].status).toBe("already_invited");
  });
});

describe("send", () => {
  it("sends only to the ready addresses and reports each one", async () => {
    const res = await post(ADMIN_A.id, { mode: "send", tier: "app_subscription", text: LIST });
    expect(res.status).toBe(201);
    const { data, message } = await res.json();
    expect(message).toBe("3 invites sent.");
    expect(h.createInvite).toHaveBeenCalledTimes(3);
    expect(h.createInvite.mock.calls.every((c) => c[0].tier === "app_subscription" && c[0].invitedByStaffId === ADMIN_A.id)).toBe(true);
    expect(mail.sendEmail).toHaveBeenCalledTimes(3);
    expect(data.counts).toMatchObject({ sent: 3, already_member: 1 });
  });

  it("one failed email does not stop the others", async () => {
    mail.sendEmail.mockRejectedValueOnce(new Error("boom"));
    const { data } = await (await post(ADMIN_A.id, { mode: "send", tier: "membership", text: "a@example.com\nb@example.com\nc@example.com" })).json();
    expect(data.counts).toMatchObject({ sent: 2, failed: 1 });
  });

  it("sends nothing and uses no slot when nobody needs an invite", async () => {
    const res = await post(ADMIN_A.id, { mode: "send", tier: "membership", text: "inside@x.test" });
    expect(res.status).toBe(200);
    expect(h.createInvite).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) expect((await post(ADMIN_A.id, { mode: "send", tier: "membership", text: `fresh${i}@example.com` })).status).toBe(201);
  });
});

describe("limits", () => {
  it("allows 3 bulk sends an hour per staff member, then 429 with nothing stored", async () => {
    for (let i = 0; i < 3; i++) expect((await post(ADMIN_A.id, { mode: "send", tier: "membership", text: `s${i}@example.com` })).status).toBe(201);
    const before = h.createInvite.mock.calls.length;
    const over = await post(ADMIN_A.id, { mode: "send", tier: "membership", text: "s9@example.com" });
    expect(over.status).toBe(429);
    expect(h.createInvite.mock.calls.length).toBe(before);
  });

  it("allows 5 bulk sends a day per gym, shared by its staff", async () => {
    for (let i = 0; i < 3; i++) expect((await post(ADMIN_A.id, { mode: "send", tier: "membership", text: `g${i}@example.com` })).status).toBe(201);
    for (let i = 3; i < 5; i++) expect((await post(ADMIN_A2.id, { mode: "send", tier: "membership", text: `g${i}@example.com` })).status).toBe(201);
    expect((await post(ADMIN_A2.id, { mode: "send", tier: "membership", text: "g9@example.com" })).status).toBe(429);
  });

  it("previewing is never limited", async () => {
    for (let i = 0; i < 12; i++) expect((await post(ADMIN_A.id, { mode: "preview", tier: "membership", text: "p@example.com" })).status).toBe(200);
  });
});
