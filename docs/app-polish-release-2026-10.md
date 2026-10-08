# App polish release: tester report triage (2026-10)

Baseline: `redesign/index-html-blueprint` at `dcbd0e0`. Scope: the highest-value, low-risk items from the tester report. Nothing here changes tenant,
authorization, payment, entitlement, schema, workflow or mobile code, and nothing was deployed or merged.

## Which codebase is which

- **gym-app (this repository)** is the Next.js backend and the member/staff **web** app. The "dashboard" routes are the member web app.
- **sc-coaching-mobile** is the separate Expo / React Native **Android (and iOS) app** the testers used from Google Play. It is out of scope
  for this work and was only read, never modified. Changes the tester report points at the Android app are therefore recorded below as follow-ups.

## Findings, item by item

| Tester recommendation | What the repositories already have | What this release did |
| --- | --- | --- |
| Lightweight new-user onboarding | **Both apps already have a skippable first-login tour.** Web: a 6-step dashboard walkthrough, per-account flag `dashboardTourCompleted`, replay in Settings -> Help. Android: a first-run "take a tour?" prompt plus a card the first time each tab is opened, stored per user on the device, with "Take app tour" in Settings. | Did **not** build a third flow. Hardened and tested the web one (PR "dashboard walkthrough"). Whether the testers' build included the Android tour cannot be verified from the repo. |
| Stronger Play Store screenshots and description | An earlier draft exists in `sc-coaching-mobile/docs/play-store-submission.md`. | New proposed copy, screenshot sequence and "claims not to make" list in `docs/play-store-listing-copy-2026-10.md`. Draft only. |
| Easier login and account recovery | Both apps have Forgot password and Reset password using the same endpoints. The web login page links to it. The flow is complete and safe. | **No code change.** Added a regression suite (PR "password recovery") that pins expiry, one-time use, hashing, non-enumeration and account preservation. |
| Dark / light / system theme | Web: theme and palette presets chosen in Settings -> Appearance. Android: `userInterfaceStyle` is `automatic`. | **Deferred.** Whether the tester meant something the apps do not yet do needs a follow-up question. |
| In-app feedback and rating entry | Web Settings has a trial-only bug-report form (to be deleted before full launch). The Android Settings screen has no feedback or rating row (read-only check). | Added **Feedback & support** (mailto) and an Android-only **Rate the app** link to web Settings -> Help (PR "settings support and rating"). Android equivalents are a follow-up. |
| Improved store description / ASO copy | As above. | See the store copy doc. |
| Feedback channels, tutorials/FAQs, performance monitoring, marketing, community | Community exists in the Android source. No analytics exists, by design (the Data Safety answers say none is collected). | **Deferred**, see below. |

## What shipped, by PR

| PR | Branch | Contents |
| --- | --- | --- |
| #72 | `feat/dashboard-tour-a11y-and-tests` | Focus management, Escape to skip, Tab trap, labelled dialog, Finish button, 44px controls; steps and rules in `lib/dashboard-tour.ts`; 20 tests including persistence through the real routes. Also clears two pre-existing lint errors in the component. |
| #73 | `feat/settings-support-and-rating` | `components/settings/SupportPanel.tsx`, `lib/support-contact.ts`, `lib/app-links.ts`, wired into Settings -> Help; 17 tests. Also clears one pre-existing lint error in `SettingsView.tsx`. |
| #74 | `test/password-recovery-regression` | 15 tests, no production code change. |
| this PR | `docs/app-polish-store-copy` | `docs/play-store-listing-copy-2026-10.md` and this document. |

## Behaviour reference

**Onboarding persistence (web).** One boolean on the member's own profile, `dashboardTourCompleted`, written by `POST /api/profile/tour`, which takes
the account from the session and ignores any user id in the body. Per account, so two members on one browser each get their own first run, and it
survives refresh and logout/login. It is never derived from tenant, payment or entitlement state and collects no personal data and no analytics.
Skip, Escape and Finish all mark it seen; Settings -> Help -> Replay marks it unseen again. Accounts created before the flag existed have no stored
value and are offered the tour once (skippable, never blocking).

**Feedback and support (web).** A mailto to `info@sandccoaching.com`, the business contact already published on the site, privacy policy and
terms, for **primary-gym members only**. The message carries a fixed subject and a neutral body and **no account, tenant, plan or payment data**. The
address is shown with a Copy address button, with a clear message if copying is not possible, as the fallback for a device with no mail app. Members
of other gyms see no support row, because a gym's own `contactEmail` is self-entered and unverified.

**Rating link (web).** A user-initiated link to
`https://play.google.com/store/apps/details?id=com.sandcperformancecoaching.app` (the Android package in the mobile app config), opening in a new tab with
`rel="noopener noreferrer"`, shown **only in Android browsers**. The product is not Android-only (web, and iOS builds exist), so a universal
"rate us" link would mislead. No in-app review API is used or claimed.

## Owner inputs required (not guessed)

1. **A verified support address per gym.** Today only the primary gym's published address is used. Other gyms get no support row until a verified
   per-gym address exists (for example confirmed at gym onboarding).
2. **Confirm `info@sandccoaching.com` is monitored** and is the intended destination for app feedback.
3. **Confirm the Google Play listing is public** for `com.sandcperformancecoaching.app`. If the app is still on a closed or internal track, the rating link
   resolves only for people with access.
4. **Confirm what the live Android build contains** (tour, Community, photo and describe food logging) before the store copy is used.
5. **Confirm or drop the "15+ years" claim** from the earlier store draft.

## Deferred follow-ups (recorded, not implemented)

