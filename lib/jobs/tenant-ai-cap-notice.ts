import { randomUUID } from "crypto";

import { gymAiUsage } from "@/lib/ai-gym-cap";
import { createNotification, findGymById, findGyms, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import type { JobDefinition } from "./types";

// Tells a tenant gym's admins when the gym is close to, or has used up, its own monthly AI allowance (lib/ai-gym-cap.ts), so a pause in AI for their members is never a surprise.
// Two notices: at 80% ("approach") and at 100% ("reached"). Each goes to each admin at most once per calendar month, by notification and by email. S&C's own gym has no gym allowance and
// is never told anything. Nothing is sent when no gym allowances are set.
const APPROACH_SHARE = 0.8;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function aiCapNoticeText(kind: "approach" | "reached"): { title: string; body: string } {
  if (kind === "approach") {
    return {
      title: "Your gym has used 80% of its AI allowance",
      body: "Your gym has used about 80% of its AI allowance for the last 30 days. Everyone in your gym, members and staff, shares it. If it runs out, AI features such as the AI coach and food photo logging pause for your members until earlier use drops out of the 30 days. Everything else in the app keeps working. A bigger plan has a bigger allowance.",
    };
  }
  return {
    title: "Your gym has used all of its AI allowance",
    body: "Your gym has used all of its AI allowance for the last 30 days, so AI features such as the AI coach and food photo logging are paused for your members. They come back by themselves as earlier use drops out of the 30 days. Everything else in the app keeps working. If this happens often, a bigger plan has a bigger allowance.",
  };
}

export const tenantAiCapNoticeJob: JobDefinition = {
  name: "tenant-ai-cap-notice",
  description: "Tells a gym's admins when the gym has used 80% and 100% of its monthly AI allowance (at most once each per month).",
  async run() {
    const month = new Date().toISOString().slice(0, 7);
    let notices = 0;
    const due: { gymId: string; kind: "approach" | "reached" }[] = [];

    for (const gym of findGyms()) {
      const usage = gymAiUsage(gym.id);
      if (!usage) continue;
      if (usage.share >= 1) due.push({ gymId: gym.id, kind: "reached" });
      else if (usage.share >= APPROACH_SHARE) due.push({ gymId: gym.id, kind: "approach" });
    }

    for (const d of due) {
      if (!findGymById(d.gymId)) continue;
      const { title, body } = aiCapNoticeText(d.kind);
      const admins = findStaffUsers().filter((u) => !u.archivedAt && (u.role === "admin" || u.role === "admin_manager") && u.gymId === d.gymId);
      for (const admin of admins) {
        const key = `tenant-ai:${d.gymId}:${d.kind}:${month}`;
        if (findNotificationByDedupeKey(admin.id, key)) continue;
        createNotification({ id: randomUUID(), userId: admin.id, type: "tenant_ai_cap_notice", title, body, readAt: null, linkHref: "/staff/gym-setup", dedupeKey: key, createdAt: new Date().toISOString() });
        await sendEmail({
          to: admin.email,
          subject: title,
          text: `${body}\n\nYou can see how much of the allowance is used on the Gym setup page.`,
          html: `<p>${escape(body)}</p><p style="color:#555">You can see how much of the allowance is used on the Gym setup page in the staff area.</p>`,
          dedupeKey: `email:${key}:${admin.id}`,
        });
        notices += 1;
      }
    }

    return notices === 0 ? "No gym needed an AI allowance notice." : `Sent ${notices} AI allowance notice${notices === 1 ? "" : "s"}.`;
  },
};
