// The public, no-login page Google Play asks for (a web link explaining how to delete an account and what is kept), and the policy text that points to it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DeleteAccountPage from "@/app/delete-account/page";
import PrivacyPolicyPage from "@/app/privacy/page";
import { selfDeletionBlock } from "@/lib/account-deletion";

describe("public account deletion page", () => {
  const html = renderToStaticMarkup(createElement(DeleteAccountPage));

  it("tells people how to delete in the app and on the website, with the exact path and confirmation word", () => {
    expect(html).toContain("Settings");
    expect(html).toContain("Delete account");
    expect(html).toContain("DELETE");
  });

  it("says what is deleted and what is kept, and gives an email route for someone who cannot sign in", () => {
    expect(html).toContain("What is deleted");
    expect(html).toContain("What we keep");
    expect(html).toContain("mailto:");
  });

  it("warns that a running paid subscription must be cancelled first, and that Google Play subscriptions are cancelled in Google Play", () => {
    expect(html).toMatch(/cancel it first/i);
    expect(html).toMatch(/only be cancelled in Google Play/i);
  });

  it("makes no claim about backup retention, which is not yet confirmed", () => {
    expect(html).not.toMatch(/backup/i);
  });
});

describe("privacy policy account deletion section", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPolicyPage));

  it("links to the public deletion page and no longer says there is no self-service delete", () => {
    expect(html).toContain('href="/delete-account"');
    expect(html).not.toContain("We don&#x27;t currently have a self-service delete");
    expect(html).not.toMatch(/don.t currently have a self-service\s*delete/i);
  });
});

describe("self-service deletion rules", () => {
  const sub = (over: Record<string, unknown>) => ({ userId: "u", provider: "stripe", status: "active", ...over }) as never;

  it("members with no subscription, a manual plan, or a cancelled paid plan may delete", () => {
    expect(selfDeletionBlock("member", undefined)).toBeNull();
    expect(selfDeletionBlock("member", sub({ provider: "none" }))).toBeNull();
    expect(selfDeletionBlock("member", sub({ status: "canceled" }))).toBeNull();
    expect(selfDeletionBlock("member", sub({ status: "inactive" }))).toBeNull();
  });

  it("live Stripe or Revolut subscriptions and in-flight checkouts block, staff roles are refused", () => {
    expect(selfDeletionBlock("member", sub({ status: "active" }))?.code).toBe("active_subscription");
    expect(selfDeletionBlock("member", sub({ provider: "revolut", status: "past_due" }))?.code).toBe("active_subscription");
    expect(selfDeletionBlock("member", sub({ status: "pending" }))?.code).toBe("payment_in_progress");
    for (const role of ["coach", "admin", "admin_manager"]) expect(selfDeletionBlock(role, undefined)?.code).toBe("staff_account");
  });
});

describe("policy pages disclose what the app actually does", () => {
  const privacy = renderToStaticMarkup(createElement(PrivacyPolicyPage));

  it("privacy policy covers optional location, Community activity and the place-search service", () => {
    expect(privacy).toContain("Location (optional)");
    expect(privacy).toContain("Community activity (optional)");
    expect(privacy).toContain("OpenStreetMap");
  });

  it("terms set community content rules and say how to raise a concern", async () => {
    const { default: TermsPage } = await import("@/app/terms/page");
    const terms = renderToStaticMarkup(createElement(TermsPage));
    expect(terms).toContain("Community content");
    expect(terms).toMatch(/report a comment/i);
    expect(terms).toContain("info@sandccoaching.com");
  });
});
