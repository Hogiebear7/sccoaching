// App Store (StoreKit 2) provider: configuration, the account binding, and the App Store Server API client.
//
// The member buys the subscription natively through the App Store (react-native / StoreKit 2 in the mobile app); this
// file's job is only to take what the client hands back and ask Apple directly "is this real, and what does it entitle".
// Nothing the client claims about its own purchase is trusted: the signed transaction is verified against Apple's pinned
// root (./app-store-jws) and its subscription state is then read from the App Store Server API.
//
// No SDK dependency, same convention as ./google-play: raw fetch against the documented REST API, and an ES256 JWT built
// with Node crypto for authentication.
//
// Configuration (all read at call time; none has a default that points at a real account):
//   APP_STORE_BUNDLE_ID                 the iOS bundle identifier this deployment serves
//   APP_STORE_ISSUER_ID                 App Store Connect API issuer id
//   APP_STORE_KEY_ID                    the In-App Purchase key id
//   APP_STORE_PRIVATE_KEY_BASE64        the In-App Purchase key (.p8 file contents), base64 encoded
//   APP_STORE_ROOT_CERTIFICATES_BASE64  Apple root certificate(s), PEM, base64 encoded (downloaded from Apple's PKI page)

import { createHmac, createPrivateKey, sign, timingSafeEqual } from "crypto";

import { getConfiguredSessionSecret } from "@/lib/app-config";

import { parsePemBundle, verifyAppleJws, type JwsResult } from "./app-store-jws";

export const APP_STORE_REQUEST_TIMEOUT_MS = 10_000;

// Closed set of failure codes. Apple's own message text is never returned to a caller.
export type AppStoreErrorCode =
  | "not_configured"
  | "timeout"
  | "network"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "server_error"
  | "invalid_response";

export function appStoreErrorCodeForStatus(status: number): AppStoreErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

const API_HOST: Record<"production" | "sandbox", string> = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
};

export function configuredBundleId(): string | null {
  return process.env.APP_STORE_BUNDLE_ID?.trim() || null;
}

function privateKeyPem(): string | null {
  const b64 = process.env.APP_STORE_PRIVATE_KEY_BASE64?.trim();
  if (!b64) return null;
  try {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    return pem.includes("PRIVATE KEY") ? pem : null;
  } catch {
    return null;
  }
}

export function configuredRootCertificatesPem(): string | null {
  const b64 = process.env.APP_STORE_ROOT_CERTIFICATES_BASE64?.trim();
  if (!b64) return null;
  try {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    return parsePemBundle(pem).length > 0 ? pem : null;
  } catch {
    return null;
  }
}

export function isAppStoreConfigured(): boolean {
  return (
    configuredBundleId() !== null &&
    !!process.env.APP_STORE_ISSUER_ID?.trim() &&
    !!process.env.APP_STORE_KEY_ID?.trim() &&
    privateKeyPem() !== null &&
    configuredRootCertificatesPem() !== null
  );
}

// ── The account binding ───────────────────────────────────────────────────────────────────────

const ACCOUNT_TOKEN_DOMAIN = "sandc-app-store-account-token-v1:";

/**
 * The appAccountToken the mobile client must set on a purchase (StoreKit 2's Product.PurchaseOption.appAccountToken). It is a
 * UUID derived from the account id by a server-side secret, so it identifies the account to us and to nobody else: it cannot
 * be computed for another account, and it reveals nothing about this one. Null when the secret is not configured, which the
 * caller treats as "binding unavailable": never fall back to an unbound purchase.
 */
