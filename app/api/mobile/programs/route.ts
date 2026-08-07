import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findActiveTrainingProgramByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const program = findActiveTrainingProgramByUserId(user.id) ?? null;

  return NextResponse.json({ success: true, data: { program } });
}
