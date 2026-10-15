// App Store test fixture: the real datastore fixture plus a FakeAppStoreAdapter installed behind the real service, with the App
// Store kill switch ON for the test environment. Real route handlers, real datastore file, real signature and certificate-chain
// verification (against a GENERATED test root, never Apple's), and a fake only for "read this subscription's state from Apple".
//
// Every certificate and key here was created by __tests__/fixtures/app-store/gen.sh. Nothing is Apple's. No network.
// Call createAppStoreFixture() in beforeEach and fx.cleanup() in afterEach; import routes and services AFTER it.
import { createSign, randomUUID, sign, createPrivateKey, X509Certificate } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";

import type { AdapterFailure, ProviderErrorCode } from "@/lib/iap/adapter";
import { isRetryableProviderError } from "@/lib/iap/adapter";
import type { AppStoreAdapter } from "@/lib/iap/apple-adapter";
import type { AppleRenewalInfoPayload, AppleTransactionPayload, AppStoreStatusResult } from "@/lib/providers/app-store";
import { verifyAppleJws } from "@/lib/providers/app-store-jws";

import { createFixture, type IapFixture } from "./iap-fixture";

void createSign;

const DIR = path.join(process.cwd(), "__tests__", "fixtures", "app-store");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const der = (pemName: string) => new X509Certificate(read(pemName)).raw.toString("base64");

