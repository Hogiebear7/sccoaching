import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authenticateApiRequest, gymKeyOf } from "@/lib/gym-api-keys";
import { findProfileByUserId, findUserByEmail } from "@/lib/db";

// GET /api/v1/members?email=...: is this person a member of THIS gym? Returns their name and join date when they are. Authorised by the gym's API key. It never lists members and never says whether
// an email has an account at another gym: anyone not in this gym is simply "not found".
export async function GET(request: NextRequest) {
  const auth = authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ success: false, message: "Send ?email=someone@example.com" }, { status: 400 });
  const user = findUserByEmail(email);
  if (!user || user.archivedAt || user.role !== "member" || (user.gymId ?? null) !== gymKeyOf(auth.gym)) {
    return NextResponse.json({ success: true, data: { found: false } });
  }
  const profile = findProfileByUserId(user.id);
  return NextResponse.json({ success: true, data: { found: true, member: { id: user.id, name: profile?.fullName?.trim() || null, email: user.email, joinedAt: user.createdAt } } });
}
