import { cleanupPastWaitlistsJob } from "./cleanup-past-waitlists";
import { expireStaleCheckoutsJob } from "./expire-stale-checkouts";
import { generateClassSeriesJob } from "./generate-class-series";
import { notifyExpiringPassesJob } from "./notify-expiring-passes";
import { notifyLowPassBalanceJob } from "./notify-low-pass-balance";
import { notifyLapsedMembershipsJob } from "./notify-lapsed-memberships";
import { processWaitlistOffersJob } from "./process-waitlist-offers";
import { purgeExpiredResetTokensJob } from "./purge-expired-reset-tokens";
import { sendClassRemindersJob } from "./send-class-reminders";
import type { JobDefinition } from "./types";

// Execution order:
// 1. Billing transitions (subscriptions must be current before other jobs read them).
// 2. Waitlist offer processing (expire stale offers, cascade, narrow windows).
// 3. Class reminders (reads effective bookings, not waitlist).
// 4. Waitlist cleanup (purges terminal records for past classes).
// 5. Storage hygiene.
export const ALL_JOBS: JobDefinition[] = [
  expireStaleCheckoutsJob,
  notifyLapsedMembershipsJob,
  notifyExpiringPassesJob,
  notifyLowPassBalanceJob,
  generateClassSeriesJob,
  processWaitlistOffersJob,
  sendClassRemindersJob,
  cleanupPastWaitlistsJob,
  purgeExpiredResetTokensJob,
];