export type ChainName = "good" | "rogue" | "nomarker";
const CHAINS: Record<ChainName, { x5c: string[]; key: string }> = {
  good: { x5c: [der("good-leaf.pem"), der("good-int.pem"), der("good-root.pem")], key: read("good-leaf.key") },
  rogue: { x5c: [der("rogue-leaf.pem"), der("rogue-int.pem"), der("rogue-root.pem")], key: read("rogue-leaf.key") },
  nomarker: { x5c: [der("nomarker-leaf.pem"), der("nomarker-int.pem"), der("nomarker-root.pem")], key: read("nomarker-leaf.key") },
};
export const GOOD_ROOT_PEM = read("good-root.pem");
export const NOMARKER_ROOT_PEM = read("nomarker-root.pem");

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Builds an Apple-style JWS (ES256, x5c = leaf, intermediate, root) from a test chain. */
export function signJws(payload: object, chain: ChainName = "good", headerOver: Record<string, unknown> = {}): string {
  const header = b64url(JSON.stringify({ alg: "ES256", x5c: CHAINS[chain].x5c, ...headerOver }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), { key: createPrivateKey(CHAINS[chain].key), dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${b64url(signature)}`;
}

export const BUNDLE_ID = "com.example.fake.app";
export const APPLE_PRODUCT_ID = "com.example.fake.digital.monthly";
export const WEBHOOK_URL = "http://localhost/api/webhooks/app-store";

const DAY = 86_400_000;

export function fakeTransaction(over: Partial<AppleTransactionPayload> = {}): AppleTransactionPayload {
  return {
    transactionId: `tx-${randomUUID()}`,
    originalTransactionId: "otx-default",
    bundleId: BUNDLE_ID,
    productId: APPLE_PRODUCT_ID,
    type: "Auto-Renewable Subscription",
    purchaseDate: Date.now() - DAY,
    originalPurchaseDate: Date.now() - DAY,
    expiresDate: Date.now() + 29 * DAY,
    inAppOwnershipType: "PURCHASED",
    signedDate: Date.now(),
    environment: "Production",
    ...over,
  };
}

export interface LiveState {
  /** Apple's subscription status: 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked. */
  status: number;
  transaction: AppleTransactionPayload;
  renewal: AppleRenewalInfoPayload | null;
  environment: "production" | "sandbox";
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

export class FakeAppStoreAdapter implements AppStoreAdapter {
  readonly name = "fake";
  configured = true;
  bundleId: string | null = BUNDLE_ID;
  roots: string[] = [GOOD_ROOT_PEM];

  private states = new Map<string, LiveState>();
  private failures: ProviderErrorCode[] = [];
  private nextGate: Gate | null = null;
  readonly fetchCalls: string[] = [];

  isConfigured() {
    return this.configured;
  }
  expectedBundleId() {
    return this.bundleId;
  }
  verifySigned<T>(jws: unknown) {
    return verifyAppleJws<T>(jws, { roots: this.roots });
  }

  /** Sets (or merges into) Apple's current state for one subscription. */
  setLive(originalTransactionId: string, over: Partial<LiveState> & { tx?: Partial<AppleTransactionPayload> } = {}): LiveState {
    const prev = this.states.get(originalTransactionId);
    const { tx, ...rest } = over;
    const base: LiveState = prev ?? { status: 1, environment: "production", renewal: { originalTransactionId, autoRenewStatus: 1 }, transaction: fakeTransaction({ originalTransactionId }) };
    const next: LiveState = { ...base, ...rest };
    next.transaction = { ...next.transaction, originalTransactionId, ...(tx ?? {}) };
    this.states.set(originalTransactionId, next);
    return next;
  }

  failFetch(code: ProviderErrorCode, times = 1) {
    for (let i = 0; i < times; i++) this.failures.push(code);
  }

  gateNextFetch(): { release: () => void } {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextGate = { promise, release };
    return { release };
  }

  async fetchStatus(originalTransactionId: string, environment: "production" | "sandbox"): Promise<{ ok: true; result: AppStoreStatusResult } | AdapterFailure> {
    this.fetchCalls.push(originalTransactionId);
    const failure = this.failures.shift();
    if (failure) return { ok: false, code: failure, retryable: isRetryableProviderError(failure) };
    const captured = this.states.get(originalTransactionId);
    const gate = this.nextGate;
    this.nextGate = null;
    if (gate) await gate.promise;
    if (!captured || captured.environment !== environment) return { ok: false, code: "not_found", retryable: false };
    return {
      ok: true,
      result: { environment: captured.environment, status: captured.status, transaction: { ...captured.transaction }, renewal: captured.renewal ? { ...captured.renewal } : null },
    };
  }
}

export interface AppStoreFixture extends IapFixture {
  adapter: FakeAppStoreAdapter;
  /** The appAccountToken the client would set for this user (real HMAC from SESSION_SECRET in vitest.config.ts). */
  tokenFor: (userId: string) => string;
  /** POST /api/mobile/billing/app-store/verify as this user, with a transaction signed by the (good) test chain. */
  verify: (userId: string | undefined, body: unknown, rawBody?: string) => Promise<Response>;
  context: (userId: string | undefined) => Promise<Response>;
  catalog: (userId: string | undefined) => Promise<Response>;
  /** POST /api/webhooks/app-store with a notification signed by a test chain. */
  notify: (
    type: string,
    originalTransactionId: string,
    opts?: { subtype?: string; uuid?: string; chain?: ChainName; tx?: Partial<AppleTransactionPayload>; environment?: string; bundleId?: string; rawSignedPayload?: string }
  ) => Promise<Response>;
  /** Programs Apple's live state for this subscription bound to `userId`'s account token, then claims it through the real verify route. */
  claim: (userId: string, originalTransactionId: string, over?: Parameters<FakeAppStoreAdapter["setLive"]>[1] & { signedTx?: Partial<AppleTransactionPayload> }) => Promise<Response>;
  signedTransaction: (userId: string | null, originalTransactionId: string, over?: Partial<AppleTransactionPayload>, chain?: ChainName) => string;
}

const ENV_KEYS = ["APP_STORE_IAP_ENABLED", "APP_STORE_IAP_ENVIRONMENT", "APP_STORE_ACCEPT_SANDBOX"] as const;

export async function createAppStoreFixture(options: { enabled?: boolean; acceptSandbox?: boolean } = {}): Promise<AppStoreFixture> {
  const base = await createFixture();
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  if (options.enabled !== false) {
    process.env.APP_STORE_IAP_ENABLED = "true";
    process.env.APP_STORE_IAP_ENVIRONMENT = "test";
  } else {
    delete process.env.APP_STORE_IAP_ENABLED;
    delete process.env.APP_STORE_IAP_ENVIRONMENT;
  }
  if (options.acceptSandbox) process.env.APP_STORE_ACCEPT_SANDBOX = "true";
  else delete process.env.APP_STORE_ACCEPT_SANDBOX;

  // The seeded app option maps to the fake App Store product.
  base.db.saveMembershipBillingOption({ ...base.db.findMembershipBillingOptionById(base.ids.appOption)!, appStoreProductId: APPLE_PRODUCT_ID });

  const { setAppStoreAdapterForTesting } = await import("@/lib/iap/apple-adapter");
  const { appStoreAccountToken } = await import("@/lib/providers/app-store");
  const { MEMBER_SESSION_LIFETIME_MS, signSession } = await import("@/lib/session");

  const adapter = new FakeAppStoreAdapter();
  setAppStoreAdapterForTesting(adapter);

  const tokenFor = (userId: string) => appStoreAccountToken(userId)!;
  const cookieHeader = (userId?: string): Record<string, string> => (userId ? { Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` } : {});

  const signedTransaction: AppStoreFixture["signedTransaction"] = (userId, originalTransactionId, over = {}, chain = "good") =>
    signJws({ ...fakeTransaction({ originalTransactionId, ...(userId ? { appAccountToken: tokenFor(userId) } : {}), ...over }) }, chain);

  const verify: AppStoreFixture["verify"] = async (userId, body, rawBody) => {
    const { POST } = await import("@/app/api/mobile/billing/app-store/verify/route");
    return POST(
      new NextRequest("http://localhost/api/mobile/billing/app-store/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(userId) },
        body: rawBody ?? JSON.stringify(body),
      })
    );
  };

  const context: AppStoreFixture["context"] = async (userId) => {
    const { GET } = await import("@/app/api/mobile/billing/app-store/purchase-context/route");
    return GET(new NextRequest("http://localhost/api/mobile/billing/app-store/purchase-context", { headers: cookieHeader(userId) }));
  };

  const catalog: AppStoreFixture["catalog"] = async (userId) => {
    const { GET } = await import("@/app/api/mobile/billing/catalog/route");
    return GET(new NextRequest("http://localhost/api/mobile/billing/catalog", { headers: cookieHeader(userId) }));
  };

  const notify: AppStoreFixture["notify"] = async (type, originalTransactionId, opts = {}) => {
    const { POST } = await import("@/app/api/webhooks/app-store/route");
    const tx = fakeTransaction({ originalTransactionId, ...(opts.tx ?? {}) });
    const payload = {
      notificationType: type,
      subtype: opts.subtype,
      notificationUUID: opts.uuid ?? randomUUID(),
      signedDate: Date.now(),
      data: {
        environment: opts.environment ?? "Production",
        bundleId: opts.bundleId ?? BUNDLE_ID,
        signedTransactionInfo: signJws(tx as Record<string, unknown>, opts.chain ?? "good"),
      },
    };
    const signedPayload = opts.rawSignedPayload ?? signJws(payload, opts.chain ?? "good");
    return POST(new NextRequest(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedPayload }) }));
  };

  const claim: AppStoreFixture["claim"] = async (userId, originalTransactionId, over = {}) => {
    const { signedTx, ...liveOver } = over;
    adapter.setLive(originalTransactionId, { ...liveOver, tx: { appAccountToken: tokenFor(userId), ...(liveOver.tx ?? {}) } });
    return verify(userId, { signedTransaction: signedTransaction(userId, originalTransactionId, signedTx) });
  };

  return {
    ...base,
    adapter,
    tokenFor,
    verify,
    context,
    catalog,
    notify,
    claim,
    signedTransaction,
    cleanup: () => {
      setAppStoreAdapterForTesting(null);
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      base.cleanup();
    },
  };
}
