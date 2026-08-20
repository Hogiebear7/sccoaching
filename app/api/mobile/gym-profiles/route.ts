import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createGymProfile, findProfileByUserId, findUserById, listGymProfilesForUser } from "@/lib/db";
import { findEquipmentBySlug, GYM_PROFILE_PRESETS } from "@/lib/equipment-catalog";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_NAME_LENGTH = 60;
const MAX_EQUIPMENT_SLUGS = 200;

function parseEquipmentSlugs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter((s): s is string => typeof s === "string" && !!findEquipmentBySlug(s));
  return [...new Set(valid)].slice(0, MAX_EQUIPMENT_SLUGS);
}

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    data: {
      profiles: listGymProfilesForUser(user.id),
      activeGymProfileId: findProfileByUserId(user.id)?.activeGymProfileId ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { name, icon, equipmentSlugs, presetSlug } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Give this gym profile a name." }, { status: 400 });
  }

  const cleanPresetSlug =
    typeof presetSlug === "string" && GYM_PROFILE_PRESETS.some((p) => p.slug === presetSlug) ? presetSlug : null;

  const profile = createGymProfile(user.id, {
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    icon: typeof icon === "string" && icon.trim() ? icon.trim().slice(0, 8) : null,
    equipmentSlugs: parseEquipmentSlugs(equipmentSlugs),
    presetSlug: cleanPresetSlug,
  });

  return NextResponse.json({ success: true, message: "Gym profile created.", data: profile }, { status: 200 });
}
