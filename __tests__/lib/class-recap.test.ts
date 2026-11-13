import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications: { userId: string; dedupeKey: string | null; type: string; linkHref: string | null }[] = [];
const saved: { recapSentAt?: string | null }[] = [];
const pushes: string[] = [];

const template = { classId: "c1", notes: null, exercises: [{ name: "Squat" }], runs: [], recapSentAt: null as string | null, updatedByStaffId: "s1", createdAt: "x", updatedAt: "x" };

vi.mock("@/lib/db", () => ({
  findClassById: (id: string) => (id === "c1" ? { id: "c1", title: "Private Class" } : undefined),
  findClassWorkoutByClassId: (id: string) => (id === "c1" || id === "c2" ? { ...template, classId: id } : undefined),
  findBookingsByClassId: () => [
    { userId: "u1", attendedAt: "2026-11-12T13:00:00Z" },
    { userId: "u2", attendedAt: null },
    { userId: "u3", attendedAt: "2026-11-12T13:00:00Z" },
  ],
  findWorkoutSessionByUserAndClass: (userId: string) => ({ id: `s-${userId}`, userId }),
  findNotificationByDedupeKey: (userId: string, key: string) => notifications.find((n) => n.userId === userId && n.dedupeKey === key),
  createNotification: (n: { userId: string; dedupeKey: string | null; type: string; linkHref: string | null }) => notifications.push(n),
  findProfileByUserId: (userId: string) => ({ pushNotificationsEnabled: userId !== "u3" }),
  saveClassWorkout: (w: { recapSentAt?: string | null }) => saved.push(w),
}));
vi.mock("@/lib/class-workout-sync", () => ({ syncClassWorkoutToMember: () => {} }));
vi.mock("@/lib/push", () => ({ sendPush: (userId: string) => { pushes.push(userId); return Promise.resolve(); } }));

import { sendClassRecap } from "@/lib/class-recap";

beforeEach(() => {
  notifications.length = 0;
  saved.length = 0;
  pushes.length = 0;
});

describe("sendClassRecap", () => {
  it("notifies only the people who were checked in, linking to their own copy of the workout", () => {
    const r = sendClassRecap("c1");
    expect(r).toEqual({ ok: true, sent: 2, alreadySent: 0 });
    expect(notifications.map((n) => n.userId)).toEqual(["u1", "u3"]);
    expect(notifications.every((n) => n.type === "class_recap")).toBe(true);
    expect(notifications[0].linkHref).toBe("/dashboard/workouts/class/s-u1");
  });

  it("pushes only to people who have push on", () => {
    sendClassRecap("c1");
    expect(pushes).toEqual(["u1"]);
  });

  it("does not notify anyone twice for the same class", () => {
    sendClassRecap("c1");
    const again = sendClassRecap("c1");
    expect(again).toEqual({ ok: true, sent: 0, alreadySent: 2 });
    expect(notifications).toHaveLength(2);
  });

  it("records when the recap went out", () => {
    sendClassRecap("c1", new Date("2026-11-12T14:00:00Z"));
    expect(saved.at(-1)?.recapSentAt).toBe("2026-11-12T14:00:00.000Z");
  });

  it("says why when there is nothing to send", () => {
    expect(sendClassRecap("missing")).toEqual({ ok: false, reason: "no_class" });
  });
});
