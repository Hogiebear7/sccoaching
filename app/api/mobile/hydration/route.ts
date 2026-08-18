import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, findWaterLogByUserIdAndDate, saveWaterLog } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { getResolvedNutritionTarget } from "@/lib/nutrition-target-data";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Target is 1ml of water per kcal in the member's daily calorie target —
// the same number already shown on the Nutrition tab, so hydration can't
// disagree with what the member sees there (auto or manual mode both work,
// since both resolve to a `calories` figure).
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date")?.trim() || todayISO();
  const target = getResolvedNutritionTarget(user.id, date, todayISO());
  const logged = findWaterLogByUserIdAndDate(user.id, date)?.ml ?? 0;

  return NextResponse.json({
    success: true,
    data: {
      date,
      targetMl: target?.calories ?? null,
      loggedMl: logged,
    },
  });
}

// Body: either { date, deltaMl } to add to that day's running total
// (quick-add buttons) or { date, setMl } to overwrite it with an exact
// figure the member typed in — the latter is the escape hatch for
// correcting an accidental double-tap on a quick-add button.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { date, deltaMl, setMl } = (body ?? {}) as Record<string, unknown>;
  const resolvedDate = typeof date === "string" && date.trim() ? date.trim() : todayISO();

  const isValidAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;

  if (setMl !== undefined) {
    if (!isValidAmount(setMl)) {
      return NextResponse.json({ success: false, message: "setMl must be a number between 0 and 10000." }, { status: 400 });
    }
  } else if (typeof deltaMl !== "number" || !Number.isFinite(deltaMl) || deltaMl <= 0 || deltaMl > 5000) {
    return NextResponse.json({ success: false, message: "deltaMl must be a positive number up to 5000." }, { status: 400 });
  }

  const existing = findWaterLogByUserIdAndDate(user.id, resolvedDate);
  const now = new Date().toISOString();
  const updated = {
    id: existing?.id ?? randomUUID(),
    userId: user.id,
    date: resolvedDate,
    ml: setMl !== undefined ? Math.round(setMl as number) : Math.round((existing?.ml ?? 0) + (deltaMl as number)),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  saveWaterLog(updated);

  return NextResponse.json({ success: true, data: { date: resolvedDate, loggedMl: updated.ml } });
}