| Item | Note |
| --- | --- |
| Dark / light / system theme | Presets exist on web and `automatic` on Android; clarify what the tester wanted before building. |
| Social login and Apple login | Out of scope. Needs a provider decision, account-linking rules and privacy review. App Store rules may require an equivalent privacy-preserving option (such as Sign in with Apple) once any other social login is offered on iOS. |
| Tutorial library / FAQs | Out of scope. The existing tours cover first run. |
| Community features | Out of scope; the source already has a Community area. Marketing of it waits for the live build to be confirmed. |
| Payment activation (Google Play IAP) | Out of scope and off. See `docs/iap-implementation-status-2026-10.md`. The store copy lists claims not to make until it is live. |
| Performance monitoring / analytics | Not added. There is no approved analytics pattern, and adding one changes the Data Safety form and privacy policy. Needs a privacy decision first. |
| Marketing | Out of scope. |

### Mobile follow-ups (sc-coaching-mobile, not touched here)

- Add **Feedback & support** and **Rate the app** rows to the Android Settings screen. Reuse the same destination (the existing `mailto:` pattern in
  `find-a-coach.tsx`) and, for rating, a link to the Play listing for the same application ID. No in-app review API is needed.
- Show a specific message for `other_provider_active` (existing follow-up in `docs/iap-low-severity-hardening-2026-10.md`).
- Decide whether the tour needs a lighter version for returning users.

### Authentication follow-up (separate, needs its own decision)

- A password reset does not revoke existing sessions, because sessions are stateless signed cookies (`lib/session.ts`). Revoking them needs a session
  version or similar, which touches authentication and was out of scope here.

## What was not changed

No tenant context, authorization, schema, payment record, webhook, migration, workflow, package, `sc-coaching-mobile`, `eas.json`, provider or
production configuration changed, and `GOOGLE_PLAY_IAP_ENABLED` is untouched. No analytics or tracking was added. No real data or credentials were
used; browser checks ran against an isolated server with a temporary datastore and a fake account.

## Release validation status (release candidate `2ec2a91`)

Recorded 2026-10-09 for `redesign/index-html-blueprint` at `2ec2a91282c27c2db76131c6dfa68f0cd904380c`, the merge of PRs #72 to #75. **Visual validation is
still pending.** Everything else listed here passed.

### Passed

| Check | Result |
| --- | --- |
| `git diff --check` | clean |
| ESLint on the 13 files this release changed | 0 problems |
| `tsc --noEmit` | clean |
| Focused app-polish tests (tour, support and rating, password recovery) | 4 files, 52 tests passed |
| Full test suite (unit and integration) | 217 files, 2848 tests passed |
| Production build (`next build --webpack`, isolated worktree, placeholder environment values) | succeeded |
| In-app browser checks, isolated dev server, temporary datastore, fake accounts | passed (below) |

The repository-wide ESLint run still reports 25 errors and 8 warnings in files outside this release; CI lints changed files only, and none of
the 13 changed files has a problem.

In-app browser checks (the Claude desktop app's built-in browser, not Playwright):

- **Onboarding:** shown on first login; focus enters the labelled dialog; Next, Back, Skip, Finish and Escape work; Tab and Shift+Tab stay inside the
  card; it does not return after refresh or after logout and login; a second account in the same browser gets its own first run; Replay in Settings shows
  it again; a member of a non-primary gym also sees it, so it does not depend on tenant, and it does not read payment or entitlement state.
- **Support:** the primary-gym member sees the row with a `mailto:info@sandccoaching.com` link, subject "S&C app feedback" and no account, tenant or
  payment data in the message; the non-primary-gym member sees no support row and no mailto anywhere; the Copy address fallback message and the visible
  address cover a device with no mail client.
- **Rating link:** shown only under an Android user agent, as a plain link to
  `https://play.google.com/store/apps/details?id=com.sandcperformancecoaching.app` with `target="_blank"` and `rel="noopener noreferrer"`, and no in-app
  review claim; absent on desktop. The iOS user-agent case could not be emulated in that browser and is covered by a unit test only. The link was not
  followed.
- **Password recovery:** covered by the 15-test regression suite (hashed tokens, 15-minute expiry, single use, identical answers for known and unknown
  emails, a weak password not consuming a valid token, account, tenant and payment records intact). Browser coverage of the reset screens was not part of
  these checks.

### Not run: Playwright visual validation

- **The Playwright visual suite (`e2e/visual.spec.ts`) has not been run, and nothing here claims it passed.**
- Chromium could not be installed on the validation machine. `npx playwright install chromium` failed on every attempt (six runs over two sessions)
  because Playwright's own downloader timed out requesting `https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-win64.zip`
  (`Request ... timed out`). `curl` could reach the same host, so the fault is in the Node downloader on that machine.
- Some of those attempts only changed how the same command connected to the same host (a longer connection timeout, the system certificate store,
  IPv4-first name resolution). None helped.
- **No workaround was used:** no manual download or unpacking of browser archives, no Playwright cache markers written, no mirror, no other browser
  engine. The app was not started for visual testing.
- **No snapshots were updated or created.**
- Visual validation remains pending on an approved environment.

To run it there, from the repository root, using isolated temporary data (set `DATA_DIR` to a new temporary directory), seeding only fake accounts, and
**never** passing `--update-snapshots`:

```
npx playwright install chromium
npx next dev --webpack -p 3000
npx playwright test
```

`npm run dev` uses Turbopack, which rejects a Windows junction in an isolated worktree, so start the server with the webpack command above. If any visual
test differs, classify it (product defect, environment difference or approved change) and report it before touching a baseline.

### Nothing else changed

No deployment, no IAP activation (`GOOGLE_PLAY_IAP_ENABLED` untouched), no provider contact, no production access, no secret access, no
`sc-coaching-mobile` or `eas.json` change, no payment, entitlement or tenant change, and no repository change beyond this note.
