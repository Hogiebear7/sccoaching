import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";

import { parseResendEvent, verifySvixSignature } from "@/lib/email-events";

const SECRET_BYTES = Buffer.from("super-secret-key-1234567890");
const secret = `whsec_${SECRET_BYTES.toString("base64")}`;
const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("Resend webhook signature", () => {
  const now = 1_800_000_000;
  const body = '{"type":"email.delivered"}';
  it("accepts a correct signature, including among several", () => {
    const ts = String(now);
    const good = sign("msg_1", ts, body);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signatureHeader: good, body, nowSeconds: now })).toBe(true);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signatureHeader: `v1,AAAA ${good}`, body, nowSeconds: now })).toBe(true);
  });
  it("rejects a wrong body, wrong id, old timestamp, or missing pieces", () => {
    const ts = String(now);
    const good = sign("msg_1", ts, body);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signatureHeader: good, body: body + " ", nowSeconds: now })).toBe(false);
    expect(verifySvixSignature({ secret, id: "msg_2", timestamp: ts, signatureHeader: good, body, nowSeconds: now })).toBe(false);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signatureHeader: good, body, nowSeconds: now + 3600 })).toBe(false);
    expect(verifySvixSignature({ secret, id: null, timestamp: ts, signatureHeader: good, body, nowSeconds: now })).toBe(false);
    expect(verifySvixSignature({ secret: "", id: "msg_1", timestamp: ts, signatureHeader: good, body, nowSeconds: now })).toBe(false);
  });
});

describe("parseResendEvent", () => {
  it("suppresses on a permanent bounce and on a complaint, not on a temporary bounce or a delay", () => {
    expect(parseResendEvent({ type: "email.bounced", data: { email_id: "e1", to: ["A@X.com"], bounce: { type: "Permanent", message: "no mailbox" } } })).toMatchObject({
      suppress: "bounced",
      to: "a@x.com",
      emailId: "e1",
    });
    expect(parseResendEvent({ type: "email.bounced", data: { to: ["a@x.com"], bounce: { type: "Transient" } } })?.suppress).toBeNull();
    expect(parseResendEvent({ type: "email.complained", data: { to: ["a@x.com"] } })?.suppress).toBe("complained");
    expect(parseResendEvent({ type: "email.delivery_delayed", data: { to: ["a@x.com"] } })?.suppress).toBeNull();
  });
  it("ignores events that aren't about an email", () => {
    expect(parseResendEvent({ type: "contact.created", data: {} })).toBeNull();
    expect(parseResendEvent(null)).toBeNull();
  });
});
