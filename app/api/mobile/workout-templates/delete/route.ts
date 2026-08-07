import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteWorkoutTemplate, findUserById, findWorkoutTemplateById } from "@/lib/db";
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
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  const existing = findWorkoutTemplateById(id);
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Template not found." }, { status: 404 });
  }

  deleteWorkoutTemplate(id);

  return NextResponse.json({ success: true, message: "Template deleted." }, { status: 200 });
}
