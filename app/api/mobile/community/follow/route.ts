import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  findProfileByUserId,
  findUserById,
  followUser,
  type NotificationRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { sendPush } from "@/lib/push";

// POST /api/mobile/community/follow — { userId }
// Open follow, no approval step (confirmed with the member) — anyone can
// follow anyone, matching Strava rather than a private-account model.
export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { userId } = (body ?? {}) as Record<string, unknown>;
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "userId is required." }, { status: 400 });
  }
  if (userId === me.id) {
    return NextResponse.json({ success: false, message: "You can't follow yourself." }, { status: 400 });
  }

  const target = findUserById(userId);
  if (!target || target.role !== "member") {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  followUser(me.id, userId);

  const myProfile = findProfileByUserId(me.id);
  const notification: NotificationRecord = {
    id: randomUUID(),
    userId,
    type: "new_follower",
    title: `${myProfile?.fullName?.trim() || "Someone"} started following you`,
    body: "Check out their profile in Community.",
    readAt: null,
    linkHref: null,
    dedupeKey: null,
    createdAt: new Date().toISOString(),
  };
  createNotification(notification);

  const targetProfile = findProfileByUserId(userId);
  if (targetProfile?.pushNotificationsEnabled !== false) {
    void sendPush(userId, { title: notification.title, body: notification.body, linkHref: "" });
  }

  return NextResponse.json({ success: true, message: "Following." });
}
