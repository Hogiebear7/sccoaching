import webpush from "web-push";

import {
  deleteExpoPushTokenByToken,
  deletePushSubscriptionByEndpoint,
  findExpoPushTokensByUserId,
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

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface ExpoPushTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

// Sends to every Expo (native app) token registered for a user in one
// batched request. Unlike web push, Expo's push API needs no server-side
// keys — sending only requires the recipient's token. Tokens Expo reports
// as no longer valid (DeviceNotRegistered — uninstalled app, etc.) are
// deleted automatically.
async function sendExpoPush(userId: string, payload: PushPayload): Promise<void> {
  const tokens = findExpoPushTokensByUserId(userId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: { linkHref: payload.linkHref },
  }));

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
      // Unbounded before this: a single stalled request here had nothing to
      // cut it off, and since sendPush is called sequentially per user
      // across several housekeeping jobs, one hang could block the entire
      // cron run past its own external timeout.
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;
    const tickets = json?.data ?? [];

    tickets.forEach((ticket, i) => {
      const token = tokens[i]?.token;
      if (!token) return;
      if (ticket.status === "ok") {
        console.log(`[push] sent (expo): ...${token.slice(-12)} → "${payload.title}"`);
      } else if (ticket.details?.error === "DeviceNotRegistered") {
        deleteExpoPushTokenByToken(token);
        console.log(`[push] expo token expired, removed: ...${token.slice(-12)}`);
      } else {
        console.error(`[push] expo send failed: ...${token.slice(-12)}`, ticket.message ?? ticket);
      }
    });
  } catch (err) {
    console.error(`[push] expo request failed for user ${userId}`, err);
  }
}

// Sends a push notification to every registered device for a user, across
// both channels (web push + native Expo push). Never throws — per-channel
// and per-subscription failures are logged and swallowed so push can never
// block the calling flow. Expired web-push subscriptions (HTTP 410/404) are
// deleted automatically.
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (process.env.PUSH_ENABLED === "false") {
    console.log(`[push] disabled (PUSH_ENABLED=false): "${payload.title}" → ${userId}`);
    return;
  }

  await sendExpoPush(userId, payload);

  if (!configured) {
    console.log(`[push] web push not configured, skipping: "${payload.title}" → ${userId}`);
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
        data,
        { timeout: 10_000 }
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
