import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { saveGym } from "@/lib/db";
import { checkWebhookHost, isEventType, MAX_WEBHOOKS_PER_GYM, newWebhookSecret, validateWebhookUrl } from "@/lib/gym-webhooks";
import { findUserById } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";
import { publicWebhook } from "@/lib/gym-webhooks-admin";
import { randomUUID } from "crypto";

// A gym's outgoing webhooks: list them, and add one. The gym is the asker's own (lib/gym-webhooks-admin.ts). The secret is returned ONCE, when the webhook is created.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const found = { gym: gymRecordForUser(user) };
  if (!found.gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  return NextResponse.json({ success: true, data: { webhooks: (found.gym.webhooks ?? []).map(publicWebhook) } });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const found = { gym: gymRecordForUser(user) };
  if (!found.gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  const gym = found.gym;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { url, events } = (body ?? {}) as Record<string, unknown>;

  if ((gym.webhooks ?? []).length >= MAX_WEBHOOKS_PER_GYM) {
    return NextResponse.json({ success: false, message: `You can have up to ${MAX_WEBHOOKS_PER_GYM} connections. Remove one to add another.` }, { status: 409 });
  }
  const parsed = validateWebhookUrl(url);
  if (!parsed.ok) return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  const host = await checkWebhookHost(parsed.url);
  if (!host.ok) return NextResponse.json({ success: false, message: host.message }, { status: 400 });
  if (!Array.isArray(events) || events.length === 0 || !events.every(isEventType)) {
    return NextResponse.json({ success: false, message: "Choose at least one thing to send." }, { status: 400 });
  }
  if ((gym.webhooks ?? []).some((h) => h.url === parsed.url)) {
    return NextResponse.json({ success: false, message: "That address is already connected." }, { status: 409 });
  }

  const secret = newWebhookSecret();
  const hook = { id: randomUUID(), url: parsed.url, events: [...new Set(events as string[])], secret, enabled: true, createdAt: new Date().toISOString(), lastDeliveryAt: null, lastStatus: null, lastError: null, consecutiveFailures: 0 };
  saveGym({ ...gym, webhooks: [...(gym.webhooks ?? []), hook], updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Connected.", data: { webhook: publicWebhook(hook), secret } }, { status: 201 });
}
