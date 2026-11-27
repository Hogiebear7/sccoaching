import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { buildMessage, sendWebhook } from "@/lib/gym-webhooks";
import { findUserById } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";
import { publicWebhook } from "@/lib/gym-webhooks-admin";

// "Send a test": sends one harmless message (type test.ping) to this connection now and says plainly whether the receiver took it. Counts like a real delivery for the status shown.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const found = { gym: gymRecordForUser(user) };
  if (!found.gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  const { id } = await context.params;
  const hook = (found.gym.webhooks ?? []).find((h) => h.id === id);
  if (!hook) return NextResponse.json({ success: false, message: "That connection no longer exists." }, { status: 404 });

  const message = buildMessage("test.ping", { note: "This is a test from your gym's settings. If you can see this, the connection works." });
  const result = await sendWebhook(hook, message);

  const fresh = findGymById(found.gym.id);
  const hooks = fresh?.webhooks ?? [];
  const updated = hooks.map((h) =>
    h.id !== id
      ? h
      : result.ok
        ? { ...h, lastDeliveryAt: new Date().toISOString(), lastStatus: "ok" as const, lastError: null, consecutiveFailures: 0 }
        : { ...h, lastDeliveryAt: new Date().toISOString(), lastStatus: "failed" as const, lastError: result.error },
  );
  if (fresh) saveGym({ ...fresh, webhooks: updated });
  const shown = updated.find((h) => h.id === id) ?? hook;
  return NextResponse.json({ success: result.ok, message: result.ok ? "The test arrived. Your connection works." : result.error, data: { webhook: publicWebhook(shown) } }, { status: result.ok ? 200 : 502 });
}
