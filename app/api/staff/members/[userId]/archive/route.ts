import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, setUserArchived } from "@/lib/db";
import { verifySession } from "@/lib/session";

// Archive / restore a member account. Archiving blocks sign-in and hides the
// account from the default staff list; every record (bookings, purchases,
// pass ledger, attendance) is kept so history stays auditable. There is
// deliberately no hard delete.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  if (staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage members." },
      { status: 403 }
    );
  }

  const { userId } = await params;
  const member = findUserById(userId);

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  if (member.role !== "member") {
    return NextResponse.json(
      { success: false, message: "Only member accounts can be archived." },
      { status: 400 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { archived } = (body ?? {}) as Record<string, unknown>;

  if (typeof archived !== "boolean") {
    return NextResponse.json(
      { success: false, message: "archived must be true or false." },
      { status: 400 }
    );
  }

  setUserArchived(member.id, archived);

  return NextResponse.json(
    {
      success: true,
      message: archived
        ? `${member.email} archived — they can no longer sign in. All history is kept.`
        : `${member.email} restored — they can sign in again.`,
    },
    { status: 200 }
  );
}
