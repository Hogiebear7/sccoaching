import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createCommentReport, findCommentById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_REASON_LENGTH = 300;

// POST /api/mobile/community/comments/[id]/report — { reason }
// Files into the same report→queue→resolve pipeline as
// FoodModerationRequest — staff review at /staff/community-reports.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const comment = findCommentById(id);
  if (!comment) {
    return NextResponse.json({ success: false, message: "Comment not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { reason } = (body ?? {}) as Record<string, unknown>;
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON_LENGTH) : "";
  if (!cleanReason) {
    return NextResponse.json({ success: false, message: "A reason is required." }, { status: 400 });
  }

  createCommentReport({
    id: randomUUID(),
    commentId: id,
    reporterId: me.id,
    reason: cleanReason,
    status: "open",
    resolvedByStaffId: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Reported. A coach will review it." });
}
