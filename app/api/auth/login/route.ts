import { NextResponse } from "next/server";

import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

// Keyed by the submitted email (not IP) — the goal is stopping credential
// stuffing / brute force against one account, regardless of how many
// addresses the attacker sends from.
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

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

  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password.trim()) {
    return NextResponse.json(
      { success: false, message: "Email and password are required." },
      { status: 400 }
    );
  }

  const rate = checkRateLimit(`login:${email.trim().toLowerCase()}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many attempts. Try again shortly, or reset your password." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { success: false, message: "Invalid email or password." },
      { status: 401 }
    );
  }

  // Checked only after the password verifies, so this message never leaks
  // account state to someone who doesn't hold the credentials.
  if (user.archivedAt) {
    return NextResponse.json(
      { success: false, message: "This account has been deactivated. Contact the club to restore access." },
      { status: 403 }
    );
  }

  const response = NextResponse.json(
    { success: true, message: "Logged in." },
    { status: 200 }
  );

  response.cookies.set("session", signSession({ userId: user.id }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
