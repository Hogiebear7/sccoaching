import { test, expect, type Page } from "@playwright/test";

// Visual regression for the key member screens on the v7 "luminous mist"
// system. Baselines live in e2e/visual.spec.ts-snapshots/ — after an
// intentional design change, refresh them with:
//   npx playwright test --update-snapshots
//
// Dynamic content policy: reducedMotion freezes entrance animations and
// count-ups; the date chip and data-driven regions are masked so member
// data changing day-to-day doesn't fail the suite.

const DEMO = { email: "alex@demo.local", password: "Demo1234!" };

async function login(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: DEMO });
  if (!res.ok()) throw new Error(`demo login failed: ${res.status()}`);
}

// Regions whose *content* is data/date-driven. The panels' shells still get
// compared; only the variable text inside is masked.
function masks(page: Page) {
  return [
    page.locator(".tabular-nums"),
    page.getByText(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*day\b/i),
  ];
}

test.beforeEach(async ({ page }) => {
  // Freeze entrance animations/count-ups (the design system honours this)
  // and pin the color scheme — deterministic pixels across machines.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await login(page);
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
    await expect(page).toHaveScreenshot("home-desktop.png", {
      fullPage: false,
      mask: masks(page),
    });
  });
});
