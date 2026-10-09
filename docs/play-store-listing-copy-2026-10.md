# Play Store listing: proposed copy and screenshots (2026-10)

**Draft only. Nothing here was published, and Play Console was not touched.** It refines the earlier draft in
`sc-coaching-mobile/docs/play-store-submission.md` (not modified) in response to the tester report's request for a stronger listing, using only
features that exist in the app's source.

## Read this first: what the copy is checked against

- Every feature below was checked against the **source** of the mobile app (`sc-coaching-mobile`, screens under `src/app`, Android
  `versionCode` 69 at the time of writing) and the member web app. **I could not verify what is in the build currently live on Google Play**
  (that needs Play Console access, which this work does not have). **Before publishing, the owner confirms each line against the deployed
  build.** Lines whose presence in the live build is uncertain are marked **[confirm in live build]**.
- Google Play subscriptions (the App Subscription tier) are **not live**. `GOOGLE_PLAY_IAP_ENABLED` is off and the app has no purchase flow.
  The copy therefore makes no claim about buying, subscribing, pricing, trials or cancelling in the app. See "Claims not to make" below.
- No outcome is promised. Training and nutrition tools are described as tools.

## Short description (80 characters maximum)

Recommended (72 characters):

```
Log training, nutrition and recovery, and stay in touch with your coach.
```

Alternatives (71 and 74 characters):

```
Workout logging, nutrition and recovery tracking, plus coach messaging.
Training, nutrition and recovery tracking, with your coach in your pocket.
```

## Full description

```
S&C Performance Coaching is a training, nutrition and recovery app built around real coaching, not a generic tracker.

Log your sessions, track what you eat, check in on how you are recovering, and stay connected with your coach, all in one place. Members of S&C Performance Coaching in Navan, Co. Meath can also book and manage in-person classes in the app.

TRAINING
• Log every set: weight, reps and RIR, with supersets and drop sets
• Follow a programme your coach sets up for you, or log sessions freely
• Rest timer and plate calculator
• See your progress for each exercise over time
• Personal bests and recent records

NUTRITION
• Log food by search, barcode scan, a photo of the label, or by describing it
• Review what the app reads from a photo or description before anything is saved
• Daily calorie and macro targets with a clear breakdown
• Body weight check-ins with a trend chart
• Drink calculator for training sessions

RECOVERY
• Daily readiness check-in: sleep, soreness and fatigue, with a score and guidance for the day
• Optional cycle tracking, off by default and private unless you choose to share with your coach
• 7-day training load and readiness trends

YOUR COACH
• Message your coach directly
• Browse and book classes, and manage your bookings
• See your plan and membership status

Some features depend on your plan and on what your coach has switched on for you. Cycle tracking is educational and is not medical advice.
```

Notes on the draft:
- "Review ... before anything is saved" is true of the photo and describe-food flows in the source (editable cards, nothing saved until
  confirmed). "Photo of the label" and "describing it" are AI-assisted; the sentence does not say "AI" to avoid overpromising accuracy.
  The owner may add "AI-assisted" if comfortable with it.
- The unverified experience-duration claim was intentionally omitted from the store listing.
- The earlier draft also lists "Manage your membership". Membership is bought on the website, not in the app, so this draft says "See your
  plan and membership status", which is what the app does.
- **Community** (wins, leaderboards, feed) exists in the source but the tester report asked for community features, which suggests it may not be in
  the build they used. **Do not add a Community section until the live build is confirmed to include it [confirm in live build].** If it is
  live, a truthful line would be: "Community: celebrate wins and see how you rank, with privacy controls you choose."
- The walkthrough ("take a tour") exists in the mobile source; mention it only if confirmed live.

## Feature bullets (for the listing's "what's new" or a graphic)

- Set-by-set workout logging with rest timer and plate calculator
- Food logging by search, barcode, label photo or description
- Daily readiness check-in with simple guidance
- Progress trends for training, readiness and body weight
- Message your coach and book classes in one app

