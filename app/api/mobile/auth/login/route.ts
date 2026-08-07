import { NextResponse } from "next/server";

import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

// Same credential/rate-limit rules as the web login route (app/api/auth/
// login/route.ts) — this just returns the token in the JSON body instead
// of setting an httpOnly cookie, since the mobile client has to be able to
// read it to store in SecureStore and attach as a Bearer header.
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
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
    return NextResponse.json({ success: false, message: "Invalid email or password." }, { status: 401 });
  }

  if (user.archivedAt) {
    return NextResponse.json(
      { success: false, message: "This account has been deactivated. Contact the club to restore access." },
      { status: 403 }
    );
  }

  const token = signSession({ userId: user.id });

  return NextResponse.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
}
