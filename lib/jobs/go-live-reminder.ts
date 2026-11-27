import { randomUUID } from "crypto";

import { createNotification, findGyms, findNotificationByDedupeKey, findUserById } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { dueGoLiveReminder, gymNotLive } from "@/lib/tenant-live";
import type { JobDefinition } from "./types";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Nudges the owner of a gym that has set itself up but not gone live (paid) yet, 3, 7 and 14 days after sign-up, by notification and email. Each reminder goes once. Only runs while the
// go-live gate is on (lib/tenant-live.ts). Nothing is deleted or locked by this: it only reminds.
export const goLiveReminderJob: JobDefinition = {
  name: "go-live-reminder",
  description: "Reminds the owner of an unpaid new gym to go live, 3, 7 and 14 days after sign-up (once each).",
  async run() {
    const now = new Date();
    let reminded = 0;
    let checked = 0;
    for (const gym of findGyms()) {
      if (!gymNotLive(gym)) continue;
      checked += 1;
      const day = dueGoLiveReminder(gym.createdAt, now);
      if (day === null) continue;
      const owner = findUserById(gym.ownerUserId);
      if (!owner || owner.archivedAt) continue;
      const key = `golive:${gym.id}:${day}`;
      if (findNotificationByDedupeKey(owner.id, key)) continue;

      const title = `${gym.name} is set up but not live yet`;
      const body = `Your gym is saved and ready. When you go live (Gym setup, then subscribe), it is listed in the directory and you can invite your members. If it is not right for you, you can ask for your money back within 14 days.`;
      createNotification({ id: randomUUID(), userId: owner.id, type: "tenant_go_live", title, body, readAt: null, linkHref: "/staff/gym-setup", dedupeKey: key, createdAt: now.toISOString() });
      await sendEmail({ to: owner.email, subject: title, text: body, html: `<p>${escape(body)}</p>`, kind: "go-live-reminder", gymId: gym.id });
      reminded += 1;
    }
    return `${checked} gym${checked === 1 ? "" : "s"} not live yet. Reminded ${reminded}.`;
  },
};
