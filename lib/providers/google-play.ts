// Google Play Billing — Tier 2 "App Subscription" purchase verification.
// Unlike Stripe/Revolut, this app never creates the checkout: the member
// buys the subscription natively through the Play Store UI (via
// react-native-iap in the mobile app), and this file's job is only to take
// the purchase token the client hands back and ask Google directly "is this
// real, and what does it entitle" — never trust anything the client claims
// about its own purchase.
//
// No googleapis SDK dependency, by the same convention as
// lib/providers/stripe.ts and lib/providers/revolut.ts: raw fetch calls
// against Google's documented REST API. The one piece that's genuinely
// different from an API-key provider is authentication — Google requires a
// service-account OAuth2 access token, obtained via the standard "JWT
// bearer" flow (sign a short-lived assertion with the service account's own
// private key, trade it for an access token). That flow is fully
// self-contained — this app controls both ends of it — unlike verifying an
// INCOMING signed token from Google (see google-play-rtdn.ts), which this
// deliberately does NOT attempt; see that file's header comment for why.

import { createSign } from "crypto";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function getPackageName(): string | null {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || null;
}

function getServiceAccountKey(): ServiceAccountKey | null {
  const b64 = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!b64) return null;
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

export function isGooglePlayConfigured(): boolean {
  return getPackageName() !== null && getServiceAccountKey() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Standard OAuth2 "JWT Bearer Token" flow for a Google service account (RFC
// 7523) — sign a short-lived assertion with the service account's own RSA
// private key, then exchange it at Google's token endpoint for a real
// access token. This is a completely deterministic, self-contained
// operation (we hold both the signing key and verify our own output
// implicitly by whether Google's token endpoint accepts it), unlike
// verifying a token Google sends us.
function signServiceAccountAssertion(key: ServiceAccountKey): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = base64url(signer.sign(key.private_key));

  return `${signingInput}.${signature}`;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const key = getServiceAccountKey();
  if (!key) return { ok: false, message: "Google Play service account isn't configured." };

  // Reuse a still-valid token — access tokens are good for an hour; refresh
  // a minute early to avoid a request racing against expiry.
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return { ok: true, token: cachedToken.accessToken };
  }

  const assertion = signServiceAccountAssertion(key);

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not reach Google's token endpoint." };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, message: `Google token exchange failed (${res.status}): ${text.slice(0, 300)}` };
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    return { ok: false, message: "Google token exchange returned no access_token." };
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return { ok: true, token: body.access_token };
}

async function androidPublisherFetch(
  path: string,
  init?: { method?: string }
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const tokenResult = await getAccessToken();
  if (!tokenResult.ok) return { ok: false, status: 0, message: tokenResult.message };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    });
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Could not reach the Android Publisher API." };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: text.slice(0, 500) || `Request failed (${res.status}).` };
  }

  const body = await res.json().catch(() => null);
  return { ok: true, body };
}

// Mirrors the v2 SubscriptionPurchaseV2 resource's subscriptionState enum —
// see https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2.
// Trusted only as of the moment of this call; RTDN notifications exist to
// tell us WHEN to call this again, never to be trusted for the state itself
// (see google-play-rtdn.ts).
export interface VerifiedGooglePlaySubscription {
  packageName: string;
  subscriptionState: string;
  productId: string | null;
  basePlanId: string | null;
  orderId: string | null;
  linkedPurchaseToken: string | null;
  startTimeMillis: number | null;
  expiryTimeMillis: number | null;
  autoRenewing: boolean;
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_UNSPECIFIED" | "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" | string;
}

interface SubscriptionsV2Response {
  kind?: string;
  regionCode?: string;
  lineItems?: {
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string };
  }[];
  startTime?: string;
  subscriptionState?: string;
  linkedPurchaseToken?: string;
  latestOrderId?: string;
  acknowledgementState?: string;
}

