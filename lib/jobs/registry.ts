import { cleanupPastWaitlistsJob } from "./cleanup-past-waitlists";
import { expireStaleCheckoutsJob } from "./expire-stale-checkouts";
import { notifyLapsedMembershipsJob } from "./notify-lapsed-memberships";
import { purgeExpiredResetTokensJob } from "./purge-expired-reset-tokens";
import type { JobDefinition } from "./types";

// The full set of jobs a scheduled run executes, in a deliberate order:
// billing-state transitions first (since later jobs may depend on a
// subscription's status being current), then waitlist housekeeping, then
// unrelated storage hygiene last.
export const ALL_JOBS: JobDefinition[] = [
  expireStaleCheckoutsJob,
  notifyLapsedMembershipsJob,
  cleanupPastWaitlistsJob,
  purgeExpiredResetTokensJob,
];
