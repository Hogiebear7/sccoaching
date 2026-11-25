import type { NextRequest } from "next/server";

import { findGymById } from "@/lib/db";
import { readGymLogo } from "@/lib/gym-logo-store";

// GET /api/gym-logo/[gymId] — a gym's uploaded logo, public because the logo is shown to that gym's members (and to people looking at its sign-up page). It serves only
// a file the gym itself uploaded through the branding route, with a fixed image type taken from the file's own bytes and no way to run anything in it.
export async function GET(_request: NextRequest, context: { params: Promise<{ gymId: string }> }) {
  const { gymId } = await context.params;
  const gym = findGymById(gymId);
  if (!gym || !gym.branding?.logoUrl?.includes("/api/gym-logo/")) return new Response("Not found", { status: 404 });
  const logo = readGymLogo(gymId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
