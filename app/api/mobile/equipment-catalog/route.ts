import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORIES, GYM_PROFILE_PRESETS } from "@/lib/equipment-catalog";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Static reference data (see lib/equipment-catalog.ts) — served from one
// place so the ~120-item list has a single source of truth instead of
// being duplicated in the mobile repo. It changes only on a code deploy,
// so a short shared cache is safe and cuts the repeat-fetch cost down for
// what's otherwise a fairly large, rarely-changing payload.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        categories: EQUIPMENT_CATEGORIES,
        equipment: EQUIPMENT_CATALOG,
        presets: GYM_PROFILE_PRESETS,
      },
    },
    { status: 200, headers: { "Cache-Control": "private, max-age=3600" } }
  );
}