// Verifies a purchase token against Google directly — the only source of
// truth for whether a subscription is real and what it entitles. Never
// trust calories/price/status the client claims about its own purchase.
export async function verifyGooglePlaySubscriptionPurchase(
  purchaseToken: string
): Promise<{ ok: true; subscription: VerifiedGooglePlaySubscription } | { ok: false; message: string }> {
  const packageName = getPackageName();
  if (!packageName) return { ok: false, message: "Google Play package name isn't configured." };

  const encodedToken = encodeURIComponent(purchaseToken);
  const result = await androidPublisherFetch(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodedToken}`
  );

  if (!result.ok) {
    return { ok: false, message: `Google Play verification failed (${result.status}): ${result.message}` };
  }

  const body = result.body as SubscriptionsV2Response;
  const lineItem = body.lineItems?.[0];

  return {
    ok: true,
    subscription: {
      packageName,
      subscriptionState: body.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED",
      productId: lineItem?.productId ?? null,
      basePlanId: lineItem?.offerDetails?.basePlanId ?? null,
      orderId: body.latestOrderId ?? null,
      linkedPurchaseToken: body.linkedPurchaseToken ?? null,
      startTimeMillis: body.startTime ? new Date(body.startTime).getTime() : null,
      expiryTimeMillis: lineItem?.expiryTime ? new Date(lineItem.expiryTime).getTime() : null,
      autoRenewing: lineItem?.autoRenewingPlan?.autoRenewEnabled ?? false,
      acknowledgementState: body.acknowledgementState ?? "ACKNOWLEDGEMENT_STATE_UNSPECIFIED",
    },
  };
}

// Maps Google's subscriptionState (SubscriptionPurchaseV2's raw enum, e.g.
// "SUBSCRIPTION_STATE_ACTIVE") onto both a storage-level Play status and our
// app's own subscription status. Returned as plain strings — matched against
// db.ts's GooglePlaySubscriptionStatus/SubscriptionStatus by the caller —
// rather than importing those types here, mirroring stripe.ts/revolut.ts's
// choice not to depend on lib/db.ts. Shared by the verify route and the RTDN
// webhook so the two never drift apart on what a given state means.
export function mapGooglePlaySubscriptionState(
  subscriptionState: string,
  expiryTimeMillis: number | null
): { playStatus: string; appStatus: string | null } {
  switch (subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return { playStatus: "active", appStatus: "active" };
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      // Payment failed but Google is still retrying — member keeps access.
      return { playStatus: "in_grace_period", appStatus: "past_due" };
    case "SUBSCRIPTION_STATE_ON_HOLD":
      // Retries exhausted — conservative: remove access rather than assume
      // it'll recover on its own.
      return { playStatus: "on_hold", appStatus: "canceled" };
    case "SUBSCRIPTION_STATE_PAUSED":
      return { playStatus: "paused", appStatus: "paused" };
    case "SUBSCRIPTION_STATE_CANCELED": {
      // Auto-renew was turned off, but the member may still be mid-paid-period.
      const stillWithinPaidPeriod = expiryTimeMillis !== null && expiryTimeMillis > Date.now();
      return { playStatus: "canceled", appStatus: stillWithinPaidPeriod ? "active" : "canceled" };
    }
    case "SUBSCRIPTION_STATE_EXPIRED":
      return { playStatus: "expired", appStatus: "canceled" };
    default:
      // SUBSCRIPTION_STATE_PENDING / _UNSPECIFIED / anything unrecognized —
      // don't guess at an app status; the caller should treat appStatus:
      // null as "not confidently entitled yet, don't grant."
      return { playStatus: "canceled", appStatus: null };
  }
}

// Google auto-refunds a subscription purchase not acknowledged (by any
// method — client or server) within 3 days. Called once, right after a
// fresh purchase verifies successfully — safe to call again (Google returns
// an error for an already-acknowledged purchase, which this treats as
// success rather than a failure, since the end state is what matters).
export async function acknowledgeGooglePlaySubscription(
  purchaseToken: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const packageName = getPackageName();
  if (!packageName) return { ok: false, message: "Google Play package name isn't configured." };

  const encodedToken = encodeURIComponent(purchaseToken);
  const result = await androidPublisherFetch(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodedToken}:acknowledge`,
    { method: "POST" }
  );

  if (!result.ok) {
    // Google returns 400 for an already-acknowledged token — not a real
    // failure for our purposes, since the purchase is (and stays) fine.
    if (result.status === 400 && /already.*acknowledg/i.test(result.message)) {
      return { ok: true };
    }
    return { ok: false, message: `Acknowledgement failed (${result.status}): ${result.message}` };
  }

  return { ok: true };
}
