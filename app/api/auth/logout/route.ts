import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredAppUrl } from "@/lib/app-config";

// Built from APP_URL rather than request.url: behind some reverse proxies
// (observed on Hostinger) request.url reflects the Node process's internal
// bind address (e.g. 0.0.0.0:3000), not the public domain, which sent
// people to an unreachable address on logout.
export async function POST(request: NextRequest) {
  const base = getConfiguredAppUrl() || request.url;
  const response = NextResponse.redirect(new URL("/login", base));
  response.cookies.delete("session");
  return response;
}
