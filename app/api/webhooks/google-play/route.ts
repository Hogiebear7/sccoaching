import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { processGooglePlayNotification } from "@/lib/iap/service";
import { parsePubSubPushEnvelope, pubSubMessageId, verifyRtdnToken } from "@/lib/providers/google-play-rtdn";

// Google Play RTDN push endpoint. Pub/Sub delivers every subscription lifecycle event here. A notification is
// only ever a "go re-check this purchase" signal: lib/iap/service.ts asks Google for the live state and never
// trusts notificationType for the state itself. The one exception is a voided-purchase notification for the
// purchase's CURRENT order, which ends access (refund or chargeback).
//
// Idempotent by Pub/Sub message id, so a redelivery or replay is processed at most once. Lifecycle processing
// deliberately ignores the purchases kill switch (docs/iap-multitenant-implementation-plan-2026-10.md I6).
//
// Response codes matter: Pub/Sub retries with backoff on anything outside 2xx. 401 for a bad or missing token. 502
// for a transient Google failure (worth retrying, bounded by MAX_NOTIFICATION_ATTEMPTS). 200 for everything this
// handler considered, including "nothing to do". No response body ever contains a purchase token or provider text.
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!verifyRtdnToken(token)) {
    return NextResponse.json({ error: "Invalid or missing token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, message: "Ignored: invalid JSON." }, { status: 200 });
  }

  const notification = parsePubSubPushEnvelope(body);
  if (!notification) {
    return NextResponse.json({ ok: true, message: "Ignored: unrecognized payload." }, { status: 200 });
  }

  // Pub/Sub always sends a message id. If one is somehow missing, key on the payload so identical redeliveries still collapse.
  const messageId =
    pubSubMessageId(body) ??
    `payload:${createHash("sha256").update(String((body as { message?: { data?: string } })?.message?.data ?? "")).digest("hex")}`;

  const voided = notification.voidedPurchaseNotification;
  const result = await processGooglePlayNotification({
    messageId,
    packageName: notification.packageName,
    testNotification: !!notification.testNotification,
    subscriptionToken: notification.subscriptionNotification?.purchaseToken ?? null,
    voided:
      voided && typeof voided.purchaseToken === "string" && voided.purchaseToken
        ? { purchaseToken: voided.purchaseToken, orderId: voided.orderId ?? null, productType: voided.productType ?? null }
        : null,
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}
