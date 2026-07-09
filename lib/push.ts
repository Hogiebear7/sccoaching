import webpush from "web-push";

import {
  deletePushSubscriptionByEndpoint,
  findPushSubscriptionsByUserId,
} from "./db";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim() || null;
const vapidEmail = process.env.VAPID_EMAIL?.trim() || null;

// Configured once at module load. web-push requires all three to send.
const configured = !!(vapidPublicKey && vapidPrivateKey && vapidEmail);

if (configured) {
  webpush.setVapidDetails(
    `mailto:${vapidEmail}`,
    vapidPublicKey!,
    vapidPrivateKey!
  );
}

export interface PushPayload {
  title: string;
  body: string;
  linkHref: string;
}

// Sends a push notification to every registered device for a user. Never
// throws — per-subscription failures are logged and swallowed so push can
// never block the calling flow. Expired subscriptions (HTTP 410/404) are
// deleted automatically.
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (process.env.PUSH_ENABLED === "false") {
    console.log(`[push] disabled (PUSH_ENABLED=false): "${payload.title}" → ${userId}`);
    return;
  }
  if (!configured) {
    console.log(`[push] ${payload.title} → ${userId}`);
    return;
  }

  const subs = findPushSubscriptionsByUserId(userId);
  if (subs.length === 0) return;

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    linkHref: payload.linkHref,
  });

  for (const sub of subs) {
    const shortEndpoint = sub.endpoint.slice(-30);
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        data
      );
      console.log(`[push] sent: ...${shortEndpoint} → "${payload.title}"`);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        deletePushSubscriptionByEndpoint(sub.userId, sub.endpoint);
        console.log(`[push] subscription expired, removed: ...${shortEndpoint}`);
      } else {
        console.error(
          `[push] send failed: ...${shortEndpoint}`,
          `statusCode=${statusCode ?? "unknown"}`,
          err
        );
      }
    }
  }
}
