import { test, expect, type Page } from "@playwright/test";

// Visual regression for the key member screens on the v7 "luminous mist"
// system. Baselines live in e2e/visual.spec.ts-snapshots/, one set per OS
// (the `-linux` set is the one GitHub Actions uses). After an INTENTIONAL
// design change, regenerate them on Linux (see docs/visual-testing-2026-10.md),
// review every changed image, and commit them; never accept a diff unseen.
//
// Determinism (see playwright.config.ts and e2e/global-setup.ts): the suite
// runs against its own server and datastore, signs in once and reuses that
// session, starts the demo member with the first-run walkthrough already seen,
// fixes the membership billing date, and runs with AI and Stripe unconfigured.
// The two assertions below state the unconfigured screens out loud, so a drift
// in that setup fails with a clear message rather than as a pixel diff.
//
// Dynamic content policy: reducedMotion freezes entrance animations and
// count-ups; the date chip and data-driven regions are masked so member
// data changing day-to-day doesn't fail the suite.

// Regions whose *content* is data/date-driven. The panels' shells still get
// compared; only the variable text inside is masked.
function masks(page: Page) {
  return [
    page.locator(".tabular-nums"),
    page.getByText(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*day\b/i),
    // Anything that shows today's date or the current week: the recovery check-in's date field, the "Recent days" dates, and the
    // "Training weeks" grid (its dots land in the weekday columns of the current week).
    page.locator('input[type="date"]'),
    page.getByText(/\b\d{4}-\d{2}-\d{2}\b/),
    page.locator(".surface-card").filter({ hasText: "Training weeks" }),
  ];
}

test.beforeEach(async ({ page }) => {
  // Freeze entrance animations/count-ups (the design system honours this)
  // and pin the color scheme — deterministic pixels across machines.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
});

const SCREENS: { name: string; path: string }[] = [
  { name: "home", path: "/dashboard" },
  { name: "recovery", path: "/dashboard/recovery" },
  { name: "nutrition", path: "/dashboard/nutrition" },
  { name: "messages", path: "/dashboard/messages" },
  { name: "membership", path: "/dashboard/membership" },
];

for (const screen of SCREENS) {
  test(`${screen.name} (mobile)`, async ({ page }) => {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle");
    // The first-run walkthrough must not be on screen (global-setup marks it seen).
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (screen.name === "messages") await expect(page.getByText("AI coach unavailable")).toBeVisible();
    if (screen.name === "membership") await expect(page.getByText(/Online payment isn.t set up yet/)).toBeVisible();
    await expect(page).toHaveScreenshot(`${screen.name}-mobile.png`, {
      fullPage: true,
      mask: masks(page),
    });
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("home (desktop)", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveScreenshot("home-desktop.png", {
      fullPage: false,
      mask: masks(page),
    });
  });
});
