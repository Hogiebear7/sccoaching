import { defineConfig } from "@playwright/test";

// Visual regression config for the member-facing screens. Screenshots are
// deterministic: fixed viewports, reduced motion (which our design system
// honours by disabling entrance animations and count-ups), and animations
// frozen at capture time.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      // Sub-pixel anti-aliasing wiggle only; anything visible fails.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
