// lib/providers/app-store.ts: the account binding, configuration, and the App Store Server API client, with global fetch replaced
// by a recorder. The API key here is generated for the test; the response payloads are signed through the generated test chain.
// No network, no Apple credential.
import { generateKeyPairSync, verify } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appStoreAccountBindingMatches,
  appStoreAccountToken,
  appStoreErrorCodeForStatus,
  fetchAppStoreSubscriptionStatus,
  isAppStoreConfigured,
} from "@/lib/providers/app-store";

import { BUNDLE_ID, fakeTransaction, GOOD_ROOT_PEM, signJws } from "../helpers/app-store-fixture";

const ENV = ["APP_STORE_BUNDLE_ID", "APP_STORE_ISSUER_ID", "APP_STORE_KEY_ID", "APP_STORE_PRIVATE_KEY_BASE64", "APP_STORE_ROOT_CERTIFICATES_BASE64"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function configure(over: Partial<Record<(typeof ENV)[number], string | undefined>> = {}) {
  const values: Record<string, string | undefined> = {
    APP_STORE_BUNDLE_ID: BUNDLE_ID,
    APP_STORE_ISSUER_ID: "test-issuer-id",
    APP_STORE_KEY_ID: "TESTKEYID1",
    APP_STORE_PRIVATE_KEY_BASE64: Buffer.from(P8).toString("base64"),
    APP_STORE_ROOT_CERTIFICATES_BASE64: Buffer.from(GOOD_ROOT_PEM).toString("base64"),
    ...over,
  };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

interface Call {
  url: string;
  headers: Record<string, string>;
}
let calls: Call[] = [];
function mockFetch(respond: () => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return respond();
  }) as unknown as typeof fetch;
}

const statusBody = (orig: string, status = 1, over: Record<string, unknown> = {}) => ({
  data: [
    {
      lastTransactions: [
        {
          status,
          originalTransactionId: orig,
          signedTransactionInfo: signJws(fakeTransaction({ originalTransactionId: orig, ...over }) as Record<string, unknown>),
          signedRenewalInfo: signJws({ originalTransactionId: orig, autoRenewStatus: 1 }),
        },
      ],
    },
  ],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  configure();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the account token", () => {
  it("is a stable UUID per account, different for every account, and reveals nothing about it", () => {
    const a = appStoreAccountToken("user-a")!;
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(appStoreAccountToken("user-a")).toBe(a);
    expect(appStoreAccountToken("user-b")).not.toBe(a);
    expect(a).not.toContain("user-a");
  });

  it("matches constant-time and case-insensitively, and nothing else", () => {
    const a = appStoreAccountToken("user-a");
    expect(appStoreAccountBindingMatches(a, a)).toBe(true);
    expect(appStoreAccountBindingMatches(a, a!.toUpperCase())).toBe(true);
    expect(appStoreAccountBindingMatches(a, appStoreAccountToken("user-b"))).toBe(false);
    expect(appStoreAccountBindingMatches(a, null)).toBe(false);
    expect(appStoreAccountBindingMatches(a, undefined)).toBe(false);
    expect(appStoreAccountBindingMatches(a, "")).toBe(false);
    expect(appStoreAccountBindingMatches(null, a)).toBe(false);
    expect(appStoreAccountBindingMatches(a, `${a}0`)).toBe(false);
  });
});

describe("configuration", () => {
  it("is configured only when every piece is present and usable", () => {
    expect(isAppStoreConfigured()).toBe(true);
    for (const k of ENV) {
      configure({ [k]: undefined });
      expect(isAppStoreConfigured(), k).toBe(false);
    }
    configure({ APP_STORE_PRIVATE_KEY_BASE64: Buffer.from("not a key").toString("base64") });
    expect(isAppStoreConfigured()).toBe(false);
    configure({ APP_STORE_ROOT_CERTIFICATES_BASE64: Buffer.from("not a cert").toString("base64") });
    expect(isAppStoreConfigured()).toBe(false);
  });

  it("maps HTTP statuses to a closed set of codes", () => {
    expect(appStoreErrorCodeForStatus(401)).toBe("unauthorized");
    expect(appStoreErrorCodeForStatus(403)).toBe("unauthorized");
    expect(appStoreErrorCodeForStatus(404)).toBe("not_found");
    expect(appStoreErrorCodeForStatus(429)).toBe("rate_limited");
    expect(appStoreErrorCodeForStatus(503)).toBe("server_error");
    expect(appStoreErrorCodeForStatus(400)).toBe("bad_request");
  });
});

