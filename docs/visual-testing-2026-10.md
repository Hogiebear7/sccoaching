# Visual testing (2026-10)

`npm run test:visual` (Playwright, `e2e/visual.spec.ts`) screenshots five member screens on a phone viewport and the dashboard on desktop, and compares them
with committed baselines in `e2e/visual.spec.ts-snapshots/`. This note records how it is made deterministic and how to regenerate the baselines.

## What makes it deterministic
The suite runs against **its own test server and datastore**, started by `playwright.config.ts`. It never reuses a running server (stop any `next dev` first; Next
allows one per project folder) and never touches local data.

| Source of variation | How it is fixed (test-only; no production behaviour changes) |
| --- | --- |
| Datastore | A temporary folder (`os.tmpdir()/sandc-visual-data`), recreated and seeded by `e2e/global-setup.ts` with `scripts/seed.js`, aimed at it with `GYM_DB_PATH`. |
| Login rate limit (5 attempts per email per 15 minutes, in memory) | The demo member logs in **once** in global setup and the saved session is reused by every test. The production limit is untouched. |
| First-run walkthrough overlay | Global setup marks it seen through the app's own `/api/profile/tour` route. Each test also asserts no dialog is open. |
| AI | The test server runs with `ANTHROPIC_API_KEY` empty, so Messages shows "AI coach unavailable". The messages test asserts that text. |
| Stripe | The test server runs with the Stripe keys empty, so Membership shows "Online payment isn't set up yet". The membership test asserts that text. |
| Clock-dependent dates | The demo member's billing end date is set to the fixed day `2099-01-01` in the seeded datastore. Other dates stay masked as before (`.tabular-nums`, weekday names). |
| OS fonts and rendering | Baselines are per OS. The `-linux` set is generated and compared on a pinned `ubuntu-24.04` runner with Playwright's bundled Chromium. |

The server environment for those settings is set with empty strings, which count as "set", so a developer's `.env.local` cannot fill them back in. Only the test server
sees them.

No secret or provider credential is used anywhere in the suite. `.github/workflows/visual-suite.yml` reads no repository secret.

## Running it
- **Linux CI:** `.github/workflows/visual-suite.yml` runs on pull requests that touch `e2e/`, `app/`, `components/` or the config, and on demand. It is informational (not a
  required check).
- **Locally (Linux):** `npx playwright install chromium`, then `npm run test:visual`.
- **Locally (Windows/macOS):** the `-linux` baselines do not apply. Playwright reports a missing baseline for your OS; do not commit one generated there.

## Regenerating the Linux baselines
Only after confirming the changed screens are the **intended** UI:
1. Run the workflow manually with `update_snapshots` ticked (or the same command on a Linux machine: `npx playwright test --update-snapshots=all`).
2. Download the `visual-baselines-linux` artifact and **open every changed image**. A baseline records whatever the app rendered, including a bug.
3. Commit only images you have confirmed, and list each changed baseline and why in the pull request.

The workflow never commits and never updates baselines on a normal run.

## The older `-win32` baselines
They predate several intended UI changes (header logo, membership catalog card, nutrition sections) and are no longer maintained. They are left in place; a Windows run
will fail against them until someone regenerates them on Windows with the same review.
