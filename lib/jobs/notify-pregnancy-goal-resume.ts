import { randomUUID } from "crypto";

import { createNotification, findAllPregnancyStatuses, findNotificationByDedupeKey, findProfileByUserId } from "@/lib/db";
import { defaultPaceForGoal } from "@/lib/nutrition-target";
import { POSTPARTUM_WEEKS } from "@/lib/pregnancy-nutrition";
import type { JobDefinition } from "./types";

const DAY_MS = 86_400_000;
// Only announce within a week of the date, so a member whose old
// notifications were trimmed is never told twice.
const ANNOUNCE_WINDOW_DAYS = 7;

// Tells a member when the 12 weeks after the birth are up and their weight
// goal is back in their calorie target (lib/pregnancy-nutrition.ts).
export const notifyPregnancyGoalResumeJob: JobDefinition = {
  name: "notify-pregnancy-goal-resume",
  description: "Tells members their weight goal is back in their calorie target 12 weeks after the birth.",
  async run() {
    const today = new Date().toISOString().slice(0, 10);
    let notified = 0;

    for (const status of findAllPregnancyStatuses()) {
      if (!status.isPregnant || !status.dueDate) continue;
      const born = status.birthDate ?? status.dueDate;
      const resumes = new Date(Date.parse(`${born}T00:00:00Z`) + POSTPARTUM_WEEKS * 7 * DAY_MS).toISOString().slice(0, 10);
      const daysSince = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${resumes}T00:00:00Z`)) / DAY_MS);
      if (daysSince < 0 || daysSince > ANNOUNCE_WINDOW_DAYS) continue;

      const profile = findProfileByUserId(status.userId);
      if (!profile) continue;
      const pace = profile.goalPacePctPerWeek ?? defaultPaceForGoal(profile.primaryGoal);
      if (pace === 0) continue;

      const dedupeKey = `pregnancy-goal-resume:${born}`;
      if (findNotificationByDedupeKey(status.userId, dedupeKey)) continue;

      createNotification({
        id: randomUUID(),
        userId: status.userId,
        type: "nutrition_update",
        title: "Your weight goal is back on",
        body:
          status.breastfeeding === true
            ? `It's ${POSTPARTUM_WEEKS} weeks since your baby's birth, so your weight goal is back in your calorie target. The extra 500 kcal for breastfeeding stays, and any weight loss is kept gentle.`
            : `It's ${POSTPARTUM_WEEKS} weeks since your baby's birth, so your weight goal is back in your calorie target.`,
        readAt: null,
        linkHref: "/dashboard/nutrition",
        dedupeKey,
        createdAt: new Date().toISOString(),
      });
      notified++;
    }

    return `Notified ${notified} member${notified === 1 ? "" : "s"}.`;
  },
};
