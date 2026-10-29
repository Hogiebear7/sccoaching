# Paywall plan (stage B), 2026-10-27

**Status: proposal for owner approval. Nothing here has been built, deployed or configured in either store.**

## Status, 2026-10-29

**Live server:** branch `redesign/index-html-blueprint`, everything from `stageb/server-merge`. B1 to B3 are live; B4 is done for Google; B5 is done for Google except the AI pause check.

**Google Play (done, tested on the live server):**
- Subscription `app_subscription_tier2` with base plans `monthly` (€12.99) and `yearly` (€119.99), offers `monthly-trial-7d` and `yearly-trial-7d`, in Ireland, the UK, the US, Canada, Australia, New Zealand and South Africa. A first base plan `annual` was created with a monthly billing period by mistake; it is deactivated and its ID can never be reused.
- Cloud project `sandc-play-sandbox`, service account `play-billing`, Pub/Sub topic `play-rtdn` with push subscription `play-rtdn-push` (expiry: never).
- Hostinger: the Google settings, the euro budgets, and `GOOGLE_PLAY_IAP_ENABLED=true`. Safe before launch, because only internal-testing builds (91 on) have the purchase screen.
- Tested with a licence tester: purchase, trial, renewals, acknowledgement, cancel and expiry, restore on a second device and on the website, notifications.
- Two bugs found and fixed live: acknowledgement went to `subscriptionsv2` (404, so Google refunded every purchase; now `purchases.subscriptions/{productId}`), and the datastore refused a save a second after another one because the host's scanner moves the file's ctime (the write check no longer compares ctime).

**Apple:** Paid Apps Agreement processing (bank and tax forms done 2026-10-29); the Digital Services Act review is separate. Products, keys and notifications follow once the agreement is Active.

**Builds:** Android 93 (internal testing, staff screens and member lists); iOS 10 in TestFlight. Android builds come from the hogiebear777 EAS project with the Play upload key copied from sandcmails-team (SHA-1 `99:BF:CE…DA:E0`); iOS builds from sandcmails-team.

**Left for B6:** Apple set-up and sandbox tests; a production release on Play with the store listing and Data safety updated; App Review with the subscriptions.

## Owner decisions this plan follows

| | Free | App subscription | Gym membership |
| --- | --- | --- | --- |
| How it's obtained | Download the app | In-app purchase only (Google Play, App Store). €12.99/month or €119.99/year (changed 2026-10-28 from €11.99 / €99.99), 7-day free trial on both | Bought on the website (in-person gym) |
| What it includes | Basic workout logging; food, weight and water logging; daily check-in; basic Community | Everything in the app, including AI within an allowance | Class booking, plus **direct coach messaging**. It does **not** include the app subscription |
| AI | None | €3.00 per rolling 30 days; €0.75 for the whole trial | None, unless staff grant the app subscription |

- **Staff can grant the app subscription as complimentary access** to anyone, with an optional end date and a note, from the website and the mobile app. A grant never touches store billing. This is allowed under Apple's multiplatform rule (3.1.3(b)) and Google's equivalent, because the same subscription is on sale in the app. The app never tells anyone to buy it elsewhere.
- **Everything the owner sees is in euros.** Anthropic bills in US dollars, so each request's cost is computed in USD from the reported tokens and converted at a configurable, deliberately conservative rate. Allowances, pools, alerts and reports are all set and shown in EUR.
- **Nothing that costs the owner money is on Free.** The unavoidable exceptions are hosting, account emails and push notifications, at fractions of a cent per user.
- **Saved decisions carried over:**
  - prices come from the store, not hard-coded;
  - markets: IE, UK, US, CA, AU, NZ and ZA;
  - annual shown as best value, with the full charge clear;
  - no six-month plan;
  - Family Sharing off;
  - product name "S&C Coaching App Subscription".

### Free-tier limits

| Feature | Free | App subscription |
| --- | --- | --- |
| Exercise library while logging; rest timer; plate calculator | Yes | Yes |
| Saved workouts / templates | Up to 3 | Unlimited |
| Programmes and the weekly training planner | Locked | Yes |
| Custom foods (barcode not found) | Yes; needed for basic logging | Yes |
| Saved meals / favourites | Up to 5 | Unlimited |
| Calorie and macro targets, the weekly budget and "Why this number?" | Locked | Yes |
| Trends, progress charts, personal-best history | Last 7 days | Full |
| Cycle-phase training guidance | Locked | Yes |
| Pregnancy and menopause **safety** guidance | **Yes**: safety information stays free | Yes |
| Every AI feature: AI coach, food from photo/label/description, receipts, meal ideas, What can I make, programme generation, workout reviews, check-ins | Locked | Yes, within the allowance |
| Community: feed, likes, comments, follows | Yes | Yes |
| Community leaderboards and highlights | Locked | Yes |
| Coach messaging | Gym membership only | Gym membership only |

## What already exists, and where

Built and tested in October; not yet on the live site:

