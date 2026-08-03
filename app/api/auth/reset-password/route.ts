import { NextResponse } from "next/server";

import { consumeResetToken, updateUserPassword } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { validatePasswordStrength } from "@/app/api/auth/signup/route";

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

  const { token, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json(
      { success: false, message: "Reset token is required." },
      { status: 400 }
    );
  }

  if (typeof password !== "string" || !password.trim()) {
    return NextResponse.json(
      { success: false, message: "Password is required." },
      { status: 400 }
    );
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json({ success: false, message: passwordError }, { status: 400 });
  }

  const userId = consumeResetToken(token);

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  updateUserPassword(userId, hashPassword(password));

  return NextResponse.json(
    { success: true, message: "Password updated. You can now log in." },
    { status: 200 }
  );
}
