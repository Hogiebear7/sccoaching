import { defineConfig } from "@playwright/test";

import { BASE_URL, DATA_DIR, STATE_PATH, VISUAL_PORT } from "./e2e/visual-env";

// Visual regression config for the member-facing screens. Screenshots are
// deterministic: fixed viewports, reduced motion (which our design system
// honours by disabling entrance animations and count-ups), and animations
// frozen at capture time.
//
// The suite runs against its OWN server and datastore (see e2e/visual-env.ts
// and e2e/global-setup.ts): it never reuses a running dev server, and it fixes
// the three things that would otherwise change the screens between machines:
//   - AI is unconfigured (no key), so Messages shows its "AI coach unavailable" state;
//   - Stripe is unconfigured, so Membership shows its "online payment isn't set up" state;
//   - the demo member's data and billing date are seeded and fixed.
// None of this changes production behaviour: it only sets environment
// variables for the test server this config starts. To run it, stop any dev
// server first (Next allows one `next dev` per project folder).
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    storageState: STATE_PATH,
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
    command: `npm run dev -- -p ${VISUAL_PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      DATA_DIR,
      SESSION_SECRET: "visual-suite-session-secret-not-for-production",
      // An empty value is "set", so a developer's .env.local cannot fill it in. The app treats it as not configured.
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      REVOLUT_SECRET_KEY: "",
      REVOLUT_WEBHOOK_SIGNING_SECRET: "",
      RESEND_API_KEY: "",
      SANDC_APP_CONFIG: "",
      GOOGLE_PLAY_IAP_ENABLED: "",
      PUSH_ENABLED: "false",
      CRON_SECRET: "",
    },
  },
});
