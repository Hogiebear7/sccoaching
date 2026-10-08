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
5. The unverified experience-duration claim was intentionally omitted from the store listing.

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
