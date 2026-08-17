import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, markNotificationRead } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const user = findUserById(sessionUserId);
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const { id } = await params;
  const marked = markNotificationRead(id, user.id);

  if (!marked) {
    return NextResponse.json(
      { success: false, message: "Notification not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
