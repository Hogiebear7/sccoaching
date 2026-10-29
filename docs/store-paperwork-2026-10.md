# Store paperwork: App Store and Google Play (2026-10-27)

Answers and text to copy into App Store Connect and Play Console. Nothing here has been entered or submitted; you do that in each
console. This replaces the data and listing sections of `sc-coaching-mobile/docs/play-store-submission.md` (August) and
`docs/play-store-listing-copy-2026-10.md`. Since those were written the app has gained:

- in-app account deletion;
- Community, with block and report;
- AI features behind a consent switch;
- pregnancy and menopause support;
- watch data and cardio logging;
- the S&C gym page that links to the website for in-person memberships.

Everything below was checked against the app source (`sc-coaching-mobile`, build 89) and the live privacy policy
(`https://sandccoaching.com/privacy`, cleared by your solicitor).

**The paywall and trial are not live.** Until they are, no listing text, screenshot or review note may mention:

- prices, subscriptions, "Pro", "Upgrade" or "Unlock";
- free trials;
- buying digital plans in the app.

In-person memberships are bought on the website. The app may link to that page, because a physical gym service is allowed to use
outside payment (Apple guideline 3.1.3(e), and the equivalent Play policy).

---

## 1. Apple: App Privacy ("nutrition label")

App Store Connect → your app → App Privacy → Get Started.

