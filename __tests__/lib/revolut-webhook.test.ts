import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isRevolutTimestampFresh,
  isRevolutWebhookConfigured,
  mapRevolutEventToStatus,
  verifyRevolutSignature,
} from "@/lib/providers/revolut-webhook";

const SIGNING_SECRET = "wsk_test_secret";

function sign(timestamp: string, rawBody: string): string {
  const payloadToSign = `v1.${timestamp}.${rawBody}`;
  return `v1=${createHmac("sha256", SIGNING_SECRET).update(payloadToSign).digest("hex")}`;
}

describe("revolut-webhook", () => {
  const originalSecret = process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
  });

  afterEach(() => {
    process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = originalSecret;
  });

  it("reports configured once the signing secret env var is set", () => {
    expect(isRevolutWebhookConfigured()).toBe(true);
  });

  it("reports unconfigured when the signing secret is missing", () => {
    delete process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
    expect(isRevolutWebhookConfigured()).toBe(false);
  });

  it("accepts a correctly computed signature", () => {
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    expect(verifyRevolutSignature(rawBody, timestamp, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const badSignature = `v1=${createHmac("sha256", "wrong-secret").update(`v1.${timestamp}.${rawBody}`).digest("hex")}`;

    expect(verifyRevolutSignature(rawBody, timestamp, badSignature)).toBe(false);
  });

  it("rejects a signature if the body was tampered with after signing", () => {
    const timestamp = String(Date.now());
    const signature = sign(timestamp, JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" }));
    const tamperedBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-2" });

    expect(verifyRevolutSignature(tamperedBody, timestamp, signature)).toBe(false);
  });

  it("rejects when no signature header is present", () => {
    expect(verifyRevolutSignature("{}", String(Date.now()), null)).toBe(false);
  });

  it("accepts a multi-signature header where one of the signatures is correct", () => {
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const validSig = sign(timestamp, rawBody);
    const multiSigHeader = `v1=aaabbbcccddd000,${validSig}`;

    expect(verifyRevolutSignature(rawBody, timestamp, multiSigHeader)).toBe(true);
  });

  it("rejects a multi-signature header where all signatures are wrong", () => {
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const multiSigHeader = "v1=aaabbbcccddd000,v1=111222333444fff";

    expect(verifyRevolutSignature(rawBody, timestamp, multiSigHeader)).toBe(false);
  });

  it("treats a recent timestamp as fresh", () => {
    expect(isRevolutTimestampFresh(String(Date.now()))).toBe(true);
  });

  it("rejects a timestamp older than the 5-minute tolerance", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    expect(isRevolutTimestampFresh(String(sixMinutesAgo))).toBe(false);
  });

  it("rejects a missing or non-numeric timestamp", () => {
    expect(isRevolutTimestampFresh(null)).toBe(false);
    expect(isRevolutTimestampFresh("not-a-number")).toBe(false);
  });

  it("maps successful payment events to active", () => {
    expect(mapRevolutEventToStatus("ORDER_COMPLETED")).toBe("active");
    expect(mapRevolutEventToStatus("ORDER_AUTHORISED")).toBe("active");
    expect(mapRevolutEventToStatus("SUBSCRIPTION_INITIATED")).toBe("active");
  });

  it("maps failure events to past_due", () => {
    expect(mapRevolutEventToStatus("ORDER_FAILED")).toBe("past_due");
    expect(mapRevolutEventToStatus("ORDER_PAYMENT_DECLINED")).toBe("past_due");
    expect(mapRevolutEventToStatus("SUBSCRIPTION_OVERDUE")).toBe("past_due");
  });

  it("maps cancellation events to canceled", () => {
    expect(mapRevolutEventToStatus("ORDER_CANCELLED")).toBe("canceled");
    expect(mapRevolutEventToStatus("SUBSCRIPTION_CANCELLED")).toBe("canceled");
    expect(mapRevolutEventToStatus("SUBSCRIPTION_FINISHED")).toBe("canceled");
  });

  it("ignores unhandled event types", () => {
    expect(mapRevolutEventToStatus("DISPUTE_ACTION_REQUIRED")).toBeNull();
    expect(mapRevolutEventToStatus("PAYOUT_COMPLETED")).toBeNull();
  });
});
