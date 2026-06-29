import { purgeExpiredResetTokens } from "@/lib/db";
import type { JobDefinition } from "./types";

// Pure storage hygiene — expired password reset tokens are already rejected
// on use (consumeResetToken filters them lazily), so this doesn't change
// any behavior. It just keeps data/db.json from accumulating dead rows
// forever in an app with no other cleanup path for this table.
export const purgeExpiredResetTokensJob: JobDefinition = {
  name: "purge-expired-reset-tokens",
  description: "Deletes password reset tokens past their expiry.",
  async run() {
    const purgedCount = purgeExpiredResetTokens();

    return purgedCount === 0
      ? "No expired reset tokens to purge."
      : `Purged ${purgedCount} expired reset token${purgedCount === 1 ? "" : "s"}.`;
  },
};
