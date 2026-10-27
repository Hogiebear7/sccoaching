import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { appendIapEvent, findSubscriptionByUserId, findUserById, updateSubscription } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { pauseProviderSubscription, resumeProviderSubscription } from "@/lib/billing";

const DURATION_DAYS: Record<string, number> = {
  "2w": 14,
  "1m": 30,
  "6m": 182,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);
  if (!staffUser || !can(staffUser.role, "members.billing")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage memberships." },
      { status: 403 }
    );
  }

  const { userId } = await params;
  const member = findUserById(userId);
  if (!member || !sameGym(staffUser, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { action, duration } = (body ?? {}) as Record<string, unknown>;
  const subscription = findSubscriptionByUserId(member.id);

  if (!subscription) {
    return NextResponse.json(
      { success: false, message: "This member has no membership to pause." },
      { status: 404 }
    );
  }

  // A Google Play subscription is paused, resumed and cancelled by the member inside Google Play, and its status here mirrors
  // Play's. A staff pause or resume would write a status that contradicts the store (for example "active" while Play still has it
  // paused, or "paused" while Play keeps billing) and could not be undone from this side. Refused with a stable code; the row,
  // purchase token, provider and paid-through date are not touched, and nothing is sent to Google.
  if ((action === "pause" || action === "resume") && subscription.provider === "google_play") {
    appendIapEvent({ type: "staff_write_rejected", userId: member.id, actor: "staff", detail: { code: "play_billing_active", action, source: "staff_pause_resume" } });
    return NextResponse.json(
      {
        success: false,
        code: "play_billing_active",
        message: "This membership is billed through Google Play. The member pauses, resumes or cancels it in Google Play, so it can't be changed here.",
      },
      { status: 409 }
    );
  }

  if (action === "pause") {
    if (typeof duration !== "string" || !(duration in DURATION_DAYS)) {
      return NextResponse.json(
        { success: false, message: "Duration must be one of 2w, 1m, 6m." },
        { status: 400 }
      );
    }
    if (subscription.status === "paused") {
      return NextResponse.json(
        { success: false, message: "This membership is already paused." },
        { status: 409 }
      );
    }
    if (subscription.status !== "active" && subscription.status !== "past_due") {
      return NextResponse.json(
        { success: false, message: "Only an active or past-due membership can be paused." },
        { status: 409 }
      );
    }

    const now = new Date();
    const resumesAt = new Date(now.getTime() + DURATION_DAYS[duration] * 24 * 60 * 60 * 1000);

    let providerWarning: string | null = null;
    if (subscription.provider === "stripe" && subscription.providerSubscriptionId) {
      const result = await pauseProviderSubscription({
        provider: "stripe",
        providerSubscriptionId: subscription.providerSubscriptionId,
        resumesAtUnixSeconds: Math.floor(resumesAt.getTime() / 1000),
      });
      if (!result.ok) {
        providerWarning = `Membership paused locally, but Stripe billing could not be paused automatically (${result.message ?? "unknown error"}). Pause it manually in the Stripe dashboard so the member isn't charged.`;
      }
    }

    // The Stripe call above can take a while: apply the change to the row as it is NOW (a webhook may have updated it meanwhile), and only if it can still be paused.
    let changedMeanwhile = false;
    updateSubscription(subscription.userId, (current) => {
      if (current.status !== "active" && current.status !== "past_due") {
        changedMeanwhile = true;
        return null;
      }
      return { status: "paused", statusBeforePause: current.status, pausedUntil: resumesAt.toISOString(), updatedAt: now.toISOString() };
    });
    if (changedMeanwhile) {
      return NextResponse.json(
        {
          success: false,
          message: providerWarning
            ? `The membership changed while it was being paused, so nothing was saved here. ${providerWarning}`
            : "The membership changed while it was being paused, so nothing was saved here. Check its status and try again. If it uses Stripe billing, check the subscription there.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: providerWarning ?? `Membership paused until ${resumesAt.toLocaleDateString("en-GB")}.`,
        warning: providerWarning,
      },
      { status: 200 }
    );
  }

  if (action === "resume") {
    if (subscription.status !== "paused") {
      return NextResponse.json(
        { success: false, message: "This membership is not currently paused." },
        { status: 409 }
      );
    }

    let providerWarning: string | null = null;
    if (subscription.provider === "stripe" && subscription.providerSubscriptionId) {
      const result = await resumeProviderSubscription({
        provider: "stripe",
        providerSubscriptionId: subscription.providerSubscriptionId,
      });
      if (!result.ok) {
        providerWarning = `Membership resumed locally, but Stripe billing could not be resumed automatically (${result.message ?? "unknown error"}). Check the subscription in the Stripe dashboard.`;
      }
    }

    let resumeChangedMeanwhile = false;
    updateSubscription(subscription.userId, (current) => {
      if (current.status !== "paused") {
        resumeChangedMeanwhile = true;
        return null;
      }
      return { status: current.statusBeforePause ?? "active", statusBeforePause: null, pausedUntil: null, updatedAt: new Date().toISOString() };
    });
    if (resumeChangedMeanwhile) {
      return NextResponse.json(
        { success: false, message: "The membership changed while it was being resumed, so nothing was saved here. Check its status and try again." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: true, message: providerWarning ?? "Membership resumed.", warning: providerWarning },
      { status: 200 }
    );
  }

  return NextResponse.json(
    { success: false, message: "action must be 'pause' or 'resume'." },
    { status: 400 }
  );
}
