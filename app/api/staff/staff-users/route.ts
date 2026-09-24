import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createUserWithRole,
  findStaffUsers,
  findUserByEmail,
  findUserById,
  updateUserRole,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { hashPassword } from "@/lib/password";
import { ASSIGNABLE_STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { authorizeStaffRequest } from "@/lib/staff-auth";

function isAssignableRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (ASSIGNABLE_STAFF_ROLES as string[]).includes(value);
}

// Active admin_managers in the ACTING manager's own gym. The last-manager
// safety rule is per gym: a manager in one gym must not be blocked by, or
// allowed to remove, another gym's last manager.
function activeManagersInGym(actor: { gymId?: string | null }): number {
  return findStaffUsers().filter((u) => u.role === "admin_manager" && !u.archivedAt && sameGym(actor, u)).length;
}

// Create a new elevated user, or change an existing user's role. Only an
// admin_manager (staffUsers.manage) may call this, and only within their own
// gym: the target must be in the actor's gym, and a newly created account is
// always placed in the actor's gym (gymId is never read from the request).
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

  const { id, email, password, role } = (body ?? {}) as Record<string, unknown>;

  if (!isAssignableRole(role)) {
    return NextResponse.json(
      { success: false, message: "A valid role (coach, admin, admin_manager) is required." },
      { status: 400 }
    );
  }

  // ── Update an existing user's role ──────────────────────────────────
  if (typeof id === "string" && id.trim()) {
    const target = findUserById(id.trim());
    // Cross-gym folded into the same not-found response as a missing user,
    // before the role check and any mutation — a foreign account's
    // existence, role, and gym aren't revealed.
    if (!target || !sameGym(actor, target)) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }
    if (target.role === "member") {
      return NextResponse.json(
        { success: false, message: "This tool manages staff accounts only." },
        { status: 400 }
      );
    }

    // Safety: don't demote the LAST admin_manager away from admin_manager —
    // that would leave nobody able to manage staff. Covers self-demotion too.
    if (
      target.role === "admin_manager" &&
      role !== "admin_manager" &&
      activeManagersInGym(actor) <= 1
    ) {
      const self = target.id === actor.id;
      return NextResponse.json(
        {
          success: false,
          message: self
            ? "You are the last admin manager — promote another admin manager before changing your own role."
            : "This is the last admin manager — assign another admin manager first.",
        },
        { status: 409 }
      );
    }

    updateUserRole(target.id, role);
    return NextResponse.json({ success: true, message: `Role updated to ${role}.` }, { status: 200 });
  }

  // ── Create a new elevated user ──────────────────────────────────────
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { success: false, message: "A password of at least 8 characters is required." },
      { status: 400 }
    );
  }
  if (findUserByEmail(normalizedEmail)) {
    return NextResponse.json(
      { success: false, message: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const created = createUserWithRole(normalizedEmail, hashPassword(password), role, actor.gymId ?? null);
  return NextResponse.json(
    { success: true, message: `Created ${role} account for ${normalizedEmail}.`, id: created.id },
    { status: 200 }
  );
}
