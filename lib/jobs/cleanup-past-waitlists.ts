import { findAllWaitlistEntries, findClassById, deleteWaitlistEntry } from "@/lib/db";
import type { JobDefinition } from "./types";

// If nobody ever cancels a full class, anyone still on its waitlist when
// the class starts is left in permanent limbo — there's no event left that
// would ever clean it up reactively (promoteFromWaitlist only runs when a
// spot opens). This removes waitlist entries once their class has started.
export const cleanupPastWaitlistsJob: JobDefinition = {
  name: "cleanup-past-waitlists",
  description: "Removes waitlist entries for classes that have already started.",
  async run() {
    const entries = findAllWaitlistEntries();
    const now = Date.now();
    let removedCount = 0;

    for (const entry of entries) {
      const classRecord = findClassById(entry.classId);

      const classHasPassed =
        !classRecord || new Date(`${classRecord.date}T${classRecord.startTime}`).getTime() < now;

      if (!classHasPassed) continue;

      deleteWaitlistEntry(entry.id);
      removedCount += 1;
    }

    return removedCount === 0
      ? "No stale waitlist entries found."
      : `Removed ${removedCount} waitlist entr${removedCount === 1 ? "y" : "ies"} for classes that already started.`;
  },
};
