// Google Play test fixture: the real datastore fixture plus a FakePlayAdapter installed behind the real
// service, with the purchases kill switch ON for the test environment. Real route handlers, real
// datastore file, fake provider. Fake tokens only; nothing here touches a network.
//
// Call createPlayFixture() in beforeEach and fx.cleanup() in afterEach. It resets the module registry (the
// datastore reads DATA_DIR once at import), so import routes and services AFTER it, with dynamic import.
import { NextRequest } from "next/server";

import { createFixture, type IapFixture } from "./iap-fixture";

export const RTDN_SECRET = "test-rtdn-shared-secret";
export const APP_PACKAGE_NAME = "com.example.app";

export interface PlayFixture extends IapFixture {
  adapter: import("@/lib/iap/fake-adapter").FakePlayAdapter;
  /** The account binding the client would set for this user (real HMAC, from SESSION_SECRET in vitest.config.ts). */
  bindingFor: (userId: string) => string;
  /** POST /api/mobile/billing/google-play/verify as this user. */
  verify: (userId: string | undefined, body: unknown, rawBody?: string) => Promise<Response>;
  /** GET /api/mobile/billing/google-play/purchase-context as this user. */
  context: (userId: string | undefined) => Promise<Response>;
  /** POST /api/webhooks/google-play with a Pub/Sub envelope. */
  rtdn: (notification: Record<string, unknown>, opts?: { messageId?: string | null; token?: string | null }) => Promise<Response>;
  /** A subscriptionNotification payload for a token. */
  subscriptionEvent: (token: string, notificationType?: number) => Record<string, unknown>;
  /** A voidedPurchaseNotification payload. */
  voidedEvent: (token: string, orderId?: string | null, productType?: number) => Record<string, unknown>;
  /** Claims a token for a user through the real verify route using a correctly bound fake snapshot. */
  claim: (userId: string, token: string, over?: Partial<import("@/lib/iap/adapter").ProviderSubscriptionSnapshot>) => Promise<Response>;
}

const ENV_KEYS = ["GOOGLE_PLAY_IAP_ENABLED", "GOOGLE_PLAY_IAP_ENVIRONMENT", "GOOGLE_PLAY_RTDN_TOKEN"] as const;

export async function createPlayFixture(options: { enabled?: boolean } = {}): Promise<PlayFixture> {
  const base = await createFixture();
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  if (options.enabled !== false) {
    process.env.GOOGLE_PLAY_IAP_ENABLED = "true";
    process.env.GOOGLE_PLAY_IAP_ENVIRONMENT = "test";
  } else {
    delete process.env.GOOGLE_PLAY_IAP_ENABLED;
    delete process.env.GOOGLE_PLAY_IAP_ENVIRONMENT;
  }
  process.env.GOOGLE_PLAY_RTDN_TOKEN = RTDN_SECRET;

  const { setPlayAdapterForTesting } = await import("@/lib/iap/adapter");
  const { FakePlayAdapter } = await import("@/lib/iap/fake-adapter");
  const { googlePlayObfuscatedAccountId } = await import("@/lib/providers/google-play");
  const { MEMBER_SESSION_LIFETIME_MS, signSession } = await import("@/lib/session");

  const adapter = new FakePlayAdapter();
  adapter.packageName = APP_PACKAGE_NAME;
  setPlayAdapterForTesting(adapter);

  const bindingFor = (userId: string) => googlePlayObfuscatedAccountId(userId)!;
  const cookieHeader = (userId?: string): Record<string, string> => (userId ? { Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` } : {});

  const verify: PlayFixture["verify"] = async (userId, body, rawBody) => {
    const { POST } = await import("@/app/api/mobile/billing/google-play/verify/route");
    return POST(
      new NextRequest("http://localhost/api/mobile/billing/google-play/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(userId) },
        body: rawBody ?? JSON.stringify(body),
      })
    );
  };

  const context: PlayFixture["context"] = async (userId) => {
    const { GET } = await import("@/app/api/mobile/billing/google-play/purchase-context/route");
    return GET(new NextRequest("http://localhost/api/mobile/billing/google-play/purchase-context", { headers: cookieHeader(userId) }));
  };

  let messageCounter = 0;
  const rtdn: PlayFixture["rtdn"] = async (notification, opts = {}) => {
    const { POST } = await import("@/app/api/webhooks/google-play/route");
    const token = opts.token === undefined ? RTDN_SECRET : opts.token;
    const url = token ? `http://localhost/api/webhooks/google-play?token=${encodeURIComponent(token)}` : "http://localhost/api/webhooks/google-play";
    const messageId = opts.messageId === undefined ? `msg-${++messageCounter}` : opts.messageId;
    const message: Record<string, unknown> = { data: Buffer.from(JSON.stringify(notification)).toString("base64") };
    if (messageId !== null) message.messageId = messageId;
    return POST(new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }));
  };

  return {
    ...base,
    adapter,
    bindingFor,
    verify,
    context,
    rtdn,
    subscriptionEvent: (token, notificationType = 2) => ({
      version: "1.0",
      packageName: APP_PACKAGE_NAME,
      eventTimeMillis: String(Date.now()),
      subscriptionNotification: { version: "1.0", notificationType, purchaseToken: token, subscriptionId: "app_subscription" },
    }),
    voidedEvent: (token, orderId = null, productType = 1) => ({
      version: "1.0",
      packageName: APP_PACKAGE_NAME,
      eventTimeMillis: String(Date.now()),
      voidedPurchaseNotification: { purchaseToken: token, ...(orderId ? { orderId } : {}), productType, refundType: 1 },
    }),
    claim: async (userId, token, over = {}) => {
      adapter.setSnapshot(token, { accountBinding: bindingFor(userId), ...over });
      return verify(userId, { purchaseToken: token });
    },
    cleanup: () => {
      setPlayAdapterForTesting(null);
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      base.cleanup();
    },
  };
}
