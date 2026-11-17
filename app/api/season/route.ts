import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { currentSeason } from "@/lib/seasons";

// What season the website and the phone app should look like today. Public (no personal data); the same answer for everyone. SEASONS_ENABLED=false turns every
// seasonal effect off at once; SEASON_FORCE (e.g. "christmas") shows one season whatever the date. ?force= does the same for one request, for previews.
export async function GET(request: NextRequest) {
  const enabled = process.env.SEASONS_ENABLED !== "false";
  const forceKey = request.nextUrl.searchParams.get("force") ?? process.env.SEASON_FORCE ?? null;
  const now = currentSeason(new Date(), { enabled, forceKey });
  return NextResponse.json(
    { success: true, data: now },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }
  );
}
