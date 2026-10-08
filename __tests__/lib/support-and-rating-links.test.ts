// Settings -> Help "Feedback & support" and "Rate the Android app": destinations, accessibility, fallbacks and what is never sent.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readFileSync } from "fs";
import path from "path";

import { RateAppRow, SupportPanel, SupportRow } from "@/components/settings/SupportPanel";
import { PLAY_STORE_APP_ID, isAndroidUserAgent, playStoreListingUrl } from "@/lib/app-links";
import { CONTACT_INFO } from "@/lib/content";
import { SUPPORT_BODY, SUPPORT_SUBJECT, buildSupportMailto, copyText, resolveSupportEmail } from "@/lib/support-contact";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("support destination", () => {
  it("is the business address already published on the public site, for the primary gym only", () => {
    expect(resolveSupportEmail(null)).toBe(CONTACT_INFO.email);
    expect(resolveSupportEmail(undefined)).toBe(CONTACT_INFO.email);
    expect(CONTACT_INFO.email).toBe("info@sandccoaching.com");
  });

  it("is withheld from a member of any other gym, whose own contact address has never been verified", () => {
    expect(resolveSupportEmail("gym-b")).toBeNull();
    expect(resolveSupportEmail("any-other-gym-id")).toBeNull();
  });

  it("is wired from the session user's own gym on the Settings page, not from request input", () => {
    const page = readFileSync(path.join(process.cwd(), "app/(dashboard)/dashboard/settings/page.tsx"), "utf8");
    expect(page).toContain("resolveSupportEmail(user.gymId)");
    expect(page).not.toMatch(/searchParams|request\./);
  });
});

describe("mailto link", () => {
  it("opens a new message to the support address with a fixed subject and a neutral starting body", () => {
    const href = buildSupportMailto("info@sandccoaching.com");
    expect(href.startsWith("mailto:info@sandccoaching.com?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("subject")).toBe(SUPPORT_SUBJECT);
    expect(params.get("body")).toBe(SUPPORT_BODY);
  });

  it("puts no account, tenant, payment or device data into the message", () => {
    const href = decodeURIComponent(buildSupportMailto("info@sandccoaching.com")).toLowerCase();
    for (const forbidden of ["userid", "user id", "gymid", "tenant", "subscription", "stripe", "token", "session", "password:", "@example", "navigator"]) {
      expect(href).not.toContain(forbidden);
    }
    // The only mention of secrets is the instruction not to send them.
    expect(SUPPORT_BODY).toMatch(/don't include your password or card details/);
  });
});

describe("support row", () => {
  const html = render(createElement(SupportRow, { email: "info@sandccoaching.com" }));

  it("renders an Email us link to the destination, with an accessible name", () => {
    expect(html).toContain(`href="${buildSupportMailto("info@sandccoaching.com").replace(/&/g, "&amp;").replace(/'/g, "&#x27;")}"`);
    expect(html).toContain('aria-label="Email S&amp;C support"');
    expect(html).toContain(">Email us<");
  });

  it("shows the address and a Copy address button as the fallback for a device with no mail app", () => {
    expect(html).toContain("info@sandccoaching.com");
    expect(html).toContain(">Copy address<");
    expect(html).toContain('type="button"');
  });

  it("has a polite live region for the copy result, empty until something happens", () => {
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).not.toContain("Address copied.");
  });

  it("gives touch-sized controls", () => {
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("copy fallback", () => {
  it("reports copied when the clipboard accepts the text", async () => {
    const written: string[] = [];
    expect(await copyText({ writeText: async (t) => void written.push(t) }, "info@sandccoaching.com")).toBe("copied");
    expect(written).toEqual(["info@sandccoaching.com"]);
  });

  it("reports unavailable, and never throws, when there is no clipboard or it refuses", async () => {
    expect(await copyText(undefined, "x")).toBe("unavailable");
    expect(await copyText(null, "x")).toBe("unavailable");
    expect(await copyText({}, "x")).toBe("unavailable");
    expect(await copyText({ writeText: async () => { throw new Error("denied"); } }, "x")).toBe("unavailable");
  });
});

describe("panel visibility", () => {
  it("renders the support row when there is a verified address (server render: no Android browser)", () => {
    const html = render(createElement(SupportPanel, { supportEmail: "info@sandccoaching.com" }));
    expect(html).toContain('data-testid="support-row"');
    expect(html).not.toContain('data-testid="rate-row"');
  });

  it("renders nothing for a member with no verified support address", () => {
    expect(render(createElement(SupportPanel, { supportEmail: null }))).toBe("");
  });
});

describe("Google Play rating link", () => {
  it("uses the exact application ID from the mobile app config and links to the public listing page", () => {
    expect(PLAY_STORE_APP_ID).toBe("com.sandcperformancecoaching.app");
    expect(playStoreListingUrl()).toBe("https://play.google.com/store/apps/details?id=com.sandcperformancecoaching.app");
  });

  it("matches the Android package declared in the mobile app config when that repo is checked out beside this one", () => {
    let appJson: string;
    try {
      appJson = readFileSync(path.join(process.cwd(), "..", "sc-coaching-mobile", "app.json"), "utf8");
    } catch {
      return; // CI checks out this repo alone; the constant above is pinned by the previous test.
    }
    expect(JSON.parse(appJson).expo.android.package).toBe(PLAY_STORE_APP_ID);
  });

  it("is a user-initiated link that opens safely in a new tab and says so, with no in-app review claim", () => {
    const html = render(createElement(RateAppRow));
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=com.sandcperformancecoaching.app"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Rate S&amp;C Performance Coaching on Google Play (opens in a new tab)"');
    expect(html).toContain("Rate on Google Play");
    expect(html.toLowerCase()).not.toMatch(/in-app review|review api|requestreview/);
  });

  it("is offered to Android browsers only", () => {
    expect(isAndroidUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36")).toBe(true);
    expect(isAndroidUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe(false);
    expect(isAndroidUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
    expect(isAndroidUserAgent("Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) Edge/15")).toBe(false);
    expect(isAndroidUserAgent("")).toBe(false);
    expect(isAndroidUserAgent(null)).toBe(false);
  });
});
