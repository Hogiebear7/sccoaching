import { randomUUID } from "crypto";

import { aiAllowanceEnforced, aiPoolBudgets, aiUsdPerEur } from "@/lib/ai-allowance";
import { createNotification, findAllAiUsageLogs, findNotificationByDedupeKey, findStaffUsers } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import type { JobDefinition } from "./types";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Shares of the emergency ceiling that trigger an alert (owner decision 2026-10-27). */
export const AI_SPEND_ALERT_THRESHOLDS = [0.5, 0.8] as const;

const eur = (n: number) => `€${n.toFixed(2)}`;

// Tells the owner (the primary gym's admin managers and platform operators) when AI spending over the last 30 days passes 50% and then 80% of the emergency ceiling, so the ceiling can
// be raised, or use looked into, before AI stops for everyone. Once per threshold per calendar month (the dedupe key), by in-app notification and email.
// Amounts are shown in euros at the same conservative rate the budgets use, so they match the settings the owner typed.
export const aiSpendAlertJob: JobDefinition = {
  name: "ai-spend-alert",
  description: "Tells the owner when AI spending passes 50% and 80% of the emergency ceiling.",
  async run() {
    if (!aiAllowanceEnforced()) return "AI limits are not set; nothing to check.";
    const ceilingUsd = aiPoolBudgets().ceiling;
    if (ceilingUsd === null || ceilingUsd <= 0) return "No emergency ceiling is set; nothing to check.";

    const now = Date.now();
    const spentUsd = findAllAiUsageLogs()
      .filter((l) => now - new Date(l.createdAt).getTime() <= WINDOW_MS)
      .reduce((sum, l) => sum + l.costUsd, 0);
    const share = spentUsd / ceilingUsd;
    const crossed = AI_SPEND_ALERT_THRESHOLDS.filter((t) => share >= t);
    if (crossed.length === 0) return `AI spending is at ${Math.round(share * 100)}% of the ceiling; no alert.`;

    const threshold = crossed[crossed.length - 1];
    const month = new Date(now).toISOString().slice(0, 7);
    const dedupeKey = `ai-spend-${Math.round(threshold * 100)}:${month}`;
    const rate = aiUsdPerEur();
    // The AI ceiling is platform-wide, so it goes to the platform owner: the primary gym's admin managers (gymId null) and platform operators,
    // never another gym's managers.
    const owners = findStaffUsers().filter((u) => (u.role === "admin_manager" && !u.gymId) || u.role === "platform_operator");
    const title = `AI spending has passed ${Math.round(threshold * 100)}% of the ceiling`;
    const body = `In the last 30 days, AI has cost ${eur(spentUsd / rate)} of the ${eur(ceilingUsd / rate)} emergency ceiling. When the ceiling is reached, AI stops for everyone. Raise AI_APP_CEILING_EUR on Hostinger if this growth is expected.`;

    let alerted = 0;
    for (const owner of owners) {
      if (findNotificationByDedupeKey(owner.id, dedupeKey)) continue;
      createNotification({ id: randomUUID(), userId: owner.id, type: "ai_spend_alert", title, body, readAt: null, linkHref: "/staff/finances", dedupeKey, createdAt: new Date(now).toISOString() });
      await sendEmail({ to: owner.email, subject: title, text: body, html: `<p>${body}</p>` });
      alerted++;
    }
    return `AI spending at ${Math.round(share * 100)}% of the ceiling; alerted ${alerted} owner${alerted === 1 ? "" : "s"}.`;
  },
};
