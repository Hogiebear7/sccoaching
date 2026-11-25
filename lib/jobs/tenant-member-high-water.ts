import { randomUUID } from "crypto";

import { createNotification, findGymById, findGyms, findMembersInGym, findNotificationByDedupeKey, findStaffUsers, saveGym } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { BAND_RULE_TEXT, bandLabel, bandNotice, nextBandAfter, recordMemberCount, tenantPriceMap, TENANT_BANDS, type TenantBand } from "@/lib/tenant-pricing";
import type { JobDefinition } from "./types";

// Once a day, notes each billed gym's member count (members that are not archived) and keeps the highest one seen this billing period. The gym's price band for the next period
// comes from that highest count, so removing members before the end of the month and adding them back after the payment does not lower the band (lib/tenant-pricing.ts).
//
// With size-based pricing switched on, the gym's admins are also told, by notification and by email, once when the gym gets close to the top of its plan and once when it goes
// over (each once per billing period). Every message states the rule, so nobody is surprised by it.
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function planNoticeText(kind: "approach" | "crossed", band: TenantBand, count: number): { title: string; body: string } {
  const spec = TENANT_BANDS.find((b) => b.key === band)!;
  const next = nextBandAfter(band);
  const nextLabel = next ? bandLabel(next).toLowerCase() : "the next";
  if (kind === "approach") {
    return {
      title: `Your gym is close to ${spec.maxMembers} members`,
      body: `Your gym has ${count} members and your plan covers up to ${spec.maxMembers}. If you go over, your next payment moves to the ${nextLabel} plan. ${BAND_RULE_TEXT}`,
    };
  }
  return {
    title: `Your gym has gone over ${spec.maxMembers} members`,
    body: `Your gym now has ${count} members, above the ${spec.maxMembers} your plan covers. From your next payment you move to the ${nextLabel} plan. ${BAND_RULE_TEXT}`,
  };
}

export const tenantMemberHighWaterJob: JobDefinition = {
  name: "tenant-member-high-water",
  description: "Records each billed gym's highest member count in the current billing period (size-based pricing) and tells its admins when it nears or passes the top of its plan.",
  async run() {
    const today = new Date().toISOString().slice(0, 10);
    const pricing = tenantPriceMap() !== null;
    let updated = 0;
    let notices = 0;
    const toNotify: { gymId: string; kind: "approach" | "crossed"; band: TenantBand; count: number; period: string }[] = [];

    for (const gym of findGyms()) {
      if (!gym.platformBilling) continue;
      const count = findMembersInGym(gym.id).length;
      const next = recordMemberCount(gym.platformBilling.memberHighWater, count, today);
      if (next !== gym.platformBilling.memberHighWater) {
        saveGym({ ...gym, platformBilling: { ...gym.platformBilling, memberHighWater: next }, updatedAt: new Date().toISOString() });
        updated += 1;
      }
      const band = gym.platformBilling.band;
      if (pricing && band) {
        const kind = bandNotice(band, count);
        if (kind) toNotify.push({ gymId: gym.id, kind, band, count, period: next.since });
      }
    }

    for (const n of toNotify) {
      if (!findGymById(n.gymId)) continue;
      const { title, body } = planNoticeText(n.kind, n.band, n.count);
      const admins = findStaffUsers().filter((u) => !u.archivedAt && (u.role === "admin" || u.role === "admin_manager") && u.gymId === n.gymId);
      for (const admin of admins) {
        const key = `tenant-plan:${n.gymId}:${n.band}:${n.kind}:${n.period}`;
        if (findNotificationByDedupeKey(admin.id, key)) continue;
        createNotification({ id: randomUUID(), userId: admin.id, type: "tenant_plan_notice", title, body, readAt: null, linkHref: "/staff/gym-setup", dedupeKey: key, createdAt: new Date().toISOString() });
        await sendEmail({
          to: admin.email,
          subject: title,
          text: `${body}\n\nYou can see your plan and manage your subscription on the Gym setup page.`,
          html: `<p>${escape(body)}</p><p style="color:#555">You can see your plan and manage your subscription on the Gym setup page in the staff area.</p>`,
          dedupeKey: `email:${key}:${admin.id}`,
        });
        notices += 1;
      }
    }

    const parts = [updated === 0 ? "No gym's highest member count changed." : `Updated the highest member count for ${updated} gym${updated === 1 ? "" : "s"}.`];
    if (notices > 0) parts.push(`Sent ${notices} plan notice${notices === 1 ? "" : "s"}.`);
    return parts.join(" ");
  },
};
