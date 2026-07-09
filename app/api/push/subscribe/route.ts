import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deletePushSubscriptionByEndpoint,
  findUserById,
  savePushSubscription,
  type PushSubscriptionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

function getSession(request: NextRequest): string | null {
  return verifySession(request.cookies.get("session")?.value)?.userId ?? null;
}

export async function POST(request: NextRequest) {
  const userId = getSession(request);
  if (!userId || !findUserById(userId)) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { endpoint, keys, userAgent } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    typeof keys !== "object" ||
    keys === null ||
    typeof (keys as Record<string, unknown>).p256dh !== "string" ||
    typeof (keys as Record<string, unknown>).auth !== "string"
  ) {
    return NextResponse.json(
      { error: "endpoint (string) and keys.p256dh + keys.auth (strings) are required." },
      { status: 400 }
    );
  }

  const { p256dh, auth } = keys as { p256dh: string; auth: string };
  const now = new Date().toISOString();

  const sub: PushSubscriptionRecord = {
    id: randomUUID(),
    userId,
    endpoint,
    p256dh,
    auth,
    userAgent: typeof userAgent === "string" ? userAgent : null,
    createdAt: now,
    updatedAt: now,
  };

  // savePushSubscription upserts by (userId, endpoint) — no duplicates.
  savePushSubscription(sub);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const userId = getSession(request);
  if (!userId || !findUserById(userId)) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { endpoint } = (body ?? {}) as Record<string, unknown>;

  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "endpoint (string) is required." }, { status: 400 });
  }

  // Scoped to the authenticated user — cannot delete another user's subscription.
  deletePushSubscriptionByEndpoint(userId, endpoint);

  return NextResponse.json({ success: true });
}
