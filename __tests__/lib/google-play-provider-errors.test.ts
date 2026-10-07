// lib/providers/google-play.ts failure handling: every outbound call has a timeout, every failure is a code from a
// closed set, and the provider's own message text is never returned. fetch is mocked; the service account here is a
// throwaway key generated in memory for this test only. No network is used.
import { generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SERVICE_ACCOUNT_B64 = Buffer.from(JSON.stringify({ client_email: "test@example.invalid", private_key: privateKey })).toString("base64");

const SECRET_PROVIDER_TEXT = "SECRET-PROVIDER-DETAIL-purchaseToken=abc123";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
const saved: Record<string, string | undefined> = {};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body: string, status: number) => new Response(body, { status });
const tokenOk = () => json({ access_token: "fake-access-token", expires_in: 3600 });

async function load() {
  vi.resetModules();
  return import("@/lib/providers/google-play");
}

beforeEach(() => {
  for (const k of ["GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64"]) saved[k] = process.env[k];
  process.env.GOOGLE_PLAY_PACKAGE_NAME = "com.example.app";
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = SERVICE_ACCOUNT_B64;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("verifyGooglePlaySubscriptionPurchase failures", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [410, "not_found"],
    [400, "bad_request"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ])("maps an API %i to %s and returns no provider text", async (status, code) => {
    const { verifyGooglePlaySubscriptionPurchase } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(text(SECRET_PROVIDER_TEXT, status));

    const result = await verifyGooglePlaySubscriptionPurchase("fake-token");

    expect(result).toEqual({ ok: false, code, status });
    expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-DETAIL");
  });

  it("reports a rejected token exchange as unauthorized (our credentials), never as a bad purchase, with no text", async () => {
    const { verifyGooglePlaySubscriptionPurchase } = await load();
    fetchMock.mockResolvedValueOnce(text(SECRET_PROVIDER_TEXT, 400));
    const result = await verifyGooglePlaySubscriptionPurchase("fake-token");
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-DETAIL");
  });

  it("maps a timeout and a network failure to distinct codes", async () => {
    const { verifyGooglePlaySubscriptionPurchase } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockRejectedValueOnce(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));
    expect(await verifyGooglePlaySubscriptionPurchase("fake-token")).toMatchObject({ ok: false, code: "timeout" });

    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET to 203.0.113.9"));
    const net = await verifyGooglePlaySubscriptionPurchase("fake-token");
    expect(net).toMatchObject({ ok: false, code: "network" });
    expect(JSON.stringify(net)).not.toContain("203.0.113.9");
  });

  it("treats an unreadable success body as invalid_response", async () => {
    const { verifyGooglePlaySubscriptionPurchase } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(text("not json", 200));
    expect(await verifyGooglePlaySubscriptionPurchase("fake-token")).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("is not_configured with no package name or credentials, and never calls the network", async () => {
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
    const { verifyGooglePlaySubscriptionPurchase, acknowledgeGooglePlaySubscription } = await load();
    expect(await verifyGooglePlaySubscriptionPurchase("fake-token")).toMatchObject({ ok: false, code: "not_configured" });
    expect(await acknowledgeGooglePlaySubscription("fake-token")).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives every outbound request a timeout signal", async () => {
    const { verifyGooglePlaySubscriptionPurchase, GOOGLE_PLAY_REQUEST_TIMEOUT_MS } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ productId: "p" }] }));
    const result = await verifyGooglePlaySubscriptionPurchase("fake-token");
    expect(result.ok).toBe(true);
    expect(GOOGLE_PLAY_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("acknowledgeGooglePlaySubscription", () => {
  it("treats Google's 'already acknowledged' 400 as success", async () => {
    const { acknowledgeGooglePlaySubscription } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(text("The subscription purchase is already acknowledged.", 400));
    expect(await acknowledgeGooglePlaySubscription("fake-token")).toEqual({ ok: true });
  });

  it("returns a code, not text, for any other failure", async () => {
    const { acknowledgeGooglePlaySubscription } = await load();
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(text(SECRET_PROVIDER_TEXT, 500));
    const result = await acknowledgeGooglePlaySubscription("fake-token");
    expect(result).toEqual({ ok: false, code: "server_error", status: 500 });
  });
});

describe("googlePlayErrorCodeForStatus", () => {
  it("maps statuses onto the closed set", async () => {
    const { googlePlayErrorCodeForStatus } = await load();
    expect(googlePlayErrorCodeForStatus(418)).toBe("bad_request");
    expect(googlePlayErrorCodeForStatus(502)).toBe("server_error");
  });
});
