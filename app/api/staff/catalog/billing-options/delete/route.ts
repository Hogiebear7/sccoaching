import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteMembershipBillingOption,
  findMembershipBillingOptionById,
  findAllSubscriptions,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

// Guarded delete: blocked while a subscription still references the option
// (recurring memberships track which price they bought). Hide instead.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user || !can(user.role, "catalog.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can manage the catalog." }, { status: user ? 403 : 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A billing option is required." }, { status: 400 });
  }

  const option = findMembershipBillingOptionById(id.trim());
  if (!option) {
    return NextResponse.json({ success: false, message: "This billing option no longer exists." }, { status: 404 });
  }

  const referenced = findAllSubscriptions().filter((s) => s.billingOptionId === option.id).length;
  if (referenced > 0) {
    return NextResponse.json(
      { success: false, message: `This option is referenced by ${referenced} membership${referenced === 1 ? "" : "s"} — hide it instead of deleting.` },
      { status: 409 }
    );
  }

  deleteMembershipBillingOption(option.id);
  return NextResponse.json({ success: true, message: `${option.name} deleted.` }, { status: 200 });
}
