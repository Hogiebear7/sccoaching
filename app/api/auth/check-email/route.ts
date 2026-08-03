import { NextResponse } from "next/server";

import { findUserByEmail } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Powers the signup form's live "this email is already registered" prompt.
// Deliberately reveals account existence (unlike forgot-password's generic
// message) — the signup flow needs to redirect an existing user before they
// waste a step filling out a form that will fail at the end anyway.
const CHECK_RATE_LIMIT = 20;
const CHECK_RATE_WINDOW_MS = 15 * 60 * 1000;

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim() ?? "";

  if (!email) {
    return NextResponse.json({ available: true });
  }

  const rate = checkRateLimit(`check-email:${email.toLowerCase()}`, CHECK_RATE_LIMIT, CHECK_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { available: true },
      { headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const taken = Boolean(findUserByEmail(email));
  return NextResponse.json({ available: !taken });
}
