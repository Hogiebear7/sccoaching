import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassCategories,
  findClassWorkoutTemplateById,
  findUserById,
  saveClassWorkoutTemplate,
  type ClassCategory,
  type ClassWorkoutTemplateExercise,
  type ClassWorkoutTemplateRecord,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const MAX_EXERCISES = 30;
const MAX_NAME_LENGTH = 80;

function normalizeExercises(input: unknown): ClassWorkoutTemplateExercise[] {
  if (!Array.isArray(input)) return [];

  const result: ClassWorkoutTemplateExercise[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue;

    const perSide = entry.perSide === true;

    result.push({
      exerciseId: typeof entry.exerciseId === "string" && entry.exerciseId ? entry.exerciseId : null,
      name,
      weight: typeof entry.weight === "string" ? entry.weight.trim() : "",
      reps: !perSide && typeof entry.reps === "number" && Number.isFinite(entry.reps) ? Math.round(entry.reps) : null,
      sets: typeof entry.sets === "number" && Number.isFinite(entry.sets) ? Math.round(entry.sets) : null,
      supersetGroup: typeof entry.supersetGroup === "string" && entry.supersetGroup.trim() ? entry.supersetGroup.trim() : null,
      perSide,
      repsRight: perSide && typeof entry.repsRight === "number" && Number.isFinite(entry.repsRight) ? Math.round(entry.repsRight) : null,
      repsLeft: perSide && typeof entry.repsLeft === "number" && Number.isFinite(entry.repsLeft) ? Math.round(entry.repsLeft) : null,
    });

    if (result.length >= MAX_EXERCISES) break;
  }
  return result;
}

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage workout templates." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can manage workout templates." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, name, categories, notes, exercises } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Template name is required." }, { status: 400 });
  }
  const cleanName = name.trim().slice(0, MAX_NAME_LENGTH);

  const validSlugs = new Set(findClassCategories().map((c) => c.slug));
  const cleanCategories: ClassCategory[] = Array.isArray(categories)
    ? categories.filter((c): c is string => typeof c === "string" && validSlugs.has(c))
    : [];
  if (cleanCategories.length === 0) {
    return NextResponse.json({ success: false, message: "Pick at least one class category." }, { status: 400 });
  }

  const cleanExercises = normalizeExercises(exercises);
  if (cleanExercises.length === 0) {
    return NextResponse.json({ success: false, message: "Add at least one exercise." }, { status: 400 });
  }

  const existing = typeof id === "string" && id.trim() ? findClassWorkoutTemplateById(id) : undefined;
  const now = new Date().toISOString();

  const template: ClassWorkoutTemplateRecord = {
    id: existing?.id ?? randomUUID(),
    name: cleanName,
    categories: cleanCategories,
    exercises: cleanExercises,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    createdByStaffId: existing?.createdByStaffId ?? staffUser.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveClassWorkoutTemplate(template);

  return NextResponse.json({ success: true, message: existing ? "Template updated." : "Template created.", data: template }, { status: 200 });
}
