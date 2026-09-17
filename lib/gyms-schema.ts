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
  createdAt: string;
  updatedAt: string;
}

export function isGymStatus(value: unknown): value is GymStatus {
  return value === "pending" || value === "active" || value === "suspended";
}
