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
// How many candidates to ask Nominatim for. Confirmed empirically (querying
// Nominatim directly) that a bare, low-specificity query like "Navan"
// genuinely has this many distinct real-world matches — Canada, two in
// Ireland, Northern Ireland, Norway — so 5 is enough to surface the
// realistic ambiguity without over-fetching.
const CANDIDATE_LIMIT = 5;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface GeocodeCandidate {
  lat: number;
  lng: number;
  label: string;
}

function toCandidate(result: NominatimResult): GeocodeCandidate {
  return { lat: Number(result.lat), lng: Number(result.lon), label: result.display_name };
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

  // Deliberately no countrycodes/viewbox bias in this pass — the fix here is
  // disambiguation (ask for enough candidates, let the user choose), not
  // guessing a "more likely" region. See the route's header comment.
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=${CANDIDATE_LIMIT}`;

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

  if (results.length === 0) {
    return NextResponse.json({ success: false, message: "Couldn't find that place. Try a nearby town or city." }, { status: 404 });
  }

  // The safety rule, and its honest limit: "exactly one candidate came back"
  // is treated as unambiguous. This is a practical signal, not a proof — a
  // very short/generic query could in principle have a real match Nominatim
  // itself ranks below what CANDIDATE_LIMIT surfaces, and this route has no
  // way to know that without a second, fancier data source. Deliberately not
  // built here (see the plan this route was approved against): a query that
  // returns 2+ candidates is unambiguous-until-proven-otherwise the wrong
  // way to fail, so any count above 1 is treated as needing a human choice,
  // and a single candidate is trusted rather than second-guessed with
  // scoring heuristics this route has no reliable basis for.
  if (results.length === 1) {
    return NextResponse.json({ success: true, data: toCandidate(results[0]) });
  }

  return NextResponse.json({ success: true, data: { candidates: results.map(toCandidate) } });
}
