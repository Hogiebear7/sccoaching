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

export const CONTACT_INFO = {
  location: "Navan, Co. Meath",
  email: "info@sandccoaching.com",
  phone: "083 007 9025",
  phoneHref: "+353830079025",
} as const;