## Screenshot sequence and captions

Play requires 2 to 8 screenshots (JPEG or 24-bit PNG without alpha, each side 320 to 3840 px, aspect ratio between 16:9 and 9:16). Capture
them from a **real device or emulator running the build that is live**, not a web preview, using a **test account with realistic but entirely
fake data**: no real member names, photos, messages or emails. Keep the status bar clean (no notifications, full battery).

| # | Screen to capture | Suggested caption (short) | Why it is first-class |
| --- | --- | --- | --- |
| 1 | Workouts tab (this week, programme or recent sessions) | Plan and follow your training | Leads with the core job |
| 2 | Log workout (sets, reps, rest timer) | Log every set in seconds | Shows the daily action |
| 3 | Nutrition tab (macro ring, targets) and, as a second frame, Recovery (readiness score) | Track nutrition and recovery | Only if both are in the live build **[confirm in live build]** |
| 4 | Progress chart for one exercise, then Messages with a coach reply | See progress. Stay in touch with your coach | Coaching interaction is the differentiator |
| 5 | The brand feature-graphic style (navy and gold) with the one-line value proposition | Training, nutrition and recovery, coached | Closing frame with a clear call to action |

Call to action wording for frame 5 or the listing: "Get the app and train with your coach." Avoid "Subscribe", "Upgrade", "Unlock", "Free
trial" and any price.

The existing graphic assets (`sc-coaching-mobile/store-assets/hi-res-icon-512.png`, `feature-graphic-1024x500.png`) are already production
files; this work did not change or re-export them.

## Claims not to make until Google Play in-app purchase is live

None of these are true today. Keep every one out of the listing, screenshots and in-app text until the IAP work is enabled, verified end to end and
the owner decisions in `docs/iap-implementation-status-2026-10.md` are settled:

- "Subscribe in the app", "Upgrade", "Unlock premium", "Pro", or any mention of an App Subscription or Google Play subscription
- Any price, billing period, free trial, introductory offer or discount
- "Cancel anytime in Google Play" or any statement about managing a subscription in Google Play
- That membership can be bought, renewed or changed inside the Android app (membership is bought on the website)
- Any statement that features are "free" versus "paid" by plan, until plan rules for Android are final

If the owner later enables IAP, add such lines in a new revision, marked "future" until the day it is live.

## Other claims to avoid

- Guaranteed or typical results (strength, fat loss, performance), "clinically proven", "the best", "number one"
- Medical, diagnostic or treatment claims, especially for cycle tracking and nutrition
- "AI coach replaces your coach" or any implication the AI is a qualified professional
- Anything about locations, coaches or classes beyond S&C Performance Coaching in Navan, Co. Meath, until the platform is live for other gyms
- Awards, ratings, user counts or testimonials that are not documented

## ASO notes (no unsupported SEO claims)

- Keep the first 80 characters and the first lines of the full description in plain language that matches how members describe the app:
  "workout tracker", "nutrition tracker", "recovery", "personal training". Do not stuff keywords or repeat them unnaturally.
- Category: Health & Fitness. Suggested tags (from the earlier draft): fitness, workout tracker, personal training, nutrition tracking, recovery.
- Contact details for the listing come from the existing public contact: `info@sandccoaching.com`, `https://sandccoaching.com`, privacy policy at
  `https://sandccoaching.com/privacy`.
- **Data Safety:** this copy adds no tracking or analytics. If analytics or crash reporting is added later, the Data Safety form and the privacy
  policy must be updated first.

## Owner checklist before publishing

1. Confirm each line against the live Android build (especially Community, the walkthrough, photo/describe food logging, programmes).
2. The unverified experience-duration claim was intentionally omitted from the store listing.
3. Capture screenshots from a real device with fake data; check them for personal information.
4. Confirm the support address is monitored.
5. Enter the text in Play Console yourself. This work does not publish.
