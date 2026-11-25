import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, setUserHideMemberHealth } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { protectedOperatorTarget } from "@/lib/platform-operator-guard";
import { resolveStaffTenantRequest } from "@/lib/tenant-request";

// Switch members' health details on or off for one staff account (the coach brief's health cards and a member page's pregnancy and cycle sections).
// Only an admin_manager may call this, and only for a staff target in their own gym. Owner request 2026-11-16: any staff see them unless the overall
// admin blocks it.
export async function POST(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "staffUsers.manage");
  if (!auth.ok) return auth.response;
  const actor = auth.user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, hidden } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A user id is required." }, { status: 400 });
  }
  if (typeof hidden !== "boolean") {
    return NextResponse.json({ success: false, message: "hidden must be true or false." }, { status: 400 });
  }

  const target = findUserById(id.trim());
  if (!target || !sameGym(actor, target) || protectedOperatorTarget(actor, target)) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }
  if (target.role === "member") {
    return NextResponse.json({ success: false, message: "This tool manages staff accounts only." }, { status: 400 });
  }

  setUserHideMemberHealth(target.id, hidden);
  return NextResponse.json(
    { success: true, message: hidden ? "Health details are now hidden from this person." : "This person can see health details again." },
    { status: 200 }
  );
}
