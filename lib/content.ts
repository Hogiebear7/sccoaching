// Shared content used by both the public website and the member/staff app,
// so copy and auth entry points stay in one place instead of drifting across
// pages. Plan/pricing data itself lives in lib/db.ts and is read directly
// where needed — this file is just brand identity, contact details, and routes.

export const BRAND_NAME = "S&C Performance Coaching";

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
