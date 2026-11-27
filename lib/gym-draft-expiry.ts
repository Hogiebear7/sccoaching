// How long a new gym's saved setup is kept while the gym has not gone live (paid). Pure rules, no datastore: the job and the page both read them.
//
// Owner decisions (2026-11-27): a new gym that has not paid keeps its saved setup for 24 hours after anyone from it last used the setup pages. The owner can press "Save my setup for 3 more days"
// ONCE; after that window the setup is deleted. The owner is warned by email before it goes. Only a gym that is still not live, with the go-live gate on, can ever expire (lib/tenant-live.ts):
// a gym that has paid, S&C itself and a gym a platform operator put on billing are never touched.
import type { GymRecord } from "./gyms-schema";

export const DEFAULT_DRAFT_IDLE_HOURS = 24;
export const DRAFT_EXTENSION_DAYS = 3;
/** The owner is warned when this little time is left. */
export const DRAFT_WARN_HOURS = 12;
/** A started-but-unfinished payment gets this much extra time before the setup can expire. */
export const DRAFT_CHECKOUT_EXTRA_HOURS = 72;
/** Activity is written to the gym at most this often. */
export const DRAFT_ACTIVITY_WRITE_INTERVAL_MS = 10 * 60_000;

const HOUR_MS = 3_600_000;

type DraftFields = Pick<GymRecord, "createdAt" | "draftLastActivityAt" | "draftExtendedUntil" | "pendingStripeCustomerId">;

export function draftIdleHoursFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TENANT_DRAFT_IDLE_HOURS);
  return Number.isFinite(n) && n >= 1 && n <= 24 * 30 ? n : DEFAULT_DRAFT_IDLE_HOURS;
}

/** When the saved setup runs out: the later of "last activity plus the idle time" and the extension the owner pressed for. */
export function draftExpiresAt(gym: DraftFields, idleHours: number = DEFAULT_DRAFT_IDLE_HOURS): Date {
  const last = Date.parse(gym.draftLastActivityAt ?? gym.createdAt);
  const base = (Number.isNaN(last) ? Date.parse(gym.createdAt) : last) + idleHours * HOUR_MS + (gym.pendingStripeCustomerId ? DRAFT_CHECKOUT_EXTRA_HOURS * HOUR_MS : 0);
  const ext = gym.draftExtendedUntil ? Date.parse(gym.draftExtendedUntil) : NaN;
  return new Date(Number.isNaN(ext) ? base : Math.max(base, ext));
}

export type DraftState = "keeping" | "warn" | "expired";

export function draftState(gym: DraftFields, now: Date, idleHours: number = DEFAULT_DRAFT_IDLE_HOURS): DraftState {
  const left = draftExpiresAt(gym, idleHours).getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= DRAFT_WARN_HOURS * HOUR_MS ? "warn" : "keeping";
}

/** The owner can ask for the extra days once. */
export function canExtendDraft(gym: Pick<GymRecord, "draftExtendedUntil">): boolean {
  return !gym.draftExtendedUntil;
}

/** The new "extended until" time when the owner presses the button now (the days run from now, never shortening what they already have). */
export function extensionUntil(now: Date): string {
  return new Date(now.getTime() + DRAFT_EXTENSION_DAYS * 24 * HOUR_MS).toISOString();
}

/** Plain words for the staff page. */
export function draftCountdownText(expires: Date, now: Date): string {
  const mins = Math.max(0, Math.round((expires.getTime() - now.getTime()) / 60_000));
  if (mins >= 48 * 60) return `${Math.round(mins / (24 * 60))} days`;
  if (mins >= 120) return `${Math.round(mins / 60)} hours`;
  if (mins >= 60) return "about an hour";
  return `${Math.max(1, mins)} minutes`;
}
