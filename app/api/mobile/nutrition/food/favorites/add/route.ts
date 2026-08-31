import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createFoodFavorite, findUserById, type FoodFavoriteRecord, type MealType } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

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

  const { mealType, name, calories, proteinG, carbsG, fatG, servingLabel, servingGrams } = (body ?? {}) as Record<string, unknown>;

  if (typeof mealType !== "string" || !MEAL_TYPES.includes(mealType as MealType)) {
    return NextResponse.json({ success: false, message: "Invalid meal type." }, { status: 400 });
  }
  const trimmedName = typeof name === "string" ? name.trim().slice(0, 200) : "";
  if (!trimmedName) {
    return NextResponse.json({ success: false, message: "Food name is required." }, { status: 400 });
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

  const record: FoodFavoriteRecord = {
    id: randomUUID(),
    userId: user.id,
    mealType: mealType as MealType,
    name: trimmedName,
    calories: num(calories),
    proteinG: num(proteinG),
    carbsG: num(carbsG),
    fatG: num(fatG),
    servingLabel: typeof servingLabel === "string" && servingLabel.trim() ? servingLabel.trim().slice(0, 100) : null,
    servingGrams: typeof servingGrams === "number" && Number.isFinite(servingGrams) && servingGrams > 0 ? servingGrams : null,
    createdAt: new Date().toISOString(),
  };

  createFoodFavorite(record);
  return NextResponse.json({ success: true, data: record });
}
