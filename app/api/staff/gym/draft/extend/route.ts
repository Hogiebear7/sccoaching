import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, findUserById, saveGym } from "@/lib/db";
import { canExtendDraft, DRAFT_EXTENSION_DAYS, extensionUntil } from "@/lib/gym-draft-expiry";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { gymNotLive } from "@/lib/tenant-live";
import { requireTenantAccess } from "@/lib/tenant-request";

// "Save my setup for 3 more days": the owner of a new gym that has not gone live asks once to keep the saved setup a little longer (lib/gym-draft-expiry.ts). The gym is always the acting
// admin's own (from their account, never the request). It can be used once; after that window the setup is removed.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can do this." }, { status: 403 });

  const gym = user.gymId ? findGymById(user.gymId) : undefined;
  if (!gym) return NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 404 });
  if (!gymNotLive(gym) || gym.platformBilling) {
    return NextResponse.json({ success: false, message: "Your gym does not need this: its setup is not at risk." }, { status: 409 });
  }
  if (!canExtendDraft(gym)) {
    return NextResponse.json({ success: false, message: "You have already used your extra days. Go live to keep your setup for good." }, { status: 409 });
  }
  const until = extensionUntil(new Date());
  saveGym({ ...gym, draftExtendedUntil: until, updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: `Your setup is saved for ${DRAFT_EXTENSION_DAYS} more days.`, data: { extendedUntil: until } });
}
