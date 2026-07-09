import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createMessage, createNotification, findProfileByUserId, findUserById, type MessageRecord, type NotificationRecord } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to send a message." },
      { status: 401 }
    );
  }

  const sender = findUserById(sessionUserId);

  if (!sender) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to send a message." },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { memberId, body: messageBody } = (body ?? {}) as Record<string, unknown>;

  if (typeof messageBody !== "string" || !messageBody.trim()) {
    return NextResponse.json(
      { success: false, message: "Message text is required." },
      { status: 400 }
    );
  }

  // Members can only post into their own thread, regardless of what's in the
  // request body. Staff must specify which member's thread they're replying to.
  let resolvedMemberId: string;

  if (sender.role === "staff") {
    if (typeof memberId !== "string" || !memberId.trim()) {
      return NextResponse.json(
        { success: false, message: "A member is required." },
        { status: 400 }
      );
    }

    const member = findUserById(memberId);

    if (!member) {
      return NextResponse.json(
        { success: false, message: "Member not found." },
        { status: 404 }
      );
    }

    resolvedMemberId = member.id;
  } else {
    resolvedMemberId = sender.id;
  }

  const now = new Date().toISOString();

  const message: MessageRecord = {
    id: randomUUID(),
    memberId: resolvedMemberId,
    senderId: sender.id,
    senderRole: sender.role === "staff" ? "staff" : "member",
    body: messageBody.trim(),
    readAt: null,
    createdAt: now,
  };

  createMessage(message);

  // Notify the recipient. Staff messages go to the member; member messages go
  // to staff inboxes (currently no per-staff notification — skip for now).
  if (sender.role === "staff") {
    const senderProfile = findProfileByUserId(sender.id);
    const senderName = senderProfile?.fullName?.trim() || null;

    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: resolvedMemberId,
      type: "message",
      title: senderName ? `New message from ${senderName}` : "New message from your coach",
      body:
        messageBody.trim().length > 120
          ? messageBody.trim().slice(0, 117) + "…"
          : messageBody.trim(),
      readAt: null,
      linkHref: "/dashboard/messages",
      dedupeKey: null,
      createdAt: now,
    };
    createNotification(notification);

    const recipientProfile = findProfileByUserId(resolvedMemberId);
    if (recipientProfile?.pushNotificationsEnabled !== false) {
      void sendPush(resolvedMemberId, {
        title: notification.title,
        body: notification.body,
        linkHref: notification.linkHref ?? "/dashboard/messages",
      });
    }
  }

  return NextResponse.json(
    { success: true, message: "Message sent." },
    { status: 201 }
  );
}
