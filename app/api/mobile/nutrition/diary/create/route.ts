import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveFoodEntry, type FoodEntryRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { parseFoodEntryInput } from "@/lib/nutrition-diary";

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

  const parsed = parseFoodEntryInput((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  const entry: FoodEntryRecord = {
    id: randomUUID(),
    userId: user.id,
    ...parsed.value,
    createdAt: new Date().toISOString(),
  };

  saveFoodEntry(entry);

  return NextResponse.json({ success: true, message: "Logged.", data: entry }, { status: 201 });
}
