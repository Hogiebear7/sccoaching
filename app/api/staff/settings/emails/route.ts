import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  getTransactionalEmailSettings,
  saveTransactionalEmailSettings,
  TRANSACTIONAL_EMAIL_TYPES,
  type TransactionalEmailType,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Staff toggle for a single optional transactional email type. Guarded by the
// operations capability (admin+). Billing/account-critical emails are not
// represented here, so they can never be switched off through this surface.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || !can(user.role, "operations.view")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage email settings." },
      { status: user ? 403 : 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { type, enabled } = (body ?? {}) as Record<string, unknown>;

  if (typeof type !== "string" || !TRANSACTIONAL_EMAIL_TYPES.includes(type as TransactionalEmailType)) {
    return NextResponse.json({ success: false, message: "Unknown email type." }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ success: false, message: "enabled must be a boolean." }, { status: 400 });
  }

  const settings = getTransactionalEmailSettings();
  const next = { ...settings, [type as TransactionalEmailType]: enabled };
  saveTransactionalEmailSettings(next);

  return NextResponse.json(
    { success: true, message: enabled ? "Email enabled." : "Email disabled.", settings: next },
    { status: 200 }
  );
}
