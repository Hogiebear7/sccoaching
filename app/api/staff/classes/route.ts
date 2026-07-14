import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findClassById, findClassCategories, findUserById, saveClass, type ClassCategory, type ClassRecord } from "@/lib/db";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { isFutureDateTime } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

// Weekly date arithmetic in plain Y-M-D space, deliberately avoiding
// Date→ISO round-trips whose UTC conversion can shift the calendar day.
function addWeeks(isoDate: string, weeks: number): string {
  if (weeks === 0) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + weeks * 7);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

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

  const { id, title, category, date, startTime, durationMins, capacity, repeatWeeks } =
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

  // Recurrence: weekly repeats only, materialised at creation time so every
  // occurrence is an ordinary class (bookings, waitlists, rosters unchanged).
  // Ignored on edits — editing always targets a single occurrence.
  let repeatCount = 1;
  if (!existingClass && repeatWeeks !== undefined && repeatWeeks !== null && repeatWeeks !== "") {
    const parsed = Number(repeatWeeks);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
      return NextResponse.json(
        { success: false, message: "Repeat must be between 1 and 12 weeks." },
        { status: 400 }
      );
    }
    repeatCount = parsed;
  }

  const now = new Date().toISOString();
  const firstClassId = existingClass?.id ?? randomUUID();

  for (let week = 0; week < repeatCount; week++) {
    const classRecord: ClassRecord = {
      id: week === 0 ? firstClassId : randomUUID(),
      title: title.trim(),
      category: category as ClassCategory,
      coachUserId: existingClass?.coachUserId ?? user.id,
      date: addWeeks(date.trim(), week),
      startTime: startTime.trim(),
      durationMins: durationResult.value,
      capacity: capacityResult.value,
      createdAt: existingClass?.createdAt ?? now,
      updatedAt: now,
    };

    saveClass(classRecord);
  }

  // Each additional seat opened by a capacity raise is a new slot to offer.
  if (existingClass && capacityResult.value > existingClass.capacity) {
    const newSlots = capacityResult.value - existingClass.capacity;
    for (let i = 0; i < newSlots; i++) {
      try {
        issueWaitlistOffer(firstClassId);
      } catch {
        // Offer failure must not block the save response.
      }
    }
  }

  const message = existingClass
    ? "Class updated."
    : repeatCount > 1
      ? `Created ${repeatCount} weekly classes.`
      : "Class created.";

  return NextResponse.json({ success: true, message }, { status: 200 });
}
