// Outgoing webhooks: address safety, signing, sending, switching off a broken one, and that a broken receiver never reaches the caller. Real datastore for the gym record; fetch is a fake.
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMessage, isPrivateAddress, signWebhook, validateWebhookUrl, WEBHOOK_AUTO_DISABLE_AFTER } from "@/lib/gym-webhooks";
import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

describe("addresses", () => {
  it("accepts a normal https address", () => {
    expect(validateWebhookUrl("https://hooks.zapier.com/hooks/catch/123/abc/")).toMatchObject({ ok: true, host: "hooks.zapier.com" });
  });
  it("refuses http, credentials, odd ports, localhost, private networks and nonsense", () => {
    for (const bad of [
      "http://hooks.zapier.com/x", "https://user:pw@hooks.zapier.com/x", "https://hooks.zapier.com:8443/x", "https://localhost/x", "https://foo.localhost/x", "https://printer.local/x",
      "https://10.0.0.5/x", "https://192.168.1.1/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://metadata.google.internal/x",
      "ftp://x.test/x", "not a url", "", 5, "https://intranet/x",
    ]) {
      expect(validateWebhookUrl(bad as never).ok, String(bad)).toBe(false);
    }
  });
  it("knows private and public IP addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.0.9", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("signing", () => {
  it("is HMAC-SHA256 over 'timestamp.body' with the secret, as hex", () => {
    const body = JSON.stringify({ a: 1 });
    expect(signWebhook("whsec_x", "1700000000", body)).toBe(createHmac("sha256", "whsec_x").update(`1700000000.${body}`).digest("hex"));
    expect(signWebhook("whsec_y", "1700000000", body)).not.toBe(signWebhook("whsec_x", "1700000000", body));
  });
  it("a message has an id, a type, a time and its data", () => {
    const m = buildMessage("member.joined", { id: "u1" }, new Date("2026-12-01T10:00:00Z"));
    expect(m).toMatchObject({ type: "member.joined", createdAt: "2026-12-01T10:00:00.000Z", data: { id: "u1" } });
    expect(m.id).toMatch(/^evt_/);
  });
});

let fx: IapFixture;
const hook = (over: Record<string, unknown> = {}) => ({ id: "h1", url: "https://8.8.8.8/hook", events: ["booking.created"], secret: "whsec_test", enabled: true, createdAt: "2026-01-01T00:00:00Z", consecutiveFailures: 0, ...over });

function gymWith(webhooks: unknown[]) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", webhooks,
  } as never);
}
const wait = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("sending", () => {
  it("posts a signed message to a hook that wants the event, and records success", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("ok", { status: 200 }))));
    gymWith([hook(), hook({ id: "h2", events: ["member.joined"] }), hook({ id: "h3", enabled: false })]);
    const { emitGymEvent } = await import("@/lib/gym-webhooks");
    emitGymEvent({ id: GYM_B }, "booking.created", { bookingId: "b1" });
    await wait();

    expect(calls).toHaveLength(1); // only the hook that wants this event and is switched on
    const { init } = calls[0];
    const body = String(init.body);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-SC-Event"]).toBe("booking.created");
    expect(headers["X-SC-Signature"]).toBe(`sha256=${signWebhook("whsec_test", headers["X-SC-Timestamp"], body)}`);
    expect(JSON.parse(body)).toMatchObject({ type: "booking.created", data: { bookingId: "b1" } });
    expect(init.redirect).toBe("manual");
    expect(fx.db.findGymById(GYM_B)?.webhooks?.find((h) => h.id === "h1")).toMatchObject({ lastStatus: "ok", consecutiveFailures: 0 });
  });

  it("records a failure with a plain reason, and switches the hook off after repeated failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    gymWith([hook({ consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER - 1 })]);
    const { emitGymEvent } = await import("@/lib/gym-webhooks");
    emitGymEvent({ id: GYM_B }, "booking.created", {});
    await wait();
    const saved = fx.db.findGymById(GYM_B)?.webhooks?.[0];
    expect(saved).toMatchObject({ lastStatus: "failed", enabled: false, consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER });
    expect(saved?.lastError).toMatch(/error \(500\)/);
  });

  it("does not follow a redirect, and refuses a private address even if one was saved", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendWebhook, buildMessage: build } = await import("@/lib/gym-webhooks");
    const redirected = await sendWebhook({ url: "https://8.8.8.8/hook", secret: "s" }, build("test.ping", {}));
    expect(redirected).toMatchObject({ ok: false });
    expect((redirected as { error: string }).error).toMatch(/redirect/);
    const privateOne = await sendWebhook({ url: "https://10.0.0.5/hook", secret: "s" }, build("test.ping", {}));
    expect(privateOne.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private address was never called
  });

  it("never throws or delays the caller: a gym without hooks, a missing gym, a broken data function", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    gymWith([hook()]);
    const { emitGymEvent, emitUserEvent } = await import("@/lib/gym-webhooks");
    expect(() => emitGymEvent(null, "booking.created", {})).not.toThrow();
    expect(() => emitGymEvent({ id: "no-such" }, "booking.created", {})).not.toThrow();
    expect(() => emitGymEvent({ id: GYM_B }, "booking.created", () => { throw new Error("boom"); })).not.toThrow();
    expect(() => emitUserEvent({ gymId: "x" }, "member.joined", {})).not.toThrow();
  });
});
