import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveGym } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { publicApiKey } from "@/lib/gym-api-keys";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// Revoke one of the asking gym's keys at once. A key that is not this gym's is "not found".
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const gym = gymRecordForUser(user);
  if (!gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  const { id } = await context.params;
  const keys = gym.apiKeys ?? [];
  if (!keys.some((k) => k.id === id && !k.revokedAt)) return NextResponse.json({ success: false, message: "That key no longer exists." }, { status: 404 });
  saveGym({ ...gym, apiKeys: keys.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)), updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Revoked. Anything using that key stops working now." });
}
