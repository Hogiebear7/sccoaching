import { findGyms, findMembersInGym, saveGym } from "@/lib/db";
import { recordMemberCount } from "@/lib/tenant-pricing";
import type { JobDefinition } from "./types";

// Once a day, notes each billed gym's member count (members that are not archived) and keeps the highest one seen this billing period. The gym's price band for the next period
// comes from that highest count, so removing members before the end of the month and adding them back after the payment does not lower the band (lib/tenant-pricing.ts).
// Read and write happen together with no waiting in between.
export const tenantMemberHighWaterJob: JobDefinition = {
  name: "tenant-member-high-water",
  description: "Records each billed gym's highest member count in the current billing period (used for size-based pricing).",
  async run() {
    const today = new Date().toISOString().slice(0, 10);
    let updated = 0;
    for (const gym of findGyms()) {
      if (!gym.platformBilling) continue;
      const count = findMembersInGym(gym.id).length;
      const next = recordMemberCount(gym.platformBilling.memberHighWater, count, today);
      if (next === gym.platformBilling.memberHighWater) continue;
      saveGym({ ...gym, platformBilling: { ...gym.platformBilling, memberHighWater: next }, updatedAt: new Date().toISOString() });
      updated += 1;
    }
    return updated === 0 ? "No gym's highest member count changed." : `Updated the highest member count for ${updated} gym${updated === 1 ? "" : "s"}.`;
  },
};
