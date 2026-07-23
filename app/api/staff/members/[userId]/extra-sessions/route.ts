import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
} from "@/lib/db";
import { remainingSessions } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

// Deliberate cap — extra passes are goodwill/correction credits, not a way
// to hand out a second allowance. Larger entitlements belong on the plan.
const MAX_GRANT_AMOUNT = 20;
const MAX_NOTE_LENGTH = 200;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  if (staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can add extra classes." },
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { amount, note } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > MAX_GRANT_AMOUNT
  ) {
    return NextResponse.json(
      {
        success: false,
        message: `Amount must be a whole number between 1 and ${MAX_GRANT_AMOUNT}.`,
      },
      { status: 400 }
    );
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";

  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { success: false, message: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const subscription = findSubscriptionByUserId(member.id);
  const plan = resolveSubscriptionEntitlement(subscription);

  if (!subscription || !plan) {
    return NextResponse.json(
      { success: false, message: "This member has no membership plan to add classes to." },
      { status: 400 }
    );
  }

  if (plan.monthlySessionAllowance === null) {
    return NextResponse.json(
      {
        success: false,
        message: "This member's plan already has unlimited classes — no extra passes needed.",
      },
      { status: 400 }
    );
  }

  const updated = {
    ...subscription,
    extraSessionGrants: [
      ...subscription.extraSessionGrants,
      {
        id: randomUUID(),
        amount,
        note: trimmedNote ? trimmedNote : null,
        grantedByUserId: staffUser.id,
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  saveSubscription(updated);

  const remaining = remainingSessions(plan, updated);

  return NextResponse.json(
    {
      success: true,
      message: `Added ${amount} extra class${amount === 1 ? "" : "es"} this period.`,
      remainingSessions: remaining,
    },
    { status: 200 }
  );
}
