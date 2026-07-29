import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countActiveUsersByRole,
  createUserWithRole,
  findUserByEmail,
  findUserById,
  updateUserRole,
} from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { ASSIGNABLE_STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { authorizeStaffRequest } from "@/lib/staff-auth";

function isAssignableRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (ASSIGNABLE_STAFF_ROLES as string[]).includes(value);
}

// Create a new elevated user, or change an existing user's role. Only an
// admin_manager (staffUsers.manage) may call this.
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
    if (!target) {
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
      countActiveUsersByRole("admin_manager") <= 1
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

  const created = createUserWithRole(normalizedEmail, hashPassword(password), role);
  return NextResponse.json(
    { success: true, message: `Created ${role} account for ${normalizedEmail}.`, id: created.id },
    { status: 200 }
  );
}
