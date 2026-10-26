import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findAllPregnancyStatuses: vi.fn(),
  findProfileByUserId: vi.fn(),
  findNotificationByDedupeKey: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

import { notifyPregnancyGoalResumeJob } from "@/lib/jobs/notify-pregnancy-goal-resume";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}
const status = (born: string, breastfeeding = false) => ({
  userId: "u1", isPregnant: true, dueDate: born, birthDate: born, breastfeeding, shareWithCoach: false, createdAt: "x", updatedAt: "x",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.findProfileByUserId.mockReturnValue({ primaryGoal: "Weight Loss", goalPacePctPerWeek: null });
  h.findNotificationByDedupeKey.mockReturnValue(undefined);
});

describe("notify-pregnancy-goal-resume", () => {
  it("tells the member once their 12 weeks are up", async () => {
    h.findAllPregnancyStatuses.mockReturnValue([status(daysAgo(85), true)]);
    await notifyPregnancyGoalResumeJob.run();
    expect(h.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "nutrition_update", body: expect.stringMatching(/500 kcal for breastfeeding stays/) })
    );
  });

  it("does nothing before the 12 weeks, long after, or twice", async () => {
    h.findAllPregnancyStatuses.mockReturnValue([status(daysAgo(60)), status(daysAgo(120))]);
    await notifyPregnancyGoalResumeJob.run();
    h.findAllPregnancyStatuses.mockReturnValue([status(daysAgo(85))]);
    h.findNotificationByDedupeKey.mockReturnValue({ id: "n" });
    await notifyPregnancyGoalResumeJob.run();
    expect(h.createNotification).not.toHaveBeenCalled();
  });
});
