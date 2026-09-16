import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifyRequestSession } from "@/lib/mobile-auth";

// Free-text → coordinates, for find-a-coach.tsx's manual search fallback
// (device location denied/unavailable — the common case in an in-app
// browser or a locked-down device). Proxied server-side rather than called
// from the client directly: Nominatim's usage policy requires a real
// identifying User-Agent and caps at ~1 request/second, both easier to get
// right in one place than to trust every client build to respect. No API
// key needed — see the self-serve gym signup route's own comment on this
// being the deliberately deferred, swappable choice (Nominatim/OSM now,
// a paid provider later if volume or accuracy ever demands it).
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "SCPerformanceCoachingApp/1.0 (+https://sandccoaching.com)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ success: false, message: "A search term is required." }, { status: 400 });
  }

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=1`;

  let results: NominatimResult[];
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      return NextResponse.json({ success: false, message: "Location search is temporarily unavailable." }, { status: 502 });
    }
    results = (await res.json()) as NominatimResult[];
  } catch {
    return NextResponse.json({ success: false, message: "Location search is temporarily unavailable." }, { status: 502 });
  }

  const match = results[0];
  if (!match) {
    return NextResponse.json({ success: false, message: "Couldn't find that place. Try a nearby town or city." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: { lat: Number(match.lat), lng: Number(match.lon), label: match.display_name },
  });
}
