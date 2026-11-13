import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendClassRecap } from "@/lib/class-recap";
import { findClassById, findUserById } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// The coach finishes a class workout and sends the recap: a thank-you notification (and push) to everyone who was checked in, which opens their
// copy of the workout. Safe to press twice: nobody is notified twice for the same class.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in to send a recap." }, { status: 401 });
  }
  if (!can(user.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can send a class recap." }, { status: 403 });
  }

  const { classId } = await params;
  const classRecord = findClassById(classId);
  // Same ownership rule as saving the workout: a class from another gym, or one whose coach can't be resolved, is "not found".
  if (!classRecord || !classRecord.coachUserId || !sameGymAsStaff(user, classRecord.coachUserId)) {
    return NextResponse.json({ success: false, message: "This class no longer exists." }, { status: 404 });
  }

  const result = sendClassRecap(classRecord.id);
  if (!result.ok) {
    return NextResponse.json({ success: false, message: "Save the class workout first, then send the recap." }, { status: 400 });
  }

  const message =
    result.sent === 0 && result.alreadySent === 0
      ? "Nobody is checked in for this class yet, so there is no one to send the recap to."
      : result.sent === 0
        ? "Everyone who came has already had the recap."
        : `Recap sent to ${result.sent} member${result.sent === 1 ? "" : "s"}.`;
  return NextResponse.json({ success: true, message, data: { sent: result.sent, alreadySent: result.alreadySent } }, { status: 200 });
}
