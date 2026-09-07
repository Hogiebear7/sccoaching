import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionById,
  toggleWorkoutLike,
  type NotificationRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { sendPush } from "@/lib/push";

// POST /api/mobile/programs/../workouts/[id]/like — toggles the requester's
// like on a workout session. Anyone can like a non-private session, not
// just followers of its owner — same low-friction, permissive stance as
// the open-follow model itself.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const target = findWorkoutSessionById(id);
  if (!target || (target.isPrivate && target.userId !== me.id)) {
    return NextResponse.json({ success: false, message: "Workout not found." }, { status: 404 });
  }

  const liked = toggleWorkoutLike(me.id, id);

  if (liked && target.userId !== me.id) {
    const myProfile = findProfileByUserId(me.id);
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: target.userId,
      type: "workout_liked",
      title: `${myProfile?.fullName?.trim() || "Someone"} liked your workout`,
      body: target.title,
      readAt: null,
      linkHref: null,
      dedupeKey: null,
      createdAt: new Date().toISOString(),
    };
    createNotification(notification);

    const ownerProfile = findProfileByUserId(target.userId);
    if (ownerProfile?.pushNotificationsEnabled !== false) {
      void sendPush(target.userId, { title: notification.title, body: notification.body, linkHref: "" });
    }
  }

  return NextResponse.json({ success: true, data: { liked } });
}
