import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramsByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// The member's own archived programs — surfaced on the mobile Archive
// screen so a past block isn't just gone once a new one is assigned.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const archived = findTrainingProgramsByUserId(user.id).filter((p) => p.status === "archived");

  return NextResponse.json({ success: true, data: archived });
}
