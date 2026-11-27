import { deleteExpiredDraftGym, draftCleanupEnabled, unpaidGyms, warnDraftOwner } from "@/lib/gym-draft-cleanup";
import { draftIdleHoursFromEnv, draftState } from "@/lib/gym-draft-expiry";
import type { JobDefinition } from "./types";

// Warns the owner of a new gym that has not gone live, then removes its saved setup once it has run out (24 hours after anyone last used it, or after the 3 extra days the owner can ask for once).
// Runs only while the go-live gate is on. DELETING is a second, separate switch: unless TENANT_DRAFT_CLEANUP_ENABLED is exactly "true" this only warns and reports what it WOULD remove.
export const unpaidGymCleanupJob: JobDefinition = {
  name: "unpaid-gym-cleanup",
  description: "Warns owners of unpaid new gyms, then removes setups that have run out (deleting only when TENANT_DRAFT_CLEANUP_ENABLED is true; otherwise it only reports).",
  async run() {
    const now = new Date();
    const idle = draftIdleHoursFromEnv();
    const deleting = draftCleanupEnabled();
    let warned = 0;
    let removed = 0;
    let wouldRemove = 0;
    let skipped = 0;
    for (const gym of unpaidGyms()) {
      const state = draftState(gym, now, idle);
      if (state === "warn" && (await warnDraftOwner(gym.id, now).catch(() => false))) warned += 1;
      if (state !== "expired") continue;
      if (!deleting) {
        wouldRemove += 1;
        continue;
      }
      const result = await deleteExpiredDraftGym(gym.id, now).catch(() => ({ deleted: false as const, reason: "error" }));
      if (result.deleted) removed += 1;
      else skipped += 1;
    }
    return `Unpaid gyms: warned ${warned}, ${deleting ? `removed ${removed}, skipped ${skipped}` : `would remove ${wouldRemove} (deleting is off)`}.`;
  },
};
