import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getWorkoutsData } from "@/lib/workouts-data";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { requireTenantAccessForUserId } from "@/lib/tenant-request";

export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const tenantLock = requireTenantAccessForUserId(session.userId);
  if (tenantLock) return tenantLock;

  const data = getWorkoutsData(session.userId);
  if (!data) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ success: true, data });
}
