import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createWaitlistEntry,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntryByClassAndUser,
  type WaitlistEntryRecord,
} from "@/lib/db";
import { hasActiveMembership, membershipIsRequired } from "@/lib/membership";
import { isClassEligibleForPlan } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to join a waitlist." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to join a waitlist." },
      { status: 401 }
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

  const { classId } = (body ?? {}) as Record<string, unknown>;

  if (typeof classId !== "string" || !classId.trim()) {
    return NextResponse.json(
      { success: false, message: "A class is required." },
      { status: 400 }
    );
  }

  const classRecord = findClassById(classId);

  if (!classRecord) {
    return NextResponse.json(
      { success: false, message: "This class no longer exists." },
      { status: 404 }
    );
  }

  const classDateTime = new Date(`${classRecord.date}T${classRecord.startTime}`);

  if (classDateTime.getTime() < Date.now()) {
    return NextResponse.json(
      { success: false, message: "This class has already started." },
      { status: 409 }
    );
  }

  if (user.role === "member") {
    if (membershipIsRequired() && !hasActiveMembership(user.id)) {
      return NextResponse.json(
        {
          success: false,
          message: "An active membership is required to join a waitlist. Select a plan on the Membership page.",
        },
        { status: 403 }
      );
    }

    const subscription = findSubscriptionByUserId(user.id);
    const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;

    if (plan && !isClassEligibleForPlan(classRecord.category, plan)) {
      return NextResponse.json(
        {
          success: false,
          message: `Your plan (${plan.name}) doesn't include access to this class type.`,
        },
        { status: 403 }
      );
    }
  }

  if (findBookingsByUserId(user.id).some((b) => b.classId === classId)) {
    return NextResponse.json(
      { success: false, message: "You're already booked into this class." },
      { status: 409 }
    );
  }

  if (findWaitlistEntryByClassAndUser(classId, user.id)) {
    return NextResponse.json(
      { success: false, message: "You're already on the waitlist for this class." },
      { status: 409 }
    );
  }

  const currentBookings = findBookingsByClassId(classId).length;

  if (currentBookings < classRecord.capacity) {
    return NextResponse.json(
      { success: false, message: "This class still has space — book it directly instead." },
      { status: 409 }
    );
  }

  const entry: WaitlistEntryRecord = {
    id: randomUUID(),
    classId,
    userId: user.id,
    createdAt: new Date().toISOString(),
  };

  createWaitlistEntry(entry);

  return NextResponse.json(
    { success: true, message: "Added to the waitlist. We'll book you automatically if a spot opens." },
    { status: 201 }
  );
}
