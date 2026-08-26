import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, updateGymProfile, type GymProfileRecord } from "@/lib/db";
import { findEquipmentBySlug } from "@/lib/equipment-catalog";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberTierForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_NAME_LENGTH = 60;
const MAX_EQUIPMENT_SLUGS = 200;

function parseEquipmentSlugs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter((s): s is string => typeof s === "string" && !!findEquipmentBySlug(s));
  return [...new Set(valid)].slice(0, MAX_EQUIPMENT_SLUGS);
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  if (!hasAccess(resolveMemberTierForUser(user.id), "gymProfiles")) {
    return NextResponse.json({ success: false, message: "Gym profiles need App Subscription or above." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, name, icon, equipmentSlugs } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A gym profile is required." }, { status: 400 });
  }

  const patch: Partial<Pick<GymProfileRecord, "name" | "icon" | "equipmentSlugs">> = {};
  if (typeof name === "string") {
    if (!name.trim()) {
      return NextResponse.json({ success: false, message: "Give this gym profile a name." }, { status: 400 });
    }
    patch.name = name.trim().slice(0, MAX_NAME_LENGTH);
  }
  if (typeof icon === "string" || icon === null) {
    patch.icon = typeof icon === "string" && icon.trim() ? icon.trim().slice(0, 8) : null;
  }
  if (equipmentSlugs !== undefined) {
    patch.equipmentSlugs = parseEquipmentSlugs(equipmentSlugs);
  }

  const updated = updateGymProfile(user.id, id, patch);

  if (!updated) {
    return NextResponse.json({ success: false, message: "Gym profile not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: "Gym profile updated.", data: updated }, { status: 200 });
}