- **Do you or your third-party partners collect data from this app?** Yes.
- **Tracking** (used for ads, or linked with data from other companies' apps or sites): **No** for every type. The app has no ads,
  no analytics and no advertising identifiers.
- For every type below choose **Linked to the user's identity: Yes** and **Used for tracking: No**.

| Apple category | Type | Collect? | Purpose to tick | Where it comes from |
| --- | --- | --- | --- | --- |
| Contact Info | Name | Yes | App Functionality | Sign-up, profile |
| Contact Info | Email Address | Yes | App Functionality | Sign-up, login, emails |
| Contact Info | Phone Number | Yes | App Functionality | Profile (contact and emergency contact) |
| Health & Fitness | Health | Yes | App Functionality | Recovery check-ins, cycle tracking, pregnancy and menopause, body weight, heart rate typed in from a watch |
| Health & Fitness | Fitness | Yes | App Functionality | Workouts, sets, cardio, personal bests, training load, food logs |
| Financial Info | Purchase History | Yes | App Functionality | Membership and class-pass status shown in the app (bought on the website) |
| Financial Info | Payment Info | **No** | | Card details only ever go to Stripe's hosted checkout on the website |
| Sensitive Info | Sensitive Info | Yes | App Functionality | Pregnancy information (Apple lists pregnancy as sensitive). Only if the member turns it on |
| User Content | Emails or Text Messages | Yes | App Functionality | Member ↔ coach messages |
| User Content | Photos or Videos | Yes | App Functionality | Food, label and receipt photos, profile picture, bug-report screenshots |
| User Content | Customer Support | Yes | App Functionality | Bug reports and "report a problem" text |
| User Content | Other User Content | Yes | App Functionality | Community posts, shared workouts and reactions |
| Identifiers | User ID | Yes | App Functionality | Account id |
| Other Data | Other Data Types | Yes | App Functionality | Date of birth and sex, used for calorie targets and guidance |

Answer **No** to:

- Location;
- Contacts;
- Browsing History;
- Search History;
- Usage Data;
- Diagnostics;
- Audio Data;
- Gameplay Content;
- Device ID;
- Sensitive Info other than pregnancy.

The push-notification token isn't an advertising or device identifier and doesn't need declaring. If you'd rather be cautious, add
Identifiers → Device ID for App Functionality; it does no harm.

**Third parties that process data for us** (all count as "collected by you", none as tracking):

- Hostinger (hosting);
- Supabase (database);
- Anthropic (AI features, only after the member allows them);
- Expo push service (notifications);
- Resend (email);
- Open Food Facts (barcode look-ups; only the barcode is sent);
- Stripe (website payments only).

**Privacy Policy URL:** `https://sandccoaching.com/privacy`

**Account deletion (guideline 5.1.1(v)):** members can delete their account in the app: More → Settings → Delete account. It's also
available on the web at `https://sandccoaching.com/delete-account`.

## 2. Google Play: Data safety

Play Console → App content → Data safety.

**Overview questions:**

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes**
- Which of the following methods of account creation does your app support? **Username and password** (plus "other" if staff
  invites count; they are email invites).
- Do you provide a way for users to request that their data is deleted? **Yes**
- Delete account URL: `https://sandccoaching.com/delete-account`

**Shared?** Answer **No** for every type. Play doesn't count sending data to a service provider that processes it for you as
"sharing". That covers Anthropic, Hostinger, Supabase, Expo, Resend and Stripe. Members choosing to post in Community is also not
"sharing", because the member starts that transfer themselves.

**Processed ephemerally?** **No** for all types.

**For every type, choose:**

- Required or optional: as listed below.
- Purposes: **App functionality** and **Account management** for account data. Add **Personalization** for date of birth and sex
  (calorie targets).

| Play category | Type | Collected | Required? |
| --- | --- | --- | --- |
| Personal info | Name | Yes | Required |
| Personal info | Email address | Yes | Required |
| Personal info | User IDs | Yes | Required |
| Personal info | Phone number | Yes | Optional |
| Personal info | Other info (date of birth, sex) | Yes | Optional |
| Financial info | Purchase history | Yes | Optional |
| Health and fitness | Health info | Yes | Optional (cycle, pregnancy and menopause are off unless turned on) |
| Health and fitness | Fitness info | Yes | Required |
| Messages | Other in-app messages | Yes | Optional |
| Photos and videos | Photos | Yes | Optional |
| App info and performance | Other app performance data (bug reports with screenshots) | Yes | Optional |

**Not collected:**

- Location;
- Contacts;
- Calendar;
- Audio;
- Files and docs;
- Web browsing;
- Device or other IDs;
- Crash logs;
- Diagnostics;
- Financial payment info.

**Check before you submit: location permission.** The app still contains an old "Find a coach" screen that used location. Nothing in
the app opens it now, so no location is collected. But the location library can still add a location permission to the Android
build. Open Play Console → your release → App bundle explorer → Permissions:

- if `ACCESS_FINE_LOCATION` or `ACCESS_COARSE_LOCATION` is listed, tell me, and I'll remove the library in the next build so the
  form stays true;
- if it isn't listed, there's nothing to do.

## 3. Age ratings

**Apple** (App Information → Age Rating):

| Question | Answer |
| --- | --- |
| Violence, sexual content, profanity, horror, gambling, contests | None |
| Alcohol, tobacco or drug use or references | None |
| Medical or treatment information | **Infrequent/Mild**. Pregnancy, menopause and cycle guidance is general health education, not treatment |
| Health or wellness topics | **Yes** |
| User-generated content | **Yes**. Community, with report and block |
| Messaging and chat | **Yes**. Member ↔ coach messages |
| Advertising | No |
| Unrestricted web access | No |
| Parental controls, age assurance | No |

Apple works out the rating from these answers. A rating around 13+ to 16+ is likely; accept what it gives.

**Google Play** (App content → Content rating, IARC questionnaire):

- Category: **Reference, News or Educational / Health & Fitness**, not a game.
- Violence, sexuality, language, controlled substances, gambling: **No**.
- Do users interact or exchange content? **Yes**: messages with their coach, and Community posts that other members can see.
- Does the app share the user's location with other users? **No**.
- Can users buy digital goods in the app? **No**, for now.

**Play → Target audience:** **18 and over**. The privacy policy says the app is not designed or marketed for children. Choose **No**
for "appeals to children".

## 4. App Store listing text

| Field | Text | Limit |
| --- | --- | --- |
| Name | S&C Performance Coaching | 30 |
| Subtitle | Training, food and recovery | 30 |
| Category | Primary: Health & Fitness · Secondary: Lifestyle | |
| Support URL | `https://sandccoaching.com/contact` | |
| Marketing URL | `https://sandccoaching.com` | |
| Copyright | 2026 S&C Performance Coaching | |

**Keywords** (100 characters, commas with no spaces, no words that are already in the name):

```
workout,gym,tracker,nutrition,calories,macros,recovery,readiness,strength,classes,cycle,log,fitness
```

**Promotional text** (170 characters; you can change it any time without a new review):

```
Log your training, hit calorie targets that move with your sessions, check your readiness and stay in touch with your coach, all in one app.
```

**Description:**

```
S&C Performance Coaching is a training, nutrition and recovery app built around real coaching, not a generic tracker.

Log your sessions, track what you eat, check in on how you're recovering and stay in touch with your coach, all in one place. If you train with S&C Performance Coaching in Navan, Co. Meath, you can book classes in the app too.

TRAINING
• Log every set: weight, reps and RIR, with supersets and drop sets
• Add cardio: runs, rows, bikes and more, with distance, time and level
• Add calories and heart rate from your watch after a session
• Follow a programme from your coach, or log freely
• Rest timer, plate calculator and personal bests

NUTRITION
• Log food by search, barcode, a photo of the label or by describing it
• Check what the app reads before anything is saved
• A daily calorie and macro target that takes your training into account, with a plain explanation of the number
• Body weight check-ins with a trend chart

RECOVERY
• A quick daily check-in for sleep, soreness and fatigue, with a readiness score and guidance for the day
• Optional cycle tracking, private unless you choose to share it with your coach
• Optional pregnancy and menopause support, with guidance based on HSE advice

COMMUNITY AND YOUR COACH
• Message your coach directly
• Share sessions and celebrate personal bests with other members, with block and report built in
• Browse and book classes and manage your bookings

AI features (food from a photo, meal ideas, workout reviews) only run after you switch them on, and you can turn them off at any time.

Health guidance in the app is general education and isn't medical advice. Talk to your GP, midwife or doctor about your own situation.
```

**What's New** (first version):

```
First release. Training, nutrition and recovery tracking, class booking and messaging with your coach.
```

**App Review information** (App Store Connect → the version → App Review Information):

- **Sign-in required: Yes.** Apple needs a working member account. Please create one yourself on the live site, for example
  `appreview@sandccoaching.com`, with:
  - an active membership;
  - a few logged workouts and meals.

  Enter its email and password there. I can't create accounts on the live site.
- **Notes:**

```
S&C Performance Coaching is the member app for an in-person strength and conditioning gym in Navan, Ireland.

In-person memberships and class passes are sold on our website. The "Our gym" page links there; these are physical services used at the gym (guideline 3.1.3(e)). No digital content or subscriptions are sold in the app.

Account deletion: More > Settings > Delete account.
AI features ask for consent the first time they are used and can be switched off in Settings.
Community posts can be reported and users blocked from the post menu; staff review reports.
```

## 5. Screenshots

**Ready**, in `sc-coaching-mobile/store-assets/2026-10/`:

- `apple-6.9/`: 7 images at 1320×2868, for the 6.9" slot. Apple scales them down for smaller iPhones.
- `play-phone/`: 7 images at 1080×1920.
- `play-feature-graphic-1024x500.png`.

**Still missing: the Train tab.** Your phone's account has almost no workouts in it, and I don't add made-up data to the live
account. It's optional; seven images are enough for both stores.

## 6. Your console checklist (needed before any in-app payments)

These take Apple's and Google's own checking time, often a day or more, so start them today. They are free.

**App Store Connect** (Business section):

1. **Paid Apps Agreement:** accept it. The Account Holder must do this.
2. **Bank account:** add the business IBAN for the payouts.
3. **Tax forms:** fill in the US tax form (W-8BEN for a sole trader, W-8BEN-E for a company). Add Irish VAT details if you're
   registered.
4. **EU trader status (Digital Services Act):** declare yourself a trader. Apple shows your address, phone and email on the EU
   listing. Without this, the app can't be published in the EU at all, so it matters even before payments.

**Play Console:**

5. **Payments profile:** Setup → Payments profile. Create or link a Google payments merchant account with bank details, and verify it.
6. **Monetisation:** add the tax and VAT details under the same payments profile.
7. **Check your account type.** Personal developer accounts created after November 2023 must run a **closed test with at least 12
   testers for 14 days in a row** before production access opens. If yours is a personal account, start that closed test as soon as
   the .aab is uploaded after 1 November. Organisation accounts don't need it.

Once both stores show the agreements as active, we can create the subscription products (the plan names and prices you choose) in
each console, ready for stage B.

---

## 7. Update, 2026-10-29: what changes when the App Subscription launches (B6)

Sections 1 to 6 describe the listing **before** the paywall. Keep them as they are until launch day; then change these.

**Checklist status (section 6):** Play's payments profile, tax and VAT are done, and the 15% service fee is enrolled. Apple's bank
account, Ireland tax questionnaire and W-8BEN are submitted (2026-10-29); the Paid Apps Agreement is processing; the Digital
Services Act declaration is in review.

**Listing text, both stores.** The ban on prices, subscriptions and trials lifts. Add, in plain words:
- "Free to download. The App Subscription (€12.99 a month or €119.99 a year, 7-day free trial for new subscribers) adds AI coaching,
  adaptive calorie and macro targets, programmes, full history and unlimited saved workouts and meals."
- "The App Subscription is separate from a gym Membership." Same wording as the app.
- Never "unlimited AI": AI features are subject to fair use.

**Data safety (Play) and App Privacy (Apple).** "Purchase history" now also covers the App Subscription bought in the app (store
purchase records kept to give access). It is already declared as collected, for app functionality, so only the description changes:
"Membership, class-pass and App Subscription status."

**App Review notes (Apple), replacing the second paragraph:**

```
In-person memberships and class passes are sold on our website. The "Our gym" page links there; these are physical services used at the gym (guideline 3.1.3(e)).

The App Subscription (digital features: AI coaching, calorie targets, programmes, full history) is sold only through in-app purchase: monthly and yearly, each with a 7-day free trial. Staff can also give a member the App Subscription free (complimentary access), which is allowed under guideline 3.1.3(b) as the same account works on the website.
```

**Subscription review information (Apple):** a screenshot of the subscribe screen (Settings > App Subscription) for each product, and
the note "Subscribe screen in Settings > App Subscription; a locked feature also opens it."

**Production on Play:** promote a build of version code 93 or later. Anyone on an older build is on Free with no way to subscribe
until they update.

