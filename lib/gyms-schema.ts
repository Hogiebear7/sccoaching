// A gym/business listed in the app's directory — see the Phase 2 plan
// (multi-tenant gym marketplace). S&C Performance Coaching is gym #1
// (seeded by scripts/seed-primary-gym.mjs from the constants that used to
// live only in lib/content.ts), and every other gym gets its own row here
// via the eventual self-serve signup flow.
//
// Kept in its own file rather than inline in lib/db.ts, mirroring
// profile-schema.ts's precedent — this is genuinely new, separately-evolving
// surface area (moderation status, geo, ownership) rather than a small
// addition to an existing collection.
export type GymStatus = "pending" | "active" | "suspended";

/** What the gym owes S&C for the platform (see lib/tenant-billing.ts). Absent = not billed = never restricted (the primary gym, and any gym not yet on a plan). */
export interface GymPlatformBilling {
  /** The last paid day, YYYY-MM-DD. The day after is the first day of the grace period. */
  paidThrough: string;
  /** Days of grace after paidThrough before the lockout. Absent = the platform default. */
  graceDays?: number;
  /** Where the gym pays S&C (a payment link S&C hosts, https only). Shown to the gym's own staff while they are in grace or locked. */
  payUrl?: string;
  /** The gym's customer id in S&C's own Stripe account. The platform-payment webhook finds the gym by this stored value, never by anything in the event. */
  stripeCustomerId?: string;
  /** When the gym first paid (ISO timestamp). The 14-day money-back window runs from here. */
  firstPaidAt?: string;
  /** Size-based pricing (lib/tenant-pricing.ts): the price band the gym pays for now, the billing interval, and the highest member count seen since the last renewal. */
  band?: "b50" | "b100" | "b150" | "b300" | "b500" | "b501";
  interval?: "month" | "year";
  memberHighWater?: { peak: number; since: string };
}

/** A tenant's own look. Both fields null = the S&C default (see lib/gym-branding.ts). */
export interface GymBranding {
  /** One accent colour, #RRGGBB, already checked for contrast on the app's dark background. */
  accentColor: string | null;
  /** https link to a png, jpg, webp or svg. */
  logoUrl: string | null;
  /** The background the logo sits on at launch and in the app header: "dark" (the app's navy, the default), "light" (white) or any #RRGGBB the gym picks (for a logo file with its own solid background). */
  logoBackground?: string | null;
}

/** A gym's own email sending domain, registered with the mail provider. See lib/gym-email-domain.ts. */
export interface GymEmailDomain {
  /** The bare domain, for example "theirgym.ie". */
  name: string;
  /** The mail provider's id for the domain. */
  resendId: string;
  /** The provider's status: pending, verified, failed, not_started, partially_verified, partially_failed. Mail only goes from the domain when "verified". */
  status: string;
  /** The part before the @ in the gym's sending address. */
  fromLocal: string;
  /** The DNS records the gym adds where it bought the domain. */
  records: { record: string; name: string; type: string; value: string; ttl?: string; priority?: number; status?: string }[];
  createdAt: string;
  verifiedAt: string | null;
}

export interface GymRecord {
  id: string;
  /** URL-safe, unique — e.g. "sc-performance-coaching". */
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  /** The staff user (role: coach/admin/admin_manager) who administers this
      gym — set at self-serve signup time; see scripts/seed-primary-gym.mjs
      for how gym #1 gets one without a real signup having happened. */
  ownerUserId: string;
  contactEmail: string;
  contactPhone: string | null;
  /** Free-text — was CONTACT_INFO.location in lib/content.ts. Not used for
      search/distance; latitude/longitude are. */
  addressLine: string;
  /** Null until geocoded (self-serve signup) or hand-entered (the seed
      script, for gym #1) — see the nearby-search route for how a gym with
      no coordinates yet is simply excluded rather than erroring. */
  latitude: number | null;
  longitude: number | null;
  /** "pending" (just self-signed-up, invisible to search) → "active"
      (moderated in, appears in nearby search) → "suspended" (moderated back
      out). Never set to "active" by the signup flow itself — see
      lib/permissions.ts's "gyms.moderate" capability. */
  status: GymStatus;
  /** The gym's OWN voluntary short-term availability — full, on a break, not
      taking new enquiries right now — deliberately separate from `status`
      above, which is S&C's admin moderation of the listing itself. Optional
      so every pre-existing row (nothing has ever set this) reads as visible
      without a backfill; check via `gym.acceptingNewEnquiries !== false`,
      never a bare truthiness check, so `undefined` means "visible." Managed
      via lib/permissions.ts's "gym.manageAvailability" capability and
      app/api/mobile/gyms/my-gym/visibility/route.ts — no UI reaches this
      yet (backend foundation only; see that route's own header comment). */
  acceptingNewEnquiries?: boolean;
  /** Platform billing for this tenant. Set only by a platform operator; see lib/tenant-billing.ts. */
  platformBilling?: GymPlatformBilling;
  /** A Stripe customer made when the gym started checkout but has not paid yet. A gym with only this is NOT billed (no paid-through date, so no free days): the first paid invoice turns it into platformBilling. */
  pendingStripeCustomerId?: string;
  /** The gym's logo and accent colour. Absent = the S&C default. Set by the gym's own owner/admin only. */
  branding?: GymBranding;
  /** The gym's own email sending domain (every gym). Absent = emails are sent in the gym's name from the platform address. */
  emailDomain?: GymEmailDomain;
  /** Whether members check themselves in to classes by scanning a code at the gym: "off" (the default when absent), "poster" (one printed code) or "live" (a screen whose code changes every minute). See lib/class-checkin.ts. */
  selfCheckin?: "off" | "poster" | "live";
  /** How often the live check-in code changes: "minute", "day" or "week" (the default when absent). */
  selfCheckinPeriod?: "minute" | "day" | "week";
  createdAt: string;
  updatedAt: string;
}

export function isGymStatus(value: unknown): value is GymStatus {
  return value === "pending" || value === "active" || value === "suspended";
}
