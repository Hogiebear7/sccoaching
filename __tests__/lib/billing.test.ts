import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getBillingConfigurationStatus,
  isBillingProviderConfigured,
  isPendingCheckoutStale,
  PENDING_CHECKOUT_STALE_AFTER_MS,
} from "@/lib/billing";

describe("lib/billing", () => {
  const originalSecretKey = process.env.REVOLUT_SECRET_KEY;
  const originalWebhookSecret = process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;

  beforeEach(() => {
    delete process.env.REVOLUT_SECRET_KEY;
    delete process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
  });

  afterEach(() => {
    process.env.REVOLUT_SECRET_KEY = originalSecretKey;
    process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = originalWebhookSecret;
  });

  describe("isBillingProviderConfigured / getBillingConfigurationStatus", () => {
    it("reports fully unconfigured when neither env var is set", () => {
      expect(isBillingProviderConfigured()).toBe(false);
      expect(getBillingConfigurationStatus()).toEqual({
        checkoutConfigured: false,
        webhookConfigured: false,
      });
    });

    it("reports half-configured when only the secret key is set", () => {
      process.env.REVOLUT_SECRET_KEY = "sk_test_123";

      expect(isBillingProviderConfigured()).toBe(true);
      expect(getBillingConfigurationStatus()).toEqual({
        checkoutConfigured: true,
        webhookConfigured: false,
      });
    });

    it("reports fully configured when both env vars are set", () => {
      process.env.REVOLUT_SECRET_KEY = "sk_test_123";
      process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = "wsk_test_123";

      expect(getBillingConfigurationStatus()).toEqual({
        checkoutConfigured: true,
        webhookConfigured: true,
      });
    });
  });

  describe("isPendingCheckoutStale", () => {
    it("treats a recent checkout as not stale", () => {
      expect(isPendingCheckoutStale(new Date().toISOString())).toBe(false);
    });

    it("treats a checkout older than the stale window as stale", () => {
      const old = new Date(Date.now() - PENDING_CHECKOUT_STALE_AFTER_MS - 1000).toISOString();
      expect(isPendingCheckoutStale(old)).toBe(true);
    });

    it("treats a checkout right at the boundary as not yet stale", () => {
      const justInside = new Date(Date.now() - PENDING_CHECKOUT_STALE_AFTER_MS + 5000).toISOString();
      expect(isPendingCheckoutStale(justInside)).toBe(false);
    });
  });
});
