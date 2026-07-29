import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassById,
  findClassCategories,
  findClassSeriesById,
  findUserById,
  saveClass,
  saveClassSeries,
  type ClassCategory,
  type ClassRecord,
  type ClassSeriesRecord,
} from "@/lib/db";
import { generateOccurrencesForSeries } from "@/lib/class-series";
import { resolveCoverAltInput, resolveCoverImageInput } from "@/lib/image-upload";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { isFutureDateTime } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

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

  if (!can(user.role, "classes.manage")) {
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

  const { id, title, category, date, startTime, durationMins, capacity, repeat, weekdays, repeatEndDate, imageUrl, imageAlt } =
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

  const cover = resolveCoverImageInput(imageUrl);
  if (!cover.ok) {
    return NextResponse.json(
      { success: false, message: "That cover image is invalid or too large." },
      { status: 400 }
    );
  }

  const coverAlt = resolveCoverAltInput(imageAlt);
  if (!coverAlt.ok) {
    return NextResponse.json(
      { success: false, message: "That image description is too long." },
      { status: 400 }
    );
  }

  const existingClass = typeof id === "string" && id.trim() ? findClassById(id) : undefined;
  const now = new Date().toISOString();

  // ── Edit path: always a single occurrence ─────────────────────────────
  if (existingClass) {
    // Moving a series occurrence to another date leaves its original slot
    // vacant — tombstone it so rolling generation doesn't re-create it.
    if (existingClass.seriesId && existingClass.date !== date.trim()) {
      const series = findClassSeriesById(existingClass.seriesId);
      if (series && !series.skippedDates.includes(existingClass.date)) {
        saveClassSeries({
          ...series,
          skippedDates: [...series.skippedDates, existingClass.date],
          updatedAt: now,
        });
      }
    }

    const classRecord: ClassRecord = {
      ...existingClass,
      title: title.trim(),
      category: category as ClassCategory,
      date: date.trim(),
      startTime: startTime.trim(),
      durationMins: durationResult.value,
      capacity: capacityResult.value,
      // undefined = keep existing; null = remove; string = set.
      imageUrl: cover.value === undefined ? existingClass.imageUrl ?? null : cover.value,
      imageAlt: coverAlt.value === undefined ? existingClass.imageAlt ?? null : coverAlt.value,
      updatedAt: now,
    };
    saveClass(classRecord);

    // Each additional seat opened by a capacity raise is a new slot to offer.
    if (capacityResult.value > existingClass.capacity) {
      const newSlots = capacityResult.value - existingClass.capacity;
      for (let i = 0; i < newSlots; i++) {
        try {
          issueWaitlistOffer(existingClass.id);
        } catch {
          // Offer failure must not block the save response.
        }
      }
    }

    return NextResponse.json({ success: true, message: "Class updated." }, { status: 200 });
  }

  // ── Create path: one-off or a recurring weekly series ────────────────
  const repeatMode = repeat === "weekly" ? "weekly" : "none";

  if (repeatMode === "none") {
    const classRecord: ClassRecord = {
      id: randomUUID(),
      title: title.trim(),
      category: category as ClassCategory,
      coachUserId: user.id,
      date: date.trim(),
      startTime: startTime.trim(),
      durationMins: durationResult.value,
      capacity: capacityResult.value,
      imageUrl: cover.value ?? null,
      imageAlt: coverAlt.value ?? null,
      createdAt: now,
      updatedAt: now,
    };
    saveClass(classRecord);
    return NextResponse.json({ success: true, message: "Class created." }, { status: 200 });
  }

  // Weekly series: validate weekdays and optional end date, then create the
  // series and generate its occurrences within the rolling horizon. The
  // occurrences are ordinary classes; the series only schedules them.
  const weekdayValues = Array.isArray(weekdays)
    ? Array.from(new Set(weekdays.map(Number)))
    : [];

  if (
    weekdayValues.length === 0 ||
    weekdayValues.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    return NextResponse.json(
      { success: false, message: "Pick at least one weekday for a repeating class." },
      { status: 400 }
    );
  }

  let endDateValue: string | null = null;
  if (typeof repeatEndDate === "string" && repeatEndDate.trim()) {
    endDateValue = repeatEndDate.trim();
    if (endDateValue < date.trim()) {
      return NextResponse.json(
        { success: false, message: "The repeat end date can't be before the start date." },
        { status: 400 }
      );
    }
  }

  const series: ClassSeriesRecord = {
    id: randomUUID(),
    title: title.trim(),
    category: category as ClassCategory,
    coachUserId: user.id,
    weekdays: weekdayValues.sort((a, b) => a - b),
    startTime: startTime.trim(),
    durationMins: durationResult.value,
    capacity: capacityResult.value,
    startDate: date.trim(),
    endDate: endDateValue,
    skippedDates: [],
    isActive: true,
    imageUrl: cover.value ?? null,
    imageAlt: coverAlt.value ?? null,
    createdAt: now,
    updatedAt: now,
  };
  saveClassSeries(series);

  const created = generateOccurrencesForSeries(series);

  return NextResponse.json(
    {
      success: true,
      message: endDateValue
        ? `Repeating class created — ${created} session${created === 1 ? "" : "s"} scheduled (repeats until ${endDateValue}).`
        : `Repeating class created — ${created} session${created === 1 ? "" : "s"} scheduled, and new weeks are added automatically.`,
    },
    { status: 200 }
  );
}
