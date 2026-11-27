// Removes a new gym's saved setup once it has run out (lib/gym-draft-expiry.ts) without the gym going live. Server-only.
// Every check is made again here, on the gym as it is now, because this deletes data: the go-live gate must be on, the gym must have no billing record and no member, and its setup must really
// be past its time. Nothing about a paid gym, the primary gym or a gym a platform operator put on billing can reach this far.
import { randomUUID } from "crypto";

import { createNotification, deleteUnpaidGymSetup, deleteUserAndOwnedRecords, findAllUserIdsOfGym, findGyms, findNotificationByDedupeKey, findUserById, findGymById } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { draftExpiresAt, draftIdleHoursFromEnv, draftState } from "@/lib/gym-draft-expiry";
import { removeGymEmailDomain } from "@/lib/gym-email-domain-sync";
import { removeGymLogo } from "@/lib/gym-logo-store";
import { gymNotLive } from "@/lib/tenant-live";

export function draftCleanupEnabled(): boolean {
  return process.env.TENANT_DRAFT_CLEANUP_ENABLED === "true";
}

export type DraftDeleteResult = { deleted: true; summary: Record<string, number> } | { deleted: false; reason: string };

export async function deleteExpiredDraftGym(gymId: string, now: Date = new Date()): Promise<DraftDeleteResult> {
  const gym = findGymById(gymId);
  if (!gym) return { deleted: false, reason: "no such gym" };
  if (!gymNotLive(gym)) return { deleted: false, reason: "gym is live, or the go-live gate is off" };
  if (gym.platformBilling) return { deleted: false, reason: "gym has billing" };
  if (draftState(gym, now, draftIdleHoursFromEnv()) !== "expired") return { deleted: false, reason: "not expired yet" };

  const userIds = findAllUserIdsOfGym(gym.id);
  // The domain registered with the mail provider goes first (best effort), then the setup rows in one write, then the accounts, then the logo file.
  if (gym.emailDomain) await removeGymEmailDomain(gym).catch(() => undefined);
  const summary = deleteUnpaidGymSetup(gym.id);
  if (!summary) return { deleted: false, reason: "refused: has billing or a member" };
  for (const id of userIds) {
    try {
      deleteUserAndOwnedRecords(id);
    } catch (e) {
      console.error("[draft cleanup] could not delete an account of the removed gym:", e instanceof Error ? e.message : e);
    }
  }
  removeGymLogo(gym.id);
  return { deleted: true, summary };
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Warns the owner (notification and email, once per expiry time) that the saved setup is about to be removed. */
export async function warnDraftOwner(gymId: string, now: Date = new Date()): Promise<boolean> {
  const gym = findGymById(gymId);
  if (!gym) return false;
  const owner = findUserById(gym.ownerUserId);
  if (!owner || owner.archivedAt) return false;
  const expires = draftExpiresAt(gym, draftIdleHoursFromEnv());
  const key = `draft-expiry:${gym.id}:${expires.toISOString()}`;
  if (findNotificationByDedupeKey(owner.id, key)) return false;
  const canExtend = !gym.draftExtendedUntil;
  const title = `${gym.name}: your saved setup will be removed soon`;
  const body = canExtend
    ? `Your gym is not live yet, and its saved setup is removed after 24 hours without use. Sign in to Gym setup to keep working, or press "Save my setup for 3 more days" (you can do this once). Going live keeps everything for good.`
    : `Your gym is not live yet, and its saved setup will be removed soon. Go live from Gym setup to keep everything.`;
  createNotification({ id: randomUUID(), userId: owner.id, type: "tenant_go_live", title, body, readAt: null, linkHref: "/staff/gym-setup", dedupeKey: key, createdAt: now.toISOString() });
  await sendEmail({ to: owner.email, subject: title, text: body, html: `<p>${escape(body)}</p>`, kind: "draft-expiry-warning", gymId: gym.id });
  return true;
}

export function unpaidGyms() {
  return findGyms().filter((g) => gymNotLive(g) && !g.platformBilling);
}
