import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteFoodIdentificationOverride, findUserById, saveFoodIdentificationOverride, type FoodIdentificationOverrideRecord } from "@/lib/db";
import { normalizeTriggerLabel } from "@/lib/food-identification-override";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_NAME_LENGTH = 100;
const MAX_SERVING_LENGTH = 100;

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// POST /api/mobile/nutrition/food/identification-override
// body: { triggerLabel: string, preferredFood: { name, calories, proteinG,
// carbsG, fatG, servingDescription } } — "when the photo tool says
// triggerLabel again, use preferredFood instead." Saved from the "Always use
// this instead" action on a reviewed photo-scan item; see
// lib/food-identification-override.ts for how it's applied.
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

  const { triggerLabel, preferredFood } = (body ?? {}) as Record<string, unknown>;

  if (typeof triggerLabel !== "string" || !triggerLabel.trim()) {
    return NextResponse.json({ success: false, message: "triggerLabel is required." }, { status: 400 });
  }

  const pf = (preferredFood ?? {}) as Record<string, unknown>;
  const name = typeof pf.name === "string" ? pf.name.trim().slice(0, MAX_NAME_LENGTH) : "";
  const calories = nonNegativeNumber(pf.calories);
  const proteinG = nonNegativeNumber(pf.proteinG);
  const carbsG = nonNegativeNumber(pf.carbsG);
  const fatG = nonNegativeNumber(pf.fatG);
  const servingDescription = typeof pf.servingDescription === "string" ? pf.servingDescription.trim().slice(0, MAX_SERVING_LENGTH) : "";

  if (!name || calories === null || proteinG === null || carbsG === null || fatG === null) {
    return NextResponse.json(
      { success: false, message: "preferredFood must include a name and non-negative calories/proteinG/carbsG/fatG." },
      { status: 400 }
    );
  }

  const record: FoodIdentificationOverrideRecord = {
    id: randomUUID(),
    userId: user.id,
    triggerLabel: normalizeTriggerLabel(triggerLabel),
    preferredFood: { name, calories, proteinG, carbsG, fatG, servingDescription },
    createdAt: new Date().toISOString(),
  };

  saveFoodIdentificationOverride(record);

  return NextResponse.json({ success: true, data: record }, { status: 201 });
}

// DELETE /api/mobile/nutrition/food/identification-override?id=...
// Lets a member undo a bad standing correction.
export async function DELETE(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  deleteFoodIdentificationOverride(id, user.id);

  return NextResponse.json({ success: true });
}
