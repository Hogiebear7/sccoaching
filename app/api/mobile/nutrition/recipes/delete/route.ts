import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteRecipe, findRecipeById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

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

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ success: false, message: "Missing recipe id." }, { status: 400 });
  }

  const recipe = findRecipeById(id);
  if (!recipe || recipe.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Recipe not found." }, { status: 404 });
  }

  deleteRecipe(id);
  return NextResponse.json({ success: true, message: "Recipe deleted." });
}
