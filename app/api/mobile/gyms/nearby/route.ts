import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGyms } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";

// Members always exist behind the app's own auth — no reason to expose gym
// search to the open internet while there's no public gym-discovery surface
// yet (see mobile find-a-coach.tsx, the only current caller).
const EARTH_RADIUS_KM = 6371;
// How close a member has to be before S&C gets pinned to the top ahead of a
// literally-nearer gym — an explicit promotion rule for S&C specifically,
// not a general ranking weight other gyms could ever benefit from. Kept
// independent of the user-selectable search radius below — if S&C happens
// to fall inside whatever radius the user picked, it still only gets
// pinned within its own fixed distance, not just "because it made the cut."
const RECOMMENDED_RADIUS_KM = 50;
// Never trust an arbitrary client-supplied radius — only these three values
// are ever accepted; anything else is a 400, not a silent clamp.
const ALLOWED_RADIUS_KM = [25, 50, 100] as const;
const DEFAULT_RADIUS_KM = 25;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const latParam = request.nextUrl.searchParams.get("lat");
  const lngParam = request.nextUrl.searchParams.get("lng");
  const lat = latParam !== null ? Number(latParam) : NaN;
  const lng = lngParam !== null ? Number(lngParam) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, message: "lat and lng are required." }, { status: 400 });
  }

  const radiusParam = request.nextUrl.searchParams.get("radiusKm");
  let radiusKm: number = DEFAULT_RADIUS_KM;
  if (radiusParam !== null) {
    const parsed = Number(radiusParam);
    if (!ALLOWED_RADIUS_KM.includes(parsed as (typeof ALLOWED_RADIUS_KM)[number])) {
      return NextResponse.json(
        { success: false, message: `radiusKm must be one of ${ALLOWED_RADIUS_KM.join(", ")}.` },
        { status: 400 }
      );
    }
    radiusKm = parsed;
  }

  // Gyms with no coordinates yet (a self-serve signup whose address hasn't
  // been geocoded) simply can't be distance-sorted — excluded rather than
  // erroring, same "quietly incomplete, not broken" stance as everywhere
  // else nullable data is handled in this codebase. acceptingNewEnquiries is
  // the gym's own voluntary availability (lib/gyms-schema.ts) — deliberately
  // separate from `status` (S&C's admin moderation of the listing itself);
  // undefined/absent reads as visible, only an explicit `false` excludes.
  const results = findGyms()
    .filter(
      (g) =>
        g.status === "active" &&
        g.latitude !== null &&
        g.longitude !== null &&
        g.acceptingNewEnquiries !== false
    )
    .map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      tagline: g.tagline,
      contactEmail: g.contactEmail,
      contactPhone: g.contactPhone,
      addressLine: g.addressLine,
      distanceKm: haversineKm(lat, lng, g.latitude!, g.longitude!),
      recommended: false,
    }))
    .filter((g) => g.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const primary = results.find((g) => g.slug === PRIMARY_GYM_SLUG);
  if (primary && primary.distanceKm <= RECOMMENDED_RADIUS_KM) {
    primary.recommended = true;
    results.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.distanceKm - b.distanceKm);
  }

  return NextResponse.json({ success: true, data: results });
}
