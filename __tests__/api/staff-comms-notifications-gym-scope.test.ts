// PR 4 — notifications: the staff-communication fan-out and badge surfaces.
//
//   POST /api/recovery/log  — the low-readiness ALERT fan-out. Previously every
//     staff user in EVERY gym got a notification (member name + score) and a
//     push. Now only non-archived staff in the MEMBER's gym do.
//   GET  /api/staff/messages/unread-count — the nav badge. Previously the
//     platform-wide unread count; now only members in the acting staff
//     member's gym (matching the Messages page).
// (The bug-report tests that used to share this file live in
// staff-comms-bugreports-gym-scope.test.ts.)
//
// gymId: null is the primary gym (lib/gym-scope.ts). Auth uses the real
// signed-session mechanism; sameGym / can are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  findStaffUsers: vi.fn(),
  createNotification: vi.fn(),
  findNotificationByDedupeKey: vi.fn(),
  findRecoveryLogByUserIdAndDate: vi.fn(),
  getReadinessAlertSettings: vi.fn(),
  saveRecoveryLog: vi.fn(),
  findMessageThreadSummaries: vi.fn(),
  sendPush: vi.fn(),
  computeReadinessScore: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findProfileByUserId: h.findProfileByUserId,
  findStaffUsers: h.findStaffUsers,
  createNotification: h.createNotification,
  findNotificationByDedupeKey: h.findNotificationByDedupeKey,
  findRecoveryLogByUserIdAndDate: h.findRecoveryLogByUserIdAndDate,
  getReadinessAlertSettings: h.getReadinessAlertSettings,
  saveRecoveryLog: h.saveRecoveryLog,
  findMessageThreadSummaries: h.findMessageThreadSummaries,
}));
vi.mock("@/lib/push", () => ({ sendPush: h.sendPush }));
vi.mock("@/lib/recovery", () => ({ computeReadinessScore: h.computeReadinessScore }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_A_ARCHIVED = user("coach-a-old", "coach", null, "2026-01-01T00:00:00.000Z");
const ADMIN_A = user("admin-a", "admin", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const STAFF = [COACH_A, COACH_A_ARCHIVED, ADMIN_A, COACH_B];
const EVERYONE = [...STAFF, MEMBER_A, MEMBER_B];

const sessionFor = (u: U) => ({ Cookie: `session=${signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS)}` });
const post = (url: string, body: unknown, u?: U) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(u ? sessionFor(u) : {}) },
    body: JSON.stringify(body),
  });

const LOW_LOG = { date: "2026-09-01", sleepHours: "2", sleepQuality: "1", soreness: "9", fatigue: "5" };

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name of ${id}`, email: `${id}@x.test` }));
  h.findStaffUsers.mockImplementation(() => STAFF);
  h.findNotificationByDedupeKey.mockReturnValue(undefined);
  h.findRecoveryLogByUserIdAndDate.mockReturnValue(undefined);
  h.getReadinessAlertSettings.mockReturnValue({ enabled: true, threshold: 50 });
  h.computeReadinessScore.mockReturnValue(20);
  h.findMessageThreadSummaries.mockReturnValue([
    { memberId: MEMBER_A.id, unreadFromMemberCount: 2 },
    { memberId: MEMBER_B.id, unreadFromMemberCount: 5 },
    { memberId: "member-gone", unreadFromMemberCount: 7 },
    { memberId: MEMBER_A.id, unreadFromMemberCount: 1 },
  ]);
});

describe("POST /api/recovery/log — low-readiness alert stays inside the member's gym", () => {
  const log = async (member: U) => {
    const { POST } = await import("@/app/api/recovery/log/route");
    return POST(post("/api/recovery/log", LOW_LOG, member));
  };
  const notifiedUserIds = () => h.createNotification.mock.calls.map((c) => c[0].userId).sort();
  const pushedUserIds = () => h.sendPush.mock.calls.map((c) => c[0]).sort();

  it("a gym A member's low readiness alerts only gym A's active staff (notification and push)", async () => {
    const res = await log(MEMBER_A);

    expect(res.status).toBe(201);
    expect(notifiedUserIds()).toEqual(["admin-a", "coach-a"]);
    expect(pushedUserIds()).toEqual(["admin-a", "coach-a"]);
    expect(h.createNotification.mock.calls[0][0]).toMatchObject({ type: "readiness_alert", linkHref: "/staff/members/member-a" });
  });

  it("a gym B member's low readiness alerts only gym B's staff — and gym A staff learn nothing", async () => {
    const res = await log(MEMBER_B);

    expect(res.status).toBe(201);
    expect(notifiedUserIds()).toEqual(["coach-b"]);
    expect(pushedUserIds()).toEqual(["coach-b"]);
    const text = JSON.stringify(h.createNotification.mock.calls);
    expect(text).not.toMatch(/coach-a|admin-a/);
  });

  it("never checks or writes dedupe/notifications for another gym's staff", async () => {
    await log(MEMBER_A);

    const checkedFor = h.findNotificationByDedupeKey.mock.calls.map((c) => c[0]);
    expect(checkedFor).not.toContain("coach-b");
    expect(checkedFor).not.toContain("coach-a-old"); // archived: existing behavior
  });

  it("keeps the alert dedupe: an already-alerted staff member isn't re-notified", async () => {
    h.findNotificationByDedupeKey.mockImplementation((staffId: string) => (staffId === "coach-a" ? { id: "n" } : undefined));

    await log(MEMBER_A);

    expect(notifiedUserIds()).toEqual(["admin-a"]);
  });

  it("does not alert when readiness is at/above the threshold or alerts are disabled (unchanged)", async () => {
    h.computeReadinessScore.mockReturnValue(80);
    await log(MEMBER_A);
    expect(h.createNotification).not.toHaveBeenCalled();

    h.computeReadinessScore.mockReturnValue(20);
    h.getReadinessAlertSettings.mockReturnValue({ enabled: false, threshold: 50 });
    await log(MEMBER_A);
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("keeps 401 for an unauthenticated request, saving and alerting nothing", async () => {
    const { POST } = await import("@/app/api/recovery/log/route");

    const res = await POST(post("/api/recovery/log", LOW_LOG));

    expect(res.status).toBe(401);
    expect(h.saveRecoveryLog).not.toHaveBeenCalled();
    expect(h.createNotification).not.toHaveBeenCalled();
  });
});

describe("GET /api/staff/messages/unread-count — gym-scoped badge", () => {
  const count = async (u?: U) => {
    const { GET } = await import("@/app/api/staff/messages/unread-count/route");
    return GET(new NextRequest("http://localhost/api/staff/messages/unread-count", { headers: u ? sessionFor(u) : {} }));
  };

  it("counts only unread messages from the acting gym's members", async () => {
    expect(await (await count(COACH_A)).json()).toEqual({ count: 3 });
    expect(await (await count(COACH_B)).json()).toEqual({ count: 5 });
  });

  it("an unresolvable member's thread counts for no one", async () => {
    h.findMessageThreadSummaries.mockReturnValue([{ memberId: "member-gone", unreadFromMemberCount: 9 }]);

    expect(await (await count(COACH_A)).json()).toEqual({ count: 0 });
  });

  it("keeps 401 / 403 unchanged", async () => {
    const anon = await count();
    expect(anon.status).toBe(401);

    const member = await count(MEMBER_A);
    expect(member.status).toBe(403);
    expect(h.findMessageThreadSummaries).not.toHaveBeenCalled();
  });
});
