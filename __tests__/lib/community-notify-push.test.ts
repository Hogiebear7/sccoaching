// Challenge notices (new, started, finished) are in-app only: they are saved for the member but never pushed to the lock screen. Other community notices
// (a gym post, a comment) still push when the member has push on.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPush = vi.fn();
const createNotification = vi.fn();

vi.mock("@/lib/push", () => ({ sendPush: (...args: unknown[]) => sendPush(...args) }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/db");
  return {
    ...actual,
    createNotification: (...args: unknown[]) => createNotification(...args),
    findNotificationByDedupeKey: () => null,
    findProfileByUserId: () => ({ pushNotificationsEnabled: true }),
  };
});

import { notifyCommunityUser } from "@/lib/community-notify";

const notice = (type: "challenge_created" | "challenge_started" | "challenge_ended" | "gym_post") => ({
  type,
  title: "T",
  body: "B",
  linkHref: "/community/gym",
});

beforeEach(() => {
  sendPush.mockClear();
  createNotification.mockClear();
});

describe("community notices and push", () => {
  it("challenge notices are saved in the app and never pushed", () => {
    for (const type of ["challenge_created", "challenge_started", "challenge_ended"] as const) {
      expect(notifyCommunityUser("u1", notice(type))).toBe(true);
    }
    expect(createNotification).toHaveBeenCalledTimes(3);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("other community notices still push when the member has push on", () => {
    expect(notifyCommunityUser("u1", notice("gym_post"))).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
