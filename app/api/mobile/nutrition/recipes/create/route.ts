import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveRecipe, type RecipeIngredientEntry, type RecipeRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_INGREDIENTS = 60;

function parseIngredient(raw: unknown): RecipeIngredientEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const displayText = typeof r.displayText === "string" ? r.displayText.trim().slice(0, 200) : "";
  if (!displayText) return null;
  return {
    displayText,
    normalizedName: typeof r.normalizedName === "string" && r.normalizedName.trim() ? r.normalizedName.trim().slice(0, 200) : null,
    quantity: typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : null,
    unit: typeof r.unit === "string" && r.unit.trim() ? r.unit.trim().slice(0, 20) : null,
  };
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

  const { title, ingredients, notes, source } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ success: false, message: "Recipe name is required." }, { status: 400 });
  }

  const parsedIngredients = Array.isArray(ingredients)
    ? ingredients.slice(0, MAX_INGREDIENTS).map(parseIngredient).filter((i): i is RecipeIngredientEntry => i !== null)
    : [];

  if (parsedIngredients.length === 0) {
    return NextResponse.json({ success: false, message: "Add at least one ingredient." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const recipe: RecipeRecord = {
    id: randomUUID(),
    userId: user.id,
    title: title.trim().slice(0, 100),
    ingredients: parsedIngredients,
    notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 500) : null,
    source: source === "meal-suggest" ? "meal-suggest" : "manual",
    createdAt: now,
    updatedAt: now,
  };

  saveRecipe(recipe);

  return NextResponse.json({ success: true, message: "Recipe saved.", data: recipe }, { status: 200 });
}