describe("fetchAppStoreSubscriptionStatus", () => {
  it("asks the PRODUCTION host for a production subscription, with a valid short-lived ES256 token", async () => {
    mockFetch(() => json(statusBody("o-1")));
    const result = await fetchAppStoreSubscriptionStatus("o-1", "production");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/o-1");

    const [h, p, s] = calls[0].headers.Authorization.replace("Bearer ", "").split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "TESTKEYID1", typ: "JWT" });
    expect(claims).toMatchObject({ iss: "test-issuer-id", aud: "appstoreconnect-v1", bid: BUNDLE_ID });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60 * 60); // Apple's maximum
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("asks the SANDBOX host for a sandbox subscription", async () => {
    mockFetch(() => json(statusBody("o-2")));
    await fetchAppStoreSubscriptionStatus("o-2", "sandbox");
    expect(calls[0].url).toBe("https://api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/o-2");
  });

  it("url-encodes the identifier, so a crafted one cannot change the path", async () => {
    mockFetch(() => json({ data: [] }));
    await fetchAppStoreSubscriptionStatus("a/../b?x=1", "production");
    expect(calls[0].url).toBe("https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/a%2F..%2Fb%3Fx%3D1");
  });

  it("returns the verified transaction, renewal info and Apple's status", async () => {
    mockFetch(() => json(statusBody("o-3", 4, { productId: "p-3" })));
    const result = await fetchAppStoreSubscriptionStatus("o-3", "production");
    expect(result).toMatchObject({ ok: true, result: { environment: "production", status: 4, transaction: { originalTransactionId: "o-3", productId: "p-3" }, renewal: { autoRenewStatus: 1 } } });
  });

  it("refuses a response whose signed transaction was signed through a chain that is not Apple's", async () => {
    const body = statusBody("o-4");
    body.data[0].lastTransactions[0].signedTransactionInfo = signJws(fakeTransaction({ originalTransactionId: "o-4" }) as Record<string, unknown>, "rogue");
    mockFetch(() => json(body));
    expect(await fetchAppStoreSubscriptionStatus("o-4", "production")).toEqual({ ok: false, code: "invalid_response" });
  });

  it("refuses a response whose transaction names a different subscription than the one asked about", async () => {
    const body = statusBody("o-5");
    body.data[0].lastTransactions[0].signedTransactionInfo = signJws(fakeTransaction({ originalTransactionId: "someone-else" }) as Record<string, unknown>);
    mockFetch(() => json(body));
    expect(await fetchAppStoreSubscriptionStatus("o-5", "production")).toEqual({ ok: false, code: "invalid_response" });
  });

  it("refuses a response whose renewal info does not verify", async () => {
    const body = statusBody("o-6");
    body.data[0].lastTransactions[0].signedRenewalInfo = signJws({ originalTransactionId: "o-6", autoRenewStatus: 1 }, "rogue");
    mockFetch(() => json(body));
    expect(await fetchAppStoreSubscriptionStatus("o-6", "production")).toEqual({ ok: false, code: "invalid_response" });
  });

  it("is not_found when the subscription is not in the response", async () => {
    mockFetch(() => json(statusBody("other")));
    expect(await fetchAppStoreSubscriptionStatus("o-7", "production")).toEqual({ ok: false, code: "not_found" });
  });

  it.each([
    [401, "unauthorized"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "server_error"],
    [400, "bad_request"],
  ])("maps HTTP %s to %s without returning any Apple text", async (status, code) => {
    mockFetch(() => json({ errorMessage: "SECRET provider detail" }, status));
    expect(await fetchAppStoreSubscriptionStatus("o-8", "production")).toEqual({ ok: false, code });
  });

  it("maps a network failure and a timeout, and an unreadable body", async () => {
    mockFetch(() => Promise.reject(new Error("socket hang up")));
    expect(await fetchAppStoreSubscriptionStatus("o-9", "production")).toEqual({ ok: false, code: "network" });

    mockFetch(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    expect(await fetchAppStoreSubscriptionStatus("o-9", "production")).toEqual({ ok: false, code: "timeout" });

    mockFetch(() => new Response("<html>", { status: 200 }));
    expect(await fetchAppStoreSubscriptionStatus("o-9", "production")).toEqual({ ok: false, code: "invalid_response" });
  });

  it("makes no call and answers not_configured when credentials or roots are missing", async () => {
    mockFetch(() => json(statusBody("o-10")));
    configure({ APP_STORE_PRIVATE_KEY_BASE64: undefined });
    expect(await fetchAppStoreSubscriptionStatus("o-10", "production")).toEqual({ ok: false, code: "not_configured" });
    configure({ APP_STORE_ROOT_CERTIFICATES_BASE64: undefined });
    expect(await fetchAppStoreSubscriptionStatus("o-10", "production")).toEqual({ ok: false, code: "not_configured" });
    expect(calls).toEqual([]);
  });

  it("never puts the private key or the token anywhere but the Authorization header", async () => {
    mockFetch(() => json(statusBody("o-11")));
    await fetchAppStoreSubscriptionStatus("o-11", "production");
    expect(calls[0].url).not.toContain("BEGIN");
    expect(calls[0].url).not.toContain("Bearer");
    vi.restoreAllMocks();
  });
});
