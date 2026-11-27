import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { saveGym } from "@/lib/db";
import { isEventType } from "@/lib/gym-webhooks";
import { findUserById } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";
import { publicWebhook } from "@/lib/gym-webhooks-admin";

// Change (switch on or off, choose what is sent) or remove one of the asking gym's webhooks. The id must belong to the asker's own gym; anything else is "not found".
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const found = { gym: gymRecordForUser(user) };
  if (!found.gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  const { id } = await context.params;
  const gym = found.gym;
  const hooks = gym.webhooks ?? [];
  const hook = hooks.find((h) => h.id === id);
  if (!hook) return NextResponse.json({ success: false, message: "That connection no longer exists." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { enabled, events } = (body ?? {}) as Record<string, unknown>;
  const next = { ...hook };
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return NextResponse.json({ success: false, message: "Enabled must be true or false." }, { status: 400 });
    next.enabled = enabled;
    // Switching it back on gives it a clean start.
    if (enabled) next.consecutiveFailures = 0;
  }
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0 || !events.every(isEventType)) return NextResponse.json({ success: false, message: "Choose at least one thing to send." }, { status: 400 });
    next.events = [...new Set(events as string[])];
  }
  saveGym({ ...gym, webhooks: hooks.map((h) => (h.id === id ? next : h)), updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, data: { webhook: publicWebhook(next) } });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const found = { gym: gymRecordForUser(user) };
  if (!found.gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  const { id } = await context.params;
  const gym = found.gym;
  const hooks = gym.webhooks ?? [];
  if (!hooks.some((h) => h.id === id)) return NextResponse.json({ success: false, message: "That connection no longer exists." }, { status: 404 });
  saveGym({ ...gym, webhooks: hooks.filter((h) => h.id !== id), updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Removed." });
}
