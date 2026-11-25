import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { resolveBranding, validateBranding } from "@/lib/gym-branding";
import { detectLogoType, MAX_LOGO_BYTES, removeGymLogo, saveGymLogo } from "@/lib/gym-logo-store";
import { getSiteUrl } from "@/lib/site-url";
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

// POST (multipart, field "file"): upload the gym's logo. PNG, JPEG or WebP up to 1 MB, recognised by the file's own bytes. The stored link points at this site, with a version
// number so members see a replaced logo straight away.
export async function POST(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding");
  if (!auth.ok) return auth.response;
  const found = ownGym(auth.user.gymId);
  if (!found.gym) return found.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Send the logo as a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ success: false, message: "Choose a logo file to upload." }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ success: false, message: "That logo is too large. Use a file under 1 MB." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(bytes);
  if (!type) return NextResponse.json({ success: false, message: "Use a PNG, JPG or WebP image." }, { status: 400 });

  saveGymLogo(found.gym.id, bytes, type);
  const logoUrl = `${getSiteUrl()}/api/gym-logo/${found.gym.id}?v=${Date.now()}`;
  const saved = { ...found.gym, branding: { accentColor: found.gym.branding?.accentColor ?? null, logoUrl }, updatedAt: new Date().toISOString() };
  saveGym(saved);
  return NextResponse.json({ success: true, message: "Logo uploaded.", data: { branding: saved.branding, resolved: resolveBranding(saved) } });
}

// DELETE: remove the uploaded logo (or any logo link) and go back to the gym's name.
export async function DELETE(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "gym.manageBranding");
  if (!auth.ok) return auth.response;
  const found = ownGym(auth.user.gymId);
  if (!found.gym) return found.error;
  removeGymLogo(found.gym.id);
  const saved = { ...found.gym, branding: { accentColor: found.gym.branding?.accentColor ?? null, logoUrl: null }, updatedAt: new Date().toISOString() };
  saveGym(saved);
  return NextResponse.json({ success: true, message: "Logo removed.", data: { branding: saved.branding, resolved: resolveBranding(saved) } });
}
