import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  findCommunityPrivacyByUserId,
  findProfileByUserId,
  findUserById,
  followUser,
  isCommunityEligible,
  isFollowing,
  type NotificationRecord,
} from "@/lib/db";
import { communityDisplayName, isDiscoverable } from "@/lib/community-display-name";
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
  if (!target || !isCommunityEligible(target)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  // discoverable=false blocks only NEW discovery — an already-existing
  // relationship (e.g. re-following after an unfollow) is grandfathered.
  const targetPrivacy = findCommunityPrivacyByUserId(target.id);
  if (!isDiscoverable(targetPrivacy) && !isFollowing(me.id, target.id)) {
    return NextResponse.json({ success: false, message: "This member isn't discoverable." }, { status: 403 });
  }

  followUser(me.id, userId);

  const myProfile = findProfileByUserId(me.id);
  const myName = communityDisplayName(myProfile?.fullName?.trim() || "Someone", findCommunityPrivacyByUserId(me.id));
  // No specific content to deep-link to (there's no per-member profile
  // screen) — the Community root is the honest target here.
  const notification: NotificationRecord = {
    id: randomUUID(),
    userId,
    type: "new_follower",
    title: `${myName} started following you`,
    body: "Check out their profile in Community.",
    readAt: null,
    linkHref: "/community",
    dedupeKey: null,
    createdAt: new Date().toISOString(),
  };
  createNotification(notification);

  const targetProfile = findProfileByUserId(userId);
  if (targetProfile?.pushNotificationsEnabled !== false) {
    void sendPush(userId, { title: notification.title, body: notification.body, linkHref: "/community" });
  }

  return NextResponse.json({ success: true, message: "Following." });
}
