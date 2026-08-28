import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { consumeEmailChangeToken } from "@/lib/db";

// POST /api/profile/change-email/confirm — { token }. Clicking the link in
// the email is the proof of control over the new address; this finalizes
// the swap (see createEmailChangeToken/consumeEmailChangeToken in lib/db.ts).
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { token } = (body ?? {}) as Record<string, unknown>;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ success: false, message: "Missing token." }, { status: 400 });
  }

  const newEmail = consumeEmailChangeToken(token);

  if (!newEmail) {
    return NextResponse.json(
      { success: false, message: "This link has expired or was already used. Request a new one from your profile." },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, email: newEmail });
}
