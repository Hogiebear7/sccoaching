// Unit tests for the account-binding primitives in lib/providers/google-play.ts
// (googlePlayObfuscatedAccountId, googlePlayAccountBindingMatches) and for the
// obfuscatedExternalAccountId field now parsed out of Google's
// SubscriptionPurchaseV2 response. Uses only synthetic user ids and provider
// responses; SESSION_SECRET comes from vitest.config.ts's fixed test value.
import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  googlePlayAccountBindingMatches,
  googlePlayObfuscatedAccountId,
  verifyGooglePlaySubscriptionPurchase,
} from "@/lib/providers/google-play";

describe("googlePlayObfuscatedAccountId", () => {
  it("is deterministic for the same user id", () => {
    const a = googlePlayObfuscatedAccountId("user-1");
    const b = googlePlayObfuscatedAccountId("user-1");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("differs for different user ids", () => {
    expect(googlePlayObfuscatedAccountId("user-1")).not.toBe(googlePlayObfuscatedAccountId("user-2"));
  });

  it("never contains the raw user id", () => {
    const value = googlePlayObfuscatedAccountId("a-very-recognizable-user-id");
    expect(value).not.toContain("a-very-recognizable-user-id");
  });

  it("matches a manual HMAC over the same domain-separated input, proving it's not reversible without SESSION_SECRET", () => {
    const expected = createHmac("sha256", "test-session-secret-do-not-use-in-production")
      .update("google-play-obfuscated-account-id:v1:user-1")
      .digest("hex");
    expect(googlePlayObfuscatedAccountId("user-1")).toBe(expected);
  });

  it("returns null when SESSION_SECRET isn't configured, rather than falling back to an unbound value", async () => {
    vi.resetModules();
    const original = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      const fresh = await import("@/lib/providers/google-play");
      expect(fresh.googlePlayObfuscatedAccountId("user-1")).toBeNull();
    } finally {
      process.env.SESSION_SECRET = original;
      vi.resetModules();
    }
  });
});

describe("googlePlayAccountBindingMatches", () => {
  it("is true only for an exact match", () => {
    const expected = googlePlayObfuscatedAccountId("user-1")!;
    expect(googlePlayAccountBindingMatches(expected, expected)).toBe(true);
  });

  it("is false for a mismatched value", () => {
    const expected = googlePlayObfuscatedAccountId("user-1")!;
    const other = googlePlayObfuscatedAccountId("user-2")!;
    expect(googlePlayAccountBindingMatches(expected, other)).toBe(false);
  });

  it("is false when the provider value is missing", () => {
    const expected = googlePlayObfuscatedAccountId("user-1")!;
    expect(googlePlayAccountBindingMatches(expected, null)).toBe(false);
  });

  it("is false when the expected value is missing (e.g. SESSION_SECRET unavailable)", () => {
    expect(googlePlayAccountBindingMatches(null, "anything")).toBe(false);
  });

  it("is false for a malformed/truncated value rather than throwing", () => {
    const expected = googlePlayObfuscatedAccountId("user-1")!;
    expect(googlePlayAccountBindingMatches(expected, expected.slice(0, 8))).toBe(false);
    expect(googlePlayAccountBindingMatches(expected, "")).toBe(false);
  });
});

describe("verifyGooglePlaySubscriptionPurchase — obfuscatedExternalAccountId parsing", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_PLAY_PACKAGE_NAME = "com.example.app";
    // signServiceAccountAssertion actually signs with this key (RS256), so it
    // must be a real RSA private key — the resulting signature is never
    // itself verified in this test (the token-exchange response is mocked
    // below), only that signing succeeds.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(
      JSON.stringify({
        client_email: "svc@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      })
    ).toString("base64");
    // Token exchange call.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "fake-token", expires_in: 3600 }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
  });

  it("extracts obfuscatedExternalAccountId when Google returns one", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [{ productId: "app_sub" }],
        externalAccountIdentifiers: { obfuscatedExternalAccountId: "abc123" },
      }),
    });

    const result = await verifyGooglePlaySubscriptionPurchase("token-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscription.obfuscatedExternalAccountId).toBe("abc123");
    }
  });

  it("is null when Google returns no externalAccountIdentifiers at all (legacy/never-sent binding)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [{ productId: "app_sub" }],
      }),
    });

    const result = await verifyGooglePlaySubscriptionPurchase("token-2");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscription.obfuscatedExternalAccountId).toBeNull();
    }
  });
});
