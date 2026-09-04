import { cleanupPastWaitlistsJob } from "./cleanup-past-waitlists";
import { detectNoShowsJob } from "./detect-no-shows";
import { expireStaleCheckoutsJob } from "./expire-stale-checkouts";
import { generateClassSeriesJob } from "./generate-class-series";
import { notifyExpiringPassesJob } from "./notify-expiring-passes";
import { notifyLowPassBalanceJob } from "./notify-low-pass-balance";
import { notifyLapsedMembershipsJob } from "./notify-lapsed-memberships";
import { processWaitlistOffersJob } from "./process-waitlist-offers";
import { purgeExpiredResetTokensJob } from "./purge-expired-reset-tokens";
import { purgeOldRecoveryLogsJob } from "./purge-old-recovery-logs";
import { refreshBrandedFoodCacheJob } from "./refresh-branded-food-cache";
import { resumePausedMembershipsJob } from "./resume-paused-memberships";
import { sendClassRemindersJob } from "./send-class-reminders";
import { sendProgrammeCheckinsJob } from "./send-programme-checkins";
import { sendProgrammeRemindersJob } from "./send-programme-reminders";
import type { JobDefinition } from "./types";

// Execution order:
// 1. Billing transitions (subscriptions must be current before other jobs read them).
// 2. Waitlist offer processing (expire stale offers, cascade, narrow windows).
// 3. Class reminders (reads effective bookings, not waitlist).
// 4. No-show detection (reads bookings for classes that have already ended).
// 5. Waitlist cleanup (purges terminal records for past classes).
// 6. Storage hygiene / independent maintenance (order doesn't matter).
export const ALL_JOBS: JobDefinition[] = [
  expireStaleCheckoutsJob,
  notifyLapsedMembershipsJob,
  notifyExpiringPassesJob,
  notifyLowPassBalanceJob,
  resumePausedMembershipsJob,
  generateClassSeriesJob,
  processWaitlistOffersJob,
  sendClassRemindersJob,
  sendProgrammeRemindersJob,
  sendProgrammeCheckinsJob,
  detectNoShowsJob,
  cleanupPastWaitlistsJob,
  purgeExpiredResetTokensJob,
  purgeOldRecoveryLogsJob,
  refreshBrandedFoodCacheJob,
];
