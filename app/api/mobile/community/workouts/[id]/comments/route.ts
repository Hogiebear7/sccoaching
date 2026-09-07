import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createComment,
  createNotification,
  findCommentsByWorkoutSessionId,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionById,
  type NotificationRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { sendPush } from "@/lib/push";

const MAX_BODY_LENGTH = 500;
const MAX_MENTIONS = 10;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const target = findWorkoutSessionById(id);
  if (!target) {
    return NextResponse.json({ success: false, message: "Workout not found." }, { status: 404 });
  }

  const comments = findCommentsByWorkoutSessionId(id).map((c) => ({
    id: c.id,
    userId: c.userId,
    authorName: findProfileByUserId(c.userId)?.fullName?.trim() || "Member",
    body: c.body,
    mentionedUserIds: c.mentionedUserIds,
    createdAt: c.createdAt,
  }));

  return NextResponse.json({ success: true, data: { comments } });
}

// POST { body, mentionedUserIds? }
// mentionedUserIds is captured structurally by the composer's @-picker on
// the client, never parsed out of the text server-side — see CommentRecord
// in lib/db.ts for why (ambiguous with spaces/duplicate names).
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { body, mentionedUserIds } = (json ?? {}) as Record<string, unknown>;
  const cleanBody = typeof body === "string" ? body.trim().slice(0, MAX_BODY_LENGTH) : "";
  if (!cleanBody) {
    return NextResponse.json({ success: false, message: "Comment can't be empty." }, { status: 400 });
  }

  const cleanMentions = Array.isArray(mentionedUserIds)
    ? [...new Set(mentionedUserIds.filter((v): v is string => typeof v === "string" && !!findUserById(v)))].slice(
        0,
        MAX_MENTIONS
      )
    : [];

  const now = new Date().toISOString();
  const comment = {
    id: randomUUID(),
    workoutSessionId: id,
    userId: me.id,
    body: cleanBody,
    mentionedUserIds: cleanMentions,
    createdAt: now,
  };
  createComment(comment);

  const myName = findProfileByUserId(me.id)?.fullName?.trim() || "Someone";

  // Notify the workout owner (unless they're commenting on their own),
  // then each mentioned member (skipping the owner if also mentioned, to
  // avoid a double notification for the same comment).
  const notifyTargets = new Set<string>();
  if (target.userId !== me.id) notifyTargets.add(target.userId);

  if (notifyTargets.has(target.userId)) {
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: target.userId,
      type: "workout_commented",
      title: `${myName} commented on your workout`,
      body: cleanBody,
      readAt: null,
      linkHref: null,
      dedupeKey: null,
      createdAt: now,
    };
    createNotification(notification);
    const ownerProfile = findProfileByUserId(target.userId);
    if (ownerProfile?.pushNotificationsEnabled !== false) {
      void sendPush(target.userId, { title: notification.title, body: notification.body, linkHref: "" });
    }
  }

  for (const mentionedId of cleanMentions) {
    if (mentionedId === me.id || mentionedId === target.userId) continue; // already notified or is the author
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: mentionedId,
      type: "mentioned_in_comment",
      title: `${myName} mentioned you in a comment`,
      body: cleanBody,
      readAt: null,
      linkHref: null,
      dedupeKey: null,
      createdAt: now,
    };
    createNotification(notification);
    const mentionedProfile = findProfileByUserId(mentionedId);
    if (mentionedProfile?.pushNotificationsEnabled !== false) {
      void sendPush(mentionedId, { title: notification.title, body: notification.body, linkHref: "" });
    }
  }

  return NextResponse.json({
    success: true,
    data: { comment: { ...comment, authorName: myName } },
  });
}
