import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findStaffUsers, findUserById, setUserArchived } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { protectedOperatorTarget } from "@/lib/platform-operator-guard";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Archive (deactivate) or restore an elevated user. Only an admin_manager may
// call this, and only for a target in their own gym. Archived accounts can't
// sign in; nothing else is touched.
export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "staffUsers.manage");
  if (!auth.ok) return auth.response;
  const actor = auth.user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, archived } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A user id is required." }, { status: 400 });
  }
  if (typeof archived !== "boolean") {
    return NextResponse.json({ success: false, message: "archived must be true or false." }, { status: 400 });
  }

  const target = findUserById(id.trim());
  // Cross-gym folded into the same not-found response as a missing user,
  // before the role check and any mutation — a foreign account's existence,
  // role, and gym aren't revealed.
  if (!target || !sameGym(actor, target) || protectedOperatorTarget(actor, target)) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }
  if (target.role === "member") {
    return NextResponse.json(
      { success: false, message: "This tool manages staff accounts only." },
      { status: 400 }
    );
  }

  // Safety: archiving the last ACTIVE admin_manager IN THIS GYM would lock
  // that gym out of staff management. The count is per gym (the acting
  // manager's own), so another gym's managers neither block nor permit it.
  const activeManagersInGym = findStaffUsers().filter(
    (u) => u.role === "admin_manager" && !u.archivedAt && sameGym(actor, u)
  ).length;
  if (archived && target.role === "admin_manager" && activeManagersInGym <= 1) {
    const self = target.id === actor.id;
    return NextResponse.json(
      {
        success: false,
        message: self
          ? "You are the last admin manager — you can't deactivate your own account."
          : "This is the last admin manager — add another before deactivating this one.",
      },
      { status: 409 }
    );
  }

  setUserArchived(target.id, archived);
  return NextResponse.json(
    { success: true, message: archived ? "Account deactivated." : "Account reactivated." },
    { status: 200 }
  );
}
