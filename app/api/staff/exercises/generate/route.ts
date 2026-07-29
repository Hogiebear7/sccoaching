import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, type ExerciseSection } from "@/lib/db";
import { AI_NOT_CONFIGURED_MESSAGE, generateExerciseContent, isAiConfigured } from "@/lib/ai";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

const SECTION_LABELS: Record<ExerciseSection, string> = {
  upper_push: "Upper Body — Push",
  upper_pull: "Upper Body — Pull",
  lower_push: "Lower Body — Push",
  lower_pull: "Lower Body — Pull",
  core: "Core",
  cardio: "Cardio",
};

// Drafts description + coaching cues for an exercise. Returns text for
// staff to review and edit — nothing is written to the library here.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  if (!can(user.role, "exercises.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can draft exercise content." },
      { status: 403 }
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, message: AI_NOT_CONFIGURED_MESSAGE },
      { status: 503 }
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

  const { name, section } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { success: false, message: "Type the exercise name first." },
      { status: 400 }
    );
  }

  const sectionLabel =
    typeof section === "string" && section in SECTION_LABELS
      ? SECTION_LABELS[section as ExerciseSection]
      : "General";

  try {
    const draft = await generateExerciseContent({
      name: name.trim().slice(0, 100),
      sectionLabel,
    });

    if (!draft) {
      return NextResponse.json(
        { success: false, message: "Couldn't draft content for that name — check the spelling and try again." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, ...draft }, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, message: "The AI drafting service is unavailable right now." },
      { status: 502 }
    );
  }
}
