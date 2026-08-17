import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, markAllNotificationsRead } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const user = findUserById(sessionUserId);
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  markAllNotificationsRead(user.id);

  return NextResponse.json({ success: true }, { status: 200 });
}
