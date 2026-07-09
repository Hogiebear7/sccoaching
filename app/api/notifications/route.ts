import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findNotificationsByUserId, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const user = findUserById(sessionUserId);
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const notifications = findNotificationsByUserId(user.id);

  return NextResponse.json({ success: true, notifications }, { status: 200 });
}
