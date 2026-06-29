import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findClassById, findClassCategories, findUserById, saveClass, type ClassCategory, type ClassRecord } from "@/lib/db";
import { promoteFromWaitlist } from "@/lib/scheduling";
import { isFutureDateTime } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

function parseRequiredPositiveInt(
  value: unknown
): { ok: true; value: number } | { ok: false } {
  if (typeof value !== "string" || value.trim() === "") return { ok: false };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };

  return { ok: true, value: parsed };
}

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage classes." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage classes." },
      { status: 401 }
    );
  }

  if (user.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage classes." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id, title, category, date, startTime, durationMins, capacity } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { success: false, message: "Class name is required." },
      { status: 400 }
    );
  }

  const activeCategorySlugs = findClassCategories().map((c) => c.slug);
  if (typeof category !== "string" || !activeCategorySlugs.includes(category)) {
    return NextResponse.json(
      { success: false, message: "A valid class category is required." },
      { status: 400 }
    );
  }

  if (typeof date !== "string" || !date.trim()) {
    return NextResponse.json(
      { success: false, message: "Date is required." },
      { status: 400 }
    );
  }

  if (typeof startTime !== "string" || !startTime.trim()) {
    return NextResponse.json(
      { success: false, message: "Start time is required." },
      { status: 400 }
    );
  }

  if (!isFutureDateTime(date, startTime)) {
    return NextResponse.json(
      { success: false, message: "Class date and time must be in the future." },
      { status: 400 }
    );
  }

  const durationResult = parseRequiredPositiveInt(durationMins);

  if (!durationResult.ok) {
    return NextResponse.json(
      { success: false, message: "Duration must be a whole number greater than zero." },
      { status: 400 }
    );
  }

  const capacityResult = parseRequiredPositiveInt(capacity);

  if (!capacityResult.ok) {
    return NextResponse.json(
      { success: false, message: "Capacity must be a whole number greater than zero." },
      { status: 400 }
    );
  }

  const existingClass = typeof id === "string" && id.trim() ? findClassById(id) : undefined;
  const now = new Date().toISOString();

  const classRecord: ClassRecord = {
    id: existingClass?.id ?? randomUUID(),
    title: title.trim(),
    category: category as ClassCategory,
    coachUserId: existingClass?.coachUserId ?? user.id,
    date: date.trim(),
    startTime: startTime.trim(),
    durationMins: durationResult.value,
    capacity: capacityResult.value,
    createdAt: existingClass?.createdAt ?? now,
    updatedAt: now,
  };

  saveClass(classRecord);

  // Raising capacity on an existing class can open a spot for whoever's
  // first on the waitlist.
  if (existingClass && capacityResult.value > existingClass.capacity) {
    promoteFromWaitlist(classRecord.id);
  }

  return NextResponse.json(
    { success: true, message: existingClass ? "Class updated." : "Class created." },
    { status: 200 }
  );
}