export function appStoreAccountToken(userId: string): string | null {
  const secret = getConfiguredSessionSecret();
  if (!secret) return null;
  const bytes = createHmac("sha256", secret).update(`${ACCOUNT_TOKEN_DOMAIN}${userId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4 shape
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Constant-time, case-insensitive (Apple returns the UUID lower-case; a client may send either). A missing or different
// value is simply "not a match", never worth distinguishing to the caller.
export function appStoreAccountBindingMatches(expected: string | null, providerValue: string | null | undefined): boolean {
  if (!expected || !providerValue) return false;
  const a = Buffer.from(expected.toLowerCase(), "utf8");
  const b = Buffer.from(providerValue.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Decoded payloads (the fields this app reads; Apple sends more) ─────────────────────────────

export type AppleEnvironment = "Production" | "Sandbox" | "Xcode" | "LocalTesting";

export interface AppleTransactionPayload {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  type?: string;
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  appAccountToken?: string;
  inAppOwnershipType?: string;
  signedDate?: number;
  environment?: AppleEnvironment | string;
  revocationDate?: number;
  revocationReason?: number;
  storefront?: string;
}

export interface AppleRenewalInfoPayload {
  originalTransactionId?: string;
  autoRenewProductId?: string;
  /** 1 = will renew, 0 = auto-renew turned off. */
  autoRenewStatus?: number;
  isInBillingRetryPeriod?: boolean;
  gracePeriodExpiresDate?: number;
  expirationIntent?: number;
  signedDate?: number;
  environment?: AppleEnvironment | string;
}

export interface AppleNotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  signedDate?: number;
  data?: {
    environment?: AppleEnvironment | string;
    bundleId?: string;
    appAppleId?: number;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
  };
}

export function verifyWithConfiguredRoots<T>(jws: unknown): JwsResult<T> {
  const roots = configuredRootCertificatesPem();
  return verifyAppleJws<T>(jws, { roots: roots ? [roots] : [] });
}

// ── App Store Server API ──────────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// A short-lived ES256 JWT, signed with the In-App Purchase key. Built per request: no module-level cache to go stale.
function buildApiJwt(): string | null {
  const pem = privateKeyPem();
  const keyId = process.env.APP_STORE_KEY_ID?.trim();
  const issuer = process.env.APP_STORE_ISSUER_ID?.trim();
  const bundleId = configuredBundleId();
  if (!pem || !keyId || !issuer || !bundleId) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const body = base64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1", bid: bundleId }));
  try {
    const signature = sign("sha256", Buffer.from(`${header}.${body}`), { key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
    return `${header}.${body}.${base64url(signature)}`;
  } catch {
    return null;
  }
}

export interface AppStoreStatusResult {
  environment: "production" | "sandbox";
  /** Apple's subscription status: 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked. */
  status: number;
  transaction: AppleTransactionPayload;
  renewal: AppleRenewalInfoPayload | null;
}

// Reads the current state of one subscription from the App Store Server API ("Get All Subscription Statuses"). Both signed
// payloads in the response are verified against the pinned roots before anything is read from them.
export async function fetchAppStoreSubscriptionStatus(
  originalTransactionId: string,
  environment: "production" | "sandbox"
): Promise<{ ok: true; result: AppStoreStatusResult } | { ok: false; code: AppStoreErrorCode }> {
  const jwt = buildApiJwt();
  if (!jwt || !configuredRootCertificatesPem()) return { ok: false, code: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APP_STORE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_HOST[environment]}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    return { ok: false, code: (error as { name?: string })?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { ok: false, code: appStoreErrorCodeForStatus(response.status) };

  let body: { data?: { lastTransactions?: { status?: number; originalTransactionId?: string; signedTransactionInfo?: string; signedRenewalInfo?: string }[] }[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, code: "invalid_response" };
  }

  for (const group of body.data ?? []) {
    for (const last of group.lastTransactions ?? []) {
      if (last.originalTransactionId !== originalTransactionId || typeof last.status !== "number") continue;
      const tx = verifyWithConfiguredRoots<AppleTransactionPayload>(last.signedTransactionInfo);
      if (!tx.ok || tx.payload.originalTransactionId !== originalTransactionId) return { ok: false, code: "invalid_response" };
      let renewal: AppleRenewalInfoPayload | null = null;
      if (last.signedRenewalInfo) {
        const verified = verifyWithConfiguredRoots<AppleRenewalInfoPayload>(last.signedRenewalInfo);
        if (!verified.ok) return { ok: false, code: "invalid_response" };
        renewal = verified.payload;
      }
      return { ok: true, result: { environment, status: last.status, transaction: tx.payload, renewal } };
    }
  }
  return { ok: false, code: "not_found" };
}
