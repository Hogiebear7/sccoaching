import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteExpoPushToken,
  findUserById,
  saveExpoPushToken,
  type ExpoPushTokenRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Registers/unregisters this device's Expo push token against the signed-in
// member. Distinct from /api/push/subscribe (web app's browser Web Push) —
// both are fanned out to by lib/push.ts's sendPush().
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId || !findUserById(userId)) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { token, deviceInfo } = (body ?? {}) as Record<string, unknown>;

  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ success: false, message: "token (string) is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const record: ExpoPushTokenRecord = {
    id: randomUUID(),
    userId,
    token: token.trim(),
    deviceInfo: typeof deviceInfo === "string" && deviceInfo.trim() ? deviceInfo.trim() : null,
    createdAt: now,
    updatedAt: now,
  };

  saveExpoPushToken(record);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId || !findUserById(userId)) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { token } = (body ?? {}) as Record<string, unknown>;

  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ success: false, message: "token (string) is required." }, { status: 400 });
  }

  deleteExpoPushToken(userId, token.trim());

  return NextResponse.json({ success: true });
}
