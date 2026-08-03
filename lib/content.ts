// Shared content used by both the public website and the member/staff app,
// so copy and auth entry points stay in one place instead of drifting across
// pages. Plan/pricing data itself lives in lib/db.ts and is read directly
// where needed — this file is just brand identity, key copy, and routes.

export const BRAND_NAME = "S&C Performance Coaching";

export const BRAND_TAGLINE =
  "Science-backed training, nutrition and recovery — all in one place.";

export const LANDING_DESCRIPTION =
  "Sign in to access your profile, training programme, workout history, and class schedule.";

export const VALUE_PROPS = [
  "Professional training sessions built around your goals and needs.",
  "Log every rep and workout and track your progress as you train.",
  "Coaches with visibility into your training and recovery.",
  "State of the art nutrition tracking and guidance for every day training and sports performance.",
  "Gender-based recovery monitoring system.",
] as const;

export const AUTH_ROUTES = {
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
} as const;

// Placeholder contact details for the public marketing site — swap for the
// real address/phone/email before launch.
export const CONTACT_INFO = {
  location: "Navan, Co. Meath",
  email: "hello@scperformancecoaching.ie",
  phone: "046 900 0000",
  phoneHref: "+353469000000",
} as const;
