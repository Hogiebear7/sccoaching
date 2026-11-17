import { beforeAll, describe, expect, it } from "vitest";

import { BUSINESS_ADDRESS, journeyEmail, membershipEndedEmail, paymentFailedEmail } from "@/lib/comms-copy";
import { APP_STEPS, GYM_STEPS, journeyFor, nextDueStep } from "@/lib/comms-journeys";
import { effectivePrefs, setTopic, unsubscribe, unsubscribeToken, verifyUnsubscribeToken } from "@/lib/comms-prefs";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-comms-tests-0123456789";
});

describe("email preferences", () => {
  it("defaults: tips on, marketing off with no consent record", () => {
    expect(effectivePrefs(null)).toEqual({ tips: true, marketing: false, marketingConsentAt: null, marketingConsentSource: null });
  });
  it("opting in to marketing records when and where; unsubscribing keeps the proof but switches it off", () => {
    const on = setTopic(null, "marketing", true, "signup-web", new Date("2026-11-17T10:00:00Z"));
    expect(on).toMatchObject({ marketing: true, marketingConsentAt: "2026-11-17T10:00:00.000Z", marketingConsentSource: "signup-web" });
    const off = unsubscribe(on, "marketing");
    expect(off.marketing).toBe(false);
    expect(off.marketingConsentSource).toBe("signup-web");
  });
  it("'all' switches both optional topics off", () => {
    expect(unsubscribe(setTopic(null, "marketing", true, "x"), "all")).toMatchObject({ tips: false, marketing: false });
  });
});

describe("unsubscribe links", () => {
  it("round-trips, and rejects tampering", () => {
    const t = unsubscribeToken("user-1", "tips");
    expect(verifyUnsubscribeToken(t)).toEqual({ userId: "user-1", topic: "tips" });
    const forged = Buffer.from("user-2.tips." + "0".repeat(64), "utf8").toString("base64url");
    expect(verifyUnsubscribeToken(forged)).toBeNull();
    const swapped = Buffer.from(Buffer.from(t, "base64url").toString("utf8").replace(".tips.", ".all."), "utf8").toString("base64url");
    expect(verifyUnsubscribeToken(swapped)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });
});

describe("journeys", () => {
  const start = "2026-11-17T09:00:00Z";
  it("a gym membership always picks the gym journey", () => {
    expect(journeyFor({ gymMembership: true, digital: true })).toBe("gym");
    expect(journeyFor({ gymMembership: false, digital: true })).toBe("app");
    expect(journeyFor({ gymMembership: false, digital: false })).toBe("app");
  });
  it("sends the welcome straight away, then one step at a time as days pass", () => {
    const sent = new Set<string>();
    expect(nextDueStep({ journey: "app", startedAtISO: start, now: new Date("2026-11-17T09:30:00Z"), sent })?.id).toBe("app-welcome");
    sent.add("app-welcome");
    expect(nextDueStep({ journey: "app", startedAtISO: start, now: new Date("2026-11-17T20:00:00Z"), sent })).toBeNull();
    expect(nextDueStep({ journey: "app", startedAtISO: start, now: new Date("2026-11-18T10:00:00Z"), sent })?.id).toBe("app-how-it-works");
  });
  it("drops a step that is missed by too long rather than sending it late", () => {
    expect(nextDueStep({ journey: "app", startedAtISO: start, now: new Date("2026-12-10T09:00:00Z"), sent: new Set() })).toBeNull();
  });
  it("never returns two steps at once", () => {
    const step = nextDueStep({ journey: "gym", startedAtISO: start, now: new Date("2026-11-22T10:00:00Z"), sent: new Set(["gym-welcome", "gym-booking"]) });
    expect(step?.id).toBe("gym-anything-we-should-know");
  });
});

describe("email copy", () => {
  const ctx = { name: "Mary Murphy", unsubscribeUrl: "https://x.test/unsubscribe?t=abc", parqOn: false };
  it("every step renders with the business address and an unsubscribe link", () => {
    for (const s of [...APP_STEPS, ...GYM_STEPS]) {
      const e = journeyEmail(s.id, ctx)!;
      expect(e, s.id).toBeTruthy();
      expect(e.subject.length).toBeGreaterThan(5);
      expect(e.text).toContain(BUSINESS_ADDRESS);
      expect(e.text).toContain(ctx.unsubscribeUrl);
      expect(e.html).toContain("Hi Mary,");
      expect(e.html).toContain(BUSINESS_ADDRESS);
    }
    expect(journeyEmail("nope", ctx)).toBeNull();
  });
  it("only mentions the health check when it is switched on", () => {
    expect(journeyEmail("gym-welcome", ctx)!.text).not.toContain("health check");
    expect(journeyEmail("gym-welcome", { ...ctx, parqOn: true })!.text).toContain("health check");
  });
  it("escapes the member's name in html", () => {
    expect(journeyEmail("app-welcome", { ...ctx, name: "<b>x</b>" })!.html).not.toContain("<b>x</b>");
  });
  it("payment emails have the address but no unsubscribe link", () => {
    for (const e of [paymentFailedEmail("Mary"), membershipEndedEmail("Mary")]) {
      expect(e.text).toContain(BUSINESS_ADDRESS);
      expect(e.text.toLowerCase()).not.toContain("unsubscribe");
    }
  });
});
