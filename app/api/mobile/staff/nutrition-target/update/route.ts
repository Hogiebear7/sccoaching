import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findNutritionTargetByUserId,
  findUserById,
  saveNutritionTarget,
  type NutritionTargetMode,
  type NutritionTargetRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

const MODES: NutritionTargetMode[] = ["auto", "manual", "disabled"];

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "nutrition.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { userId, mode: rawMode, calories, proteinG, carbsG, fatG, notes } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "A member must be selected." }, { status: 400 });
  }
  const member = findUserById(userId);
  if (!member) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  const mode: NutritionTargetMode = typeof rawMode === "string" && MODES.includes(rawMode as NutritionTargetMode)
    ? (rawMode as NutritionTargetMode)
    : "manual"; // back-compat: callers that never send mode are the old manual-only form

  let cals: number | null = null;
  let protein: number | null = null;
  let carbs: number | null = null;
  let fat: number | null = null;

  if (mode === "manual") {
    cals = positiveInt(calories);
    protein = positiveInt(proteinG);
    carbs = positiveInt(carbsG);
    fat = positiveInt(fatG);
    if (cals === null || protein === null || carbs === null || fat === null) {
      return NextResponse.json({ success: false, message: "Calories and macros must be non-negative numbers." }, { status: 400 });
    }
  }

  const existing = findNutritionTargetByUserId(member.id);
  const now = new Date().toISOString();
  const target: NutritionTargetRecord = {
    id: existing?.id ?? randomUUID(),
    userId: member.id,
    mode,
    calories: cals,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    setByStaffId: staffUser.id,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveNutritionTarget(target);

  return NextResponse.json({ success: true, message: "Target saved.", data: target }, { status: 200 });
}
