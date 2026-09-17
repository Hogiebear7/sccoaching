// S&C Performance Coaching's own slug in the gyms table (see
// lib/gyms-schema.ts) — used wherever app code needs to single out "the
// gym this app itself belongs to" from the rest of the directory, e.g. the
// nearby-search route's "recommended" pin.
//
// Duplicated (not imported) in scripts/seed-primary-gym.mjs, matching the
// existing APP_SUBSCRIPTION_PACKAGE_SLUG precedent between
// lib/tier-grant.ts and scripts/seed-app-subscription-package.mjs — plain
// .mjs scripts here run directly via node, not through the Next.js/TS
// build, so they can't import a .ts module. Keep both in sync if this ever
// changes.
export const PRIMARY_GYM_SLUG = "sc-performance-coaching";
