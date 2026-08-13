import { purgeOldRecoveryLogs } from "@/lib/db";
import type { JobDefinition } from "./types";

// The readiness trend only ever shows a trailing 14-day window (see
// docs/readiness — the "14 days" sparkline), so recovery check-ins beyond
// that have no UI that reads them. Pure storage hygiene, same shape as
// purge-expired-reset-tokens.
const RETENTION_DAYS = 14;

export const purgeOldRecoveryLogsJob: JobDefinition = {
  name: "purge-old-recovery-logs",
  description: "Deletes recovery check-ins older than the 14-day trend window.",
  async run() {
    const purgedCount = purgeOldRecoveryLogs(RETENTION_DAYS);

    return purgedCount === 0
      ? "No recovery check-ins older than 14 days to purge."
      : `Purged ${purgedCount} recovery check-in${purgedCount === 1 ? "" : "s"} older than 14 days.`;
  },
};
