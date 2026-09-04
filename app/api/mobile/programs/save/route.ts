import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveTrainingProgram, type TrainingProgramRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { archiveOtherActivePrograms, parseProgramDays, parseTestCheckpoints } from "@/lib/training-programs";

interface AiMetaInput {
  goal: string;
  splitStyle: string;
  daysPerWeek: number;
  sessionMinutes: number;
  equipmentSlugs: string[];
  gymProfileId: string | null;
  notes: string | null;
  generatedAt: string;
}

function parseAiMeta(input: unknown): AiMetaInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (typeof m.goal !== "string" || typeof m.splitStyle !== "string") return null;
  return {
    goal: m.goal.slice(0, 200),
    splitStyle: m.splitStyle.slice(0, 60),
    daysPerWeek: typeof m.daysPerWeek === "number" ? m.daysPerWeek : 0,
    sessionMinutes: typeof m.sessionMinutes === "number" ? m.sessionMinutes : 45,
    equipmentSlugs: Array.isArray(m.equipmentSlugs) ? m.equipmentSlugs.filter((s): s is string => typeof s === "string") : [],
    gymProfileId: typeof m.gymProfileId === "string" ? m.gymProfileId : null,
    notes: typeof m.notes === "string" && m.notes.trim() ? m.notes.trim().slice(0, 500) : null,
    generatedAt: typeof m.generatedAt === "string" ? m.generatedAt : new Date().toISOString(),
  };
}

// POST /api/mobile/programs/save
// The "commit" half of the AI programme builder — persists exactly what
// /generate previewed (re-validated, but no second AI call). Archives
// whatever programme the member currently has active, same as staff
// assigning a new one.
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

  const { name, days, totalWeeks, aiMeta, testCheckpoints } = (body ?? {}) as Record<string, unknown>;

  const cleanName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "AI Programme";
  const cleanTotalWeeks = typeof totalWeeks === "number" && Number.isFinite(totalWeeks) ? totalWeeks : null;
  const cleanAiMeta = parseAiMeta(aiMeta);
  const cleanTestCheckpoints = parseTestCheckpoints(testCheckpoints);

  const validated = parseProgramDays(days);
  if (!validated.ok) {
    return NextResponse.json({ success: false, message: validated.message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const program: TrainingProgramRecord = {
    id: randomUUID(),
    userId: user.id,
    name: cleanName,
    status: "active",
    days: validated.days,
    currentDayIndex: 0,
    // No staff involved in an AI-generated programme — the member is its
    // own "creator" here, same field reused rather than made nullable.
    createdByStaffId: user.id,
    createdAt: now,
    updatedAt: now,
    source: "ai",
    totalWeeks: cleanTotalWeeks,
    completedCycles: 0,
    cycleStartedAt: now,
    aiMeta: cleanAiMeta,
    testCheckpoints: cleanTestCheckpoints,
  };

  saveTrainingProgram(program);
  archiveOtherActivePrograms(user.id, program.id);

  return NextResponse.json({ success: true, message: "Programme saved.", data: { program } });
}
