import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMessagesData } from "@/lib/messages-data";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const data = getMessagesData(session.userId);
  if (!data) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ success: true, data });
}
