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
const EXPO_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";
/** When to ask Expo what became of accepted messages: most receipts are ready within minutes, and Expo says to allow about 15. */
const EXPO_RECEIPT_CHECKS_MS = [2 * 60_000, 15 * 60_000];
/** The app's high-importance Android channel (pop-up, sound, vibration), created from build 102 (sc-coaching-mobile src/lib/push-notifications.ts). */
export const EXPO_ALERTS_CHANNEL = "alerts";

interface ExpoPushTicket {
  id?: string;
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: { code?: string; message?: string; details?: Record<string, string[]> }[];
}

// Sends to every Expo (native app) token registered for a user. Expo's push API needs no server-side keys: sending only requires the
// recipient's tokens. Tokens Expo reports as no longer valid (DeviceNotRegistered: uninstalled app, etc.) are deleted automatically.
//
// One request may only carry tokens from ONE Expo project. A member whose devices registered under different projects (an Android build
// made on one EAS account and a later one, or an iPhone build, made on another) would otherwise have the whole request refused with
// PUSH_TOO_MANY_EXPERIENCE_IDS and get nothing at all. Expo's refusal lists the tokens by project, so they are re-sent one project at a time.
async function sendExpoPush(userId: string, payload: PushPayload): Promise<void> {
  const records = findExpoPushTokensByUserId(userId);
  const tokens = records.map((t) => t.token);
  if (tokens.length === 0) return;
  const channels = new Map(records.map((t) => [t.token, t.androidChannel ?? null]));
  try {
    const first = await postExpoPush(tokens, channels, payload);
    const mixed = first.errors?.find((e) => e.code === "PUSH_TOO_MANY_EXPERIENCE_IDS");
    if (mixed?.details) {
      const groups = Object.values(mixed.details).filter((g) => Array.isArray(g) && g.length > 0);
      const grouped = new Set(groups.flat());
      const rest = tokens.filter((t) => !grouped.has(t));
      if (rest.length > 0) groups.push(rest);
      console.log(`[push] tokens for user ${userId} span ${groups.length} Expo projects; sending to each separately`);
      for (const group of groups) handleExpoTickets(group, await postExpoPush(group, channels, payload), payload, userId);
      return;
    }
    handleExpoTickets(tokens, first, payload, userId);
  } catch (err) {
    console.error(`[push] expo request failed for user ${userId}`, err);
  }
}

// High priority and sound on every message, so a notification alerts the member and gets through a phone's battery saving. An Android
// channel is named only for an install that reports having it: Android doesn't show a notification naming a channel the phone lacks.
async function postExpoPush(tokens: string[], channels: Map<string, string | null>, payload: PushPayload): Promise<ExpoPushResponse> {
  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      tokens.map((to) => {
        const channelId = channels.get(to);
        return { to, title: payload.title, body: payload.body, data: { linkHref: payload.linkHref }, priority: "high", sound: "default", ...(channelId ? { channelId } : {}) };
      })
    ),
    // Unbounded before this: a single stalled request here had nothing to
    // cut it off, and since sendPush is called sequentially per user
    // across several housekeeping jobs, one hang could block the entire
    // cron run past its own external timeout.
    signal: AbortSignal.timeout(10_000),
  });
  return ((await res.json().catch(() => null)) as ExpoPushResponse | null) ?? {};
}

function handleExpoTickets(tokens: string[], response: ExpoPushResponse, payload: PushPayload, userId: string) {
  // A refusal of the whole request (no tickets) is logged, never silently dropped.
  if (response.errors?.length) {
    console.error(`[push] expo refused the request for user ${userId}:`, response.errors.map((e) => `${e.code ?? "error"}: ${e.message ?? ""}`).join("; "));
  }
  const accepted = new Map<string, string>();
  (response.data ?? []).forEach((ticket, i) => {
    const token = tokens[i];
    if (!token) return;
    if (ticket.status === "ok") {
      console.log(`[push] sent (expo): ...${token.slice(-12)} → "${payload.title}"`);
      if (ticket.id) accepted.set(ticket.id, token);
    } else if (ticket.details?.error === "DeviceNotRegistered") {
      deleteExpoPushTokenByToken(token);
      console.log(`[push] expo token expired, removed: ...${token.slice(-12)}`);
    } else {
      console.error(`[push] expo send failed: ...${token.slice(-12)}`, ticket.message ?? ticket);
    }
  });
  if (accepted.size > 0) scheduleReceiptCheck(accepted, 0);
}

// "ok" on a ticket only means Expo accepted the message. Whether Firebase or Apple then took it (a bad key shows up here, as
// InvalidCredentials) is only in the receipt, fetched later. Best-effort and in memory: a restart in between loses that one check, nothing else.
function scheduleReceiptCheck(accepted: Map<string, string>, attempt: number) {
  const timer = setTimeout(() => void checkReceipts(accepted, attempt), EXPO_RECEIPT_CHECKS_MS[attempt]);
  timer.unref?.();
}

async function checkReceipts(accepted: Map<string, string>, attempt: number) {
  try {
    const res = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: [...accepted.keys()] }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { data?: Record<string, ExpoPushTicket> } | null;
    const waiting = new Map<string, string>();
    for (const [id, token] of accepted) {
      const receipt = json?.data?.[id];
      if (!receipt) {
        waiting.set(id, token);
      } else if (receipt.status === "ok") {
        console.log(`[push] delivered to Firebase/Apple: ...${token.slice(-12)}`);
      } else {
        if (receipt.details?.error === "DeviceNotRegistered") deleteExpoPushTokenByToken(token);
        console.error(`[push] delivery failed: ...${token.slice(-12)} ${receipt.details?.error ?? "error"}: ${receipt.message ?? ""}`);
      }
    }
    if (waiting.size === 0) return;
    if (attempt + 1 < EXPO_RECEIPT_CHECKS_MS.length) scheduleReceiptCheck(waiting, attempt + 1);
    else console.error(`[push] no delivery receipt yet for ${waiting.size} message(s)`);
  } catch (err) {
    console.error("[push] could not read delivery receipts", err);
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
