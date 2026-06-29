import { NextResponse } from "next/server";

import { createResetToken, findUserByEmail } from "@/lib/db";

const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

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

  const user = findUserByEmail(email);

  if (user) {
    const { token } = createResetToken(user.id);
    const resetUrl = `${new URL(request.url).origin}/reset-password?token=${token}`;

    // No email service is configured for this local prototype.
    // Logging the link lets you copy it from the terminal during development.
    console.log(`[forgot-password] Reset link for ${user.email}: ${resetUrl}`);
  }

  return NextResponse.json({ success: true, message: GENERIC_MESSAGE }, { status: 200 });
}
