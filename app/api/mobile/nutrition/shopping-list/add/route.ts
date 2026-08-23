import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findShoppingListItemByName,
  findShoppingListItemsByUserId,
  findUserById,
  saveShoppingListItem,
  type ShoppingListItemRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_ITEMS_PER_REQUEST = 100;

interface IncomingItem {
  displayText: string;
  normalizedName: string | null;
  quantity: number | null;
  unit: string | null;
  sourceRecipeId: string | null;
}

function parseIncomingItem(raw: unknown): IncomingItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const displayText = typeof r.displayText === "string" ? r.displayText.trim().slice(0, 200) : "";
  if (!displayText) return null;
  return {
    displayText,
    normalizedName: typeof r.normalizedName === "string" && r.normalizedName.trim() ? r.normalizedName.trim().slice(0, 200) : null,
    quantity: typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : null,
    unit: typeof r.unit === "string" && r.unit.trim() ? r.unit.trim().slice(0, 20) : null,
    sourceRecipeId: typeof r.sourceRecipeId === "string" && r.sourceRecipeId.trim() ? r.sourceRecipeId.trim() : null,
  };
}

// Batch add — used both for "+ Add item" (a single-item array) and "Add
// ingredients to shopping list" from a saved recipe (one array call, not N
// requests). Merging is deliberately conservative: an incoming item is only
// ever matched against an EXISTING item by name (see
// findShoppingListItemByName) — never against quantity/unit, since summing
// "2 cups" and "3" of possibly-different units correctly isn't something
// this can do reliably. A name match against an already-unchecked item is
// treated as "already on the list" and left alone; a match against a
// CHECKED item un-checks it and refreshes its quantity/unit/source, since
// re-adding something already bought/ticked off is the common real case
// (a recipe you're cooking again). Anything with no match becomes a new row.
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

  const { items } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, message: "No items to add." }, { status: 400 });
  }

  const parsedItems = items
    .slice(0, MAX_ITEMS_PER_REQUEST)
    .map(parseIncomingItem)
    .filter((i): i is IncomingItem => i !== null);

  if (parsedItems.length === 0) {
    return NextResponse.json({ success: false, message: "No valid items to add." }, { status: 400 });
  }

  const now = new Date().toISOString();
  for (const incoming of parsedItems) {
    const matchKey = incoming.normalizedName ?? incoming.displayText;
    const existing = findShoppingListItemByName(user.id, matchKey);

    if (existing && !existing.checked) {
      // Already on the list and not yet bought — leave it as-is.
      continue;
    }

    if (existing && existing.checked) {
      const revived: ShoppingListItemRecord = {
        ...existing,
        displayText: incoming.displayText,
        normalizedName: incoming.normalizedName,
        quantity: incoming.quantity ?? existing.quantity,
        unit: incoming.unit ?? existing.unit,
        checked: false,
        sourceRecipeId: incoming.sourceRecipeId ?? existing.sourceRecipeId,
        updatedAt: now,
      };
      saveShoppingListItem(revived);
      continue;
    }

    const created: ShoppingListItemRecord = {
      id: randomUUID(),
      userId: user.id,
      displayText: incoming.displayText,
      normalizedName: incoming.normalizedName,
      quantity: incoming.quantity,
      unit: incoming.unit,
      checked: false,
      sourceRecipeId: incoming.sourceRecipeId,
      createdAt: now,
      updatedAt: now,
    };
    saveShoppingListItem(created);
  }

  return NextResponse.json({ success: true, data: findShoppingListItemsByUserId(user.id) });
}
