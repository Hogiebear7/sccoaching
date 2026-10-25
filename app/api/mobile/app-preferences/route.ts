import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { AppTab } from "@/lib/profile-schema";

const TABS: AppTab[] = ["schedule", "workouts", "nutrition"];

// The phone app's per-member display preferences that should follow the
// member across devices — today, the two tabs either side of the "+".
// Self-owned only: the session user is the owner, there is no userId in the
// body. Which tabs a tier may actually show is decided by the app
// (src/lib/tab-config.ts); this only stores the member's pick.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { tabChoice: profile.tabChoice ?? null } });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { tabChoice } = (body ?? {}) as Record<string, unknown>;

  const valid =
    tabChoice === null ||
    (Array.isArray(tabChoice) &&
      tabChoice.length === 2 &&
      tabChoice[0] !== tabChoice[1] &&
      tabChoice.every((t) => TABS.includes(t as AppTab)));
  if (!valid) {
    return NextResponse.json({ success: false, message: "tabChoice must be two different tabs, or null." }, { status: 400 });
  }

  saveProfile({ ...profile, tabChoice: tabChoice as AppTab[] | null });
  return NextResponse.json({ success: true, data: { tabChoice } });
}
