// POST /api/contact — the public marketing contact form. No prior test file
// existed for this route. Covers:
//   * validation (required fields, format, and the new length ceilings)
//   * the honeypot
//   * rate limiting now goes through the shared, conservative client-ip policy
//     (lib/client-ip.ts) instead of trusting a raw, spoofable X-Forwarded-For
//     header directly
//   * the lead is stored and the notification email sent only on success
// Real rate limiter and client-ip logic; only Supabase and the email sender
// are mocked. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNRESOLVED_CLIENT_LIMIT_MULTIPLIER } from "@/lib/client-ip";
import { resetRateLimits } from "@/lib/rate-limit";

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", () => mail);

const VALID = { name: "Alex Visitor", email: "alex@x.test", phone: "0851234567", message: "Interested in coaching." };

async function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  const { POST } = await import("@/app/api/contact/route");
  return POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    })
  );
}
const fromIp = (ip: string) => ({ "x-forwarded-for": ip });
const SUCCESS = { success: true, message: "Thanks — we'll be in touch shortly." };

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  insertMock.mockResolvedValue({ error: null });
  mail.sendEmail.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("validation", () => {
  it("stores the lead and emails the notification on a valid enquiry", async () => {
    const res = await post(VALID, fromIp("203.0.113.9"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS);
    expect(fromMock).toHaveBeenCalledWith("contact_inquiries");
    expect(insertMock).toHaveBeenCalledWith({ name: "Alex Visitor", email: "alex@x.test", phone: "0851234567", message: "Interested in coaching." });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("trims fields before storing and emailing", async () => {
    await post({ ...VALID, name: "  Alex Visitor  ", message: "  Interested in coaching.  " }, fromIp("203.0.113.10"));

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ name: "Alex Visitor", message: "Interested in coaching." }));
  });

  it("a missing phone number is stored as null", async () => {
    const noPhone = { name: VALID.name, email: VALID.email, message: VALID.message };
    await post(noPhone, fromIp("203.0.113.11"));

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
  });

  it.each([
    ["missing name", { ...VALID, name: undefined }, "Name is required."],
    ["blank name", { ...VALID, name: "   " }, "Name is required."],
    ["missing email", { ...VALID, email: undefined }, "A valid email is required."],
    ["malformed email", { ...VALID, email: "not-an-email" }, "A valid email is required."],
    ["missing message", { ...VALID, message: undefined }, "Message is required."],
    ["blank message", { ...VALID, message: "   " }, "Message is required."],
    ["non-string phone", { ...VALID, phone: 12345 }, "Invalid phone number."],
  ])("%s -> 400, nothing stored or sent", async (_label, body, message) => {
    const res = await post(body, fromIp("203.0.113.12"));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe(message);
    expect(insertMock).not.toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("invalid JSON -> 400, nothing stored", async () => {
    const res = await post(undefined, fromIp("203.0.113.13"), "{not json");

    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it.each([
    ["name", { ...VALID, name: "a".repeat(201) }, "Name must be 200 characters or fewer."],
    ["email", { ...VALID, email: `${"a".repeat(250)}@x.test` }, "A valid email is required."],
    ["message", { ...VALID, message: "a".repeat(5001) }, "Message must be 5000 characters or fewer."],
    ["phone", { ...VALID, phone: "0".repeat(41) }, "Invalid phone number."],
  ])("a %s over the length ceiling -> 400, nothing stored or sent", async (_label, body, message) => {
    const res = await post(body, fromIp("203.0.113.14"));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe(message);
    expect(insertMock).not.toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("a field exactly at its length ceiling is accepted", async () => {
    const res = await post({ ...VALID, name: "a".repeat(200), message: "b".repeat(5000), phone: "0".repeat(40) }, fromIp("203.0.113.15"));

    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("the honeypot field silently pretends success and stores nothing", async () => {
    const res = await post({ ...VALID, company: "I am a bot" }, fromIp("203.0.113.16"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS);
    expect(insertMock).not.toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("Supabase insert failure -> 500, no email sent", async () => {
    insertMock.mockResolvedValue({ error: { message: "insert failed" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await post(VALID, fromIp("203.0.113.17"));

    expect(res.status).toBe(500);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe("rate limiting — per-client (TRUSTED_PROXY_HOPS=1)", () => {
  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_HOPS", "1"));

  it("allows 3 enquiries per client per 10 minutes, then 429s the 4th", async () => {
    for (let i = 0; i < 3; i++) expect((await post(VALID, fromIp("203.0.113.20"))).status).toBe(200);

    const over = await post(VALID, fromIp("203.0.113.20"));

    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ success: false, message: "Too many enquiries — please try again shortly." });
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  it("a different client is unaffected", async () => {
    for (let i = 0; i < 3; i++) await post(VALID, fromIp("203.0.113.21"));

    expect((await post(VALID, fromIp("203.0.113.21"))).status).toBe(429);
    expect((await post(VALID, fromIp("203.0.113.22"))).status).toBe(200);
  });

  it("a client-prepended X-Forwarded-For entry cannot pick a fresh bucket for an already-limited client", async () => {
    for (let i = 0; i < 3; i++) await post(VALID, fromIp("203.0.113.23"));

    const spoofed = await post(VALID, { "x-forwarded-for": "1.1.1.1, 203.0.113.23" });

    expect(spoofed.status).toBe(429);
  });

  it("X-Real-IP and CF-Connecting-IP are never consulted: they cannot be used to dodge the limit", async () => {
    for (let i = 0; i < 3; i++) await post(VALID, fromIp("203.0.113.24"));

    const res = await post(VALID, { "x-forwarded-for": "203.0.113.24", "x-real-ip": "198.51.100.1", "cf-connecting-ip": "192.0.2.1" });

    expect(res.status).toBe(429);
  });

  it("malformed or missing forwarded headers fall into the shared unresolved bucket, not a fresh one each time", async () => {
    const cap = CONTACT_LIMIT() * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;
    for (let i = 0; i < cap; i++) {
      const res = await post(VALID, i % 2 ? {} : fromIp("not-an-ip"));
      expect(res.status).toBe(200);
    }

    expect((await post(VALID, fromIp("still-not-an-ip"))).status).toBe(429);
  });

  it("resets after the 10-minute window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      for (let i = 0; i < 3; i++) await post(VALID, fromIp("203.0.113.25"));
      expect((await post(VALID, fromIp("203.0.113.25"))).status).toBe(429);

      vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));

      expect((await post(VALID, fromIp("203.0.113.25"))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rate limiting — default policy (TRUSTED_PROXY_HOPS unset): no header is trusted", () => {
  it("every request shares one site-wide bucket with a raised cap; spoofed headers cannot escape it", async () => {
    const cap = CONTACT_LIMIT() * UNRESOLVED_CLIENT_LIMIT_MULTIPLIER;
    for (let i = 0; i < cap; i++) {
      const res = await post(VALID, { "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `198.51.100.${i}` });
      expect(res.status).toBe(200);
    }

    const over = await post(VALID, { "x-forwarded-for": "203.0.113.251" });
    expect(over.status).toBe(429);
  });
});

function CONTACT_LIMIT() {
  return 3;
}
