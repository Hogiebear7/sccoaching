// Shared content used by both the public website and the member/staff app,
// so copy and auth entry points stay in one place instead of drifting across
// pages. Plan/pricing data itself lives in lib/db.ts and is read directly
// where needed — this file is just brand identity, key copy, and routes.

export const BRAND_NAME = "S&C Performance";

export const BRAND_TAGLINE =
  "Training, programmes, and bookings — all in one place.";

export const LANDING_DESCRIPTION =
  "Sign in to access your profile, training programme, workout history, and class schedule.";

export const VALUE_PROPS = [
  "Personalised training programmes built around your goals.",
  "Book classes and track attendance in one place.",
  "Coaches with visibility into your training and recovery.",
] as const;

export const AUTH_ROUTES = {
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
} as const;