- **Server** (`release/launch-2026-10-digital`, `08475ba`):
  - digital entitlements kept separate from the gym membership (store subscription, trial or staff grant);
  - Google Play and Apple purchase verification, notifications and reconciliation;
  - trials claimed server-side;
  - the AI allowance with atomic metering;
  - per-member groups (free, trial, paid, complimentary);
  - shared pools (trial, paid, complimentary, staff) and an emergency ceiling;
  - a kill switch.

  It was held back only because it needed the datastore fix, which went live today (`3c614eb`).
- **App** (`release/launch-2026-10-digital`, `021937a`):
  - the subscribe screen;
  - a store-agnostic purchase controller using `expo-iap`;
  - a trial offer after sign-up;
  - copy showing the store's prices and trial terms;
  - tests.

Live today (`3c614eb`) has only the older single-row model, in which **a gym membership counts the same as the app subscription for every locked feature**. Gym members therefore currently get everything, including AI.

## Slices

Each slice has its own approval, verification and report.

**B1. Server: bring the release branch onto live.**
- Merge `release/launch-2026-10-digital` onto `3c614eb` in a new branch.
- Keep the hardened datastore as it is live, because the release branch carries an older copy.
- Resolve conflicts with today's features: pregnancy, menopause, calories, cardio, watch data, the website restyle and the warning fix.
- Run the full suite, typecheck, build and the datastore rehearsal.
- No deploy.

**B2. Server: apply the decisions above.**
- Membership grants booking and coach messaging only. App features need a live digital entitlement.
- Euro budgets: replace the `AI_*_USD` settings with `AI_*_EUR`, plus `AI_USD_PER_EUR` (the conversion rate, set conservatively).
- Free AI €0. Every AI route refuses Free with an upgrade message (code `upgrade_required`), not an error.
- Free limits: 3 saved workouts, 5 saved meals, and the locks in the table above. They're enforced on the server, not just hidden in the app.
- Abuse protection on top of the allowance:
  - a daily cap of a third of the 30-day allowance;
  - a rate limit of 10 AI requests a minute per member;
  - maximum photo size and message length, and a cap on response length;
  - an email to the owner at 50% and 80% of the ceiling;
  - per-member AI pause and usage view for staff.
- Staff grant endpoints, shared by the website and the mobile app: grant or withdraw the app subscription, with an end date and a note, and an audit entry for each change.

**B3. App: bring the purchase flow in and match the decisions.**
- Merge the mobile release branch onto `integration/launch-blockers`.
- Paywall screens and lock badges following the table above, including the "3 of 3 saved workouts" and "5 of 5 saved meals" moments.
- A staff screen to set a member's app access. It also shows their AI usage this month.
- The native purchase library needs **new builds**: Android test, then iOS through TestFlight.

**B4. Store set-up (owner, with step-by-step guides from me).**
- One subscription group with two base plans (monthly and yearly), and a 7-day free-trial offer on each.
- **Google:**
  - real-time developer notifications (a Pub/Sub topic);
  - a service account for purchase verification;
  - licence testers.
- **Apple:**
  - the App Store Server Notifications URL;
  - an API key;
  - sandbox testers.
- Settings on Hostinger: store keys, the euro budgets and the conversion rate.
- **A monthly spending limit in your Anthropic console**, as the final backstop.

**B5. End-to-end testing.**
- On Play's internal track and on TestFlight with sandbox accounts:
  - buy, trial, convert, cancel, refund, restore;
  - switch between monthly and yearly;
  - a staff grant;
  - running out of the AI allowance;
  - the kill switch.

**B6. Launch.**
- Deploy the server (backup, then "push now").
- Upload the .aab and the iOS build.
- Submit both apps for review.

## Decisions needed before B2

1. **Current gym members.** Today they get every app feature. When B2 goes live, they drop to booking and coach messaging. Options:
   - **(a)** give everyone with a live membership on deploy day a complimentary app subscription, with no end date or for a set period such as 3 months;
   - **(b)** let them drop, and grant individually.

   Recommendation: (a) with an end date, so nobody loses features overnight without notice.
2. **The euro numbers.** Proposed starting values, all per rolling 30 days unless noted:

   | Setting | Proposed |
   | --- | --- |
   | Per member: Free | €0 |
   | Per member: Trial (whole trial) | €0.75 |
   | Per member: Paid | €3.00 |
   | Per member: Complimentary | €3.00 |
   | Pool: trials | €20 |
   | Pool: paid | €60 (raise as subscribers grow) |
   | Pool: complimentary | €30 |
   | Pool: staff features | €10 |
   | Emergency ceiling (all AI) | €120 |
   | Anthropic console hard limit | €150 |
   | USD per EUR (conservative) | 1.05 (today's rate is about 1.16; the lower figure leaves a margin) |

3. **History on Free.** Is "last 7 days" right for trends and personal-best history?

## Risks

- **B1 is a large merge:** two weeks of live features meet the release branch's rewrites of `lib/ai.ts`, the access rules and the Play service. It needs care; it isn't mechanical.
- **Apple's in-app purchase can only be fully tested** once the Paid Apps Agreement is active and the products exist.
- **New native builds** are needed before any purchase can be tried on a phone.
