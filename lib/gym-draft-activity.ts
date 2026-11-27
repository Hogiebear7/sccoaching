// Notes that someone from a gym that has not gone live is using its setup pages, so its saved setup is kept for a full idle period from the last use (lib/gym-draft-expiry.ts).
// Written at most every 10 minutes, and only for a not-live gym (a handful at any time), so it adds almost nothing to the datastore.
import { findGymById, saveGym } from "@/lib/db";
import { DRAFT_ACTIVITY_WRITE_INTERVAL_MS } from "@/lib/gym-draft-expiry";
import { gymNotLive } from "@/lib/tenant-live";

export function touchDraftActivity(gymId: string, now: Date = new Date()): boolean {
  const gym = findGymById(gymId);
  if (!gym || !gymNotLive(gym) || gym.platformBilling) return false;
  const last = gym.draftLastActivityAt ? Date.parse(gym.draftLastActivityAt) : 0;
  if (now.getTime() - (Number.isNaN(last) ? 0 : last) < DRAFT_ACTIVITY_WRITE_INTERVAL_MS) return false;
  saveGym({ ...gym, draftLastActivityAt: now.toISOString() });
  return true;
}
