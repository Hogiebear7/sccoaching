import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DELETE_CONFIRM_WORD, GOOGLE_PLAY_ACTIVE_MESSAGE, selfDeletionBlock } from "@/lib/account-deletion";
import { deleteUserAndOwnedRecords, findSubscriptionByUserId, findUserById } from "@/lib/db";
import { ACTIVE_SUBSCRIPTION_CODE, MemberDeletionRefused } from "@/lib/member-deletion-guard";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyRequestSession } from "@/lib/mobile-auth";

// A member permanently deletes THEIR OWN account (web cookie or mobile Bearer). Required by the app stores' account-deletion policies.
// The account comes from the session and nowhere else: a user id in the body is never read. Re-authentication (the current password) and a typed
// confirmation word are both required, so a stolen or left-open session cannot delete an account by a single request.
//
// Wrong-password answers use 403, not 401: the mobile client treats 401 as "session expired" and signs the member out, which is the wrong reaction
// to a mistyped password.
//
// What is removed is decided by deleteUserAndOwnedRecords (lib/db.ts), shared with the staff hard delete: every member-owned record is deleted, Google Play
// purchase records are anonymised, and the whole thing is refused while a Google Play entitlement is still running. Financial records the gym must keep
// remain, identified only by an id that no longer resolves to anyone. Nothing here cancels, refunds or contacts a payment provider.
const DELETE_RATE_LIMIT = 5;
const DELETE_RATE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  // verifyRequestSession already treats an archived or deleted account exactly like no session.
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in to delete your account." }, { status: 401 });
  }

  const rate = checkRateLimit(`delete-account:${user.id}`, DELETE_RATE_LIMIT, DELETE_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, code: "rate_limited", message: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { password, confirm } = (body ?? {}) as Record<string, unknown>;

  if (typeof password !== "string" || !password) {
    return NextResponse.json({ success: false, code: "password_required", message: "Enter your password to confirm." }, { status: 400 });
  }
  if (confirm !== DELETE_CONFIRM_WORD) {
    return NextResponse.json({ success: false, code: "confirmation_required", message: `Type ${DELETE_CONFIRM_WORD} to confirm.` }, { status: 400 });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ success: false, code: "invalid_password", message: "That password is not correct." }, { status: 403 });
  }

  const block = selfDeletionBlock(user.role, findSubscriptionByUserId(user.id));
  if (block) return NextResponse.json({ success: false, code: block.code, message: block.message }, { status: block.status });

  try {
    deleteUserAndOwnedRecords(user.id);
  } catch (error) {
    if (error instanceof MemberDeletionRefused) {
      return NextResponse.json({ success: false, code: ACTIVE_SUBSCRIPTION_CODE, message: GOOGLE_PLAY_ACTIVE_MESSAGE }, { status: 409 });
    }
    throw error;
  }

  const response = NextResponse.json({ success: true, message: "Your account and its data have been deleted." }, { status: 200 });
  response.cookies.delete("session");
  return response;
}
