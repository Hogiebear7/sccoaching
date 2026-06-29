import { NextResponse } from "next/server";

import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signSession } from "@/lib/session";

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

  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { success: false, message: "Invalid email or password." },
      { status: 401 }
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
