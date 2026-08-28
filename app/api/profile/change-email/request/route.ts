import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createEmailChangeToken, findUserByEmail, findUserById } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { emailChangeVerificationEmail } from "@/lib/email-templates";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 15 * 60 * 1000;

// POST /api/profile/change-email/request — { newEmail }. Sends a
// confirmation link to newEmail; the account's email only actually changes
// once that link is clicked (see /api/profile/change-email/confirm), which
// is what proves the member controls the new inbox.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const rate = checkRateLimit(`change-email:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { newEmail } = (body ?? {}) as Record<string, unknown>;

  if (typeof newEmail !== "string" || !EMAIL_RE.test(newEmail.trim())) {
    return NextResponse.json({ success: false, message: "Enter a valid email address." }, { status: 400 });
  }

  const cleanEmail = newEmail.trim().toLowerCase();

  if (cleanEmail === user.email.toLowerCase()) {
    return NextResponse.json({ success: false, message: "That's already your email address." }, { status: 400 });
  }

  if (findUserByEmail(cleanEmail)) {
    // Deliberately generic — same "don't confirm account existence" posture
    // as forgot-password, since revealing "that email is taken" leaks
    // whether an address has an account here at all.
    return NextResponse.json(
      { success: false, message: "That email can't be used. Try a different address." },
      { status: 400 }
    );
  }

  const { token } = createEmailChangeToken(user.id, cleanEmail);
  const template = emailChangeVerificationEmail({ changeToken: token });

  // sendEmail never throws — falls back to a console log with no provider
  // configured (local dev). See lib/email.ts.
  void sendEmail({ to: cleanEmail, ...template });

  return NextResponse.json({
    success: true,
    message: `We've sent a confirmation link to ${cleanEmail}. Click it to finish changing your email.`,
  });
}
