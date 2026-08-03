import { NextResponse } from "next/server";

import { createResetToken, findUserByEmail } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";
import { checkRateLimit } from "@/lib/rate-limit";

const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

// Keyed by the submitted email — stops someone spamming reset emails at one
// address (their own inbox fills up) or scripting token generation.
const RESET_RATE_LIMIT = 3;
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { email } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json(
      { success: false, message: "Email is required." },
      { status: 400 }
    );
  }

  // Keyed by the submitted email (not by whether an account exists), so the
  // 429 itself never reveals account existence — it fires identically for a
  // real or a made-up address.
  const rate = checkRateLimit(`forgot-password:${email.trim().toLowerCase()}`, RESET_RATE_LIMIT, RESET_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const user = findUserByEmail(email);

  if (user) {
    const { token } = createResetToken(user.id);
    const template = passwordResetEmail({ resetToken: token });

    // sendEmail never throws (falls back to a console log when no email
    // provider is configured, e.g. local development) — see lib/email.ts.
    void sendEmail({ to: user.email, ...template });
  }

  return NextResponse.json({ success: true, message: GENERIC_MESSAGE }, { status: 200 });
}
