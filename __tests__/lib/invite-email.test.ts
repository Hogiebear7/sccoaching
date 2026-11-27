import { describe, expect, it, vi } from "vitest";

const gyms = vi.hoisted(() => ({ findGymById: vi.fn() }));
vi.mock("@/lib/db", () => gyms);

import { inviteEmail } from "@/lib/email-templates";
import { inviteSenderFor } from "@/lib/invite-sender";

describe("invite email", () => {
  it("names the inviting gym and links to both stores and the invite", () => {
    const m = inviteEmail({ tier: "membership", inviteToken: "TOK", gymName: "Iron <Works> & Co" });
    expect(m.subject).toBe("Iron <Works> & Co has invited you");
    expect(m.html).toContain("Iron &lt;Works&gt; &amp; Co has invited you");
    expect(m.html).not.toContain("<Works>");
    expect(m.html).toContain("apps.apple.com/app/id");
    expect(m.html).toContain("play.google.com/store/apps/details?id=");
    expect(m.html).toContain("/invite?token=TOK");
    expect(m.text).toContain("App Store: https://apps.apple.com");
    expect(m.text).toContain("Google Play: https://play.google.com");
    expect(m.text).toContain("this email address");
  });
  it("defaults to S&C when no gym name is given", () => {
    expect(inviteEmail({ tier: "app_subscription", inviteToken: "T" }).subject).toBe("S&C Performance Coaching has invited you");
  });
});

describe("inviteSenderFor", () => {
  it("uses S&C and no reply-to for the primary gym", () => {
    expect(inviteSenderFor({ gymId: null })).toEqual({ gymName: "S&C Performance Coaching", replyTo: undefined });
  });
  it("uses a tenant gym's name and valid contact email as reply-to", () => {
    gyms.findGymById.mockReturnValue({ name: " Iron Works ", contactEmail: "hello@ironworks.test" });
    expect(inviteSenderFor({ gymId: "g1" })).toEqual({ gymName: "Iron Works", replyTo: "hello@ironworks.test" });
  });
  it("ignores a bad contact email and falls back to S&C when the gym is missing", () => {
    gyms.findGymById.mockReturnValue({ name: "X", contactEmail: "not-an-email" });
    expect(inviteSenderFor({ gymId: "g1" }).replyTo).toBeUndefined();
    gyms.findGymById.mockReturnValue(undefined);
    expect(inviteSenderFor({ gymId: "g1" }).gymName).toBe("S&C Performance Coaching");
  });
});
