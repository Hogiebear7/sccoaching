import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { resolveBranding, validateBranding } from "@/lib/gym-branding";
import { resolveStaffTenantRequest } from "@/lib/tenant-request";

// A gym's own logo and accent colour. The gym is always the acting staff member's own (resolved from their account, never from the request), so one gym cannot change another's
// look. The S&C primary gym's brand is fixed and is not editable here. The colour must be readable on the app's dark background (lib/gym-branding.ts).

function ownGym(userGymId: string | null | undefined) {
  if (!userGymId) return { error: NextResponse.json({ success: false, message: "The S&C brand is fixed and cannot be changed here." }, { status: 403 }) };
  const gym = findGymById(userGymId);
  if (!gym) return { error: NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 404 }) };
  return { gym };
}

export async function GET(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding");
  if (!auth.ok) return auth.response;
  const found = ownGym(auth.user.gymId);
  if (!found.gym) return found.error;
  return NextResponse.json({ success: true, data: { branding: found.gym.branding ?? { accentColor: null, logoUrl: null }, resolved: resolveBranding(found.gym) } });
}

export async function PUT(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding");
  if (!auth.ok) return auth.response;
  const found = ownGym(auth.user.gymId);
  if (!found.gym) return found.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const result = validateBranding(body, found.gym.branding);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 400 });

  const saved = { ...found.gym, branding: result.branding, updatedAt: new Date().toISOString() };
  saveGym(saved);
  return NextResponse.json({ success: true, message: "Branding saved.", data: { branding: saved.branding, resolved: resolveBranding(saved) } });
}
