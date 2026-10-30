# Website growth plan (follow-up), 2026-10-29

A follow-up list, not approved work. Each item is a separate slice to agree before it's built. Written after reviewing
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (the CRO, SEO audit, schema, AI search, referrals,
churn-prevention, paywall and onboarding skills) against the live site at `sandccoaching.com`.

## What the site already does well

- A clear local headline and meta description ("Small-group strength coaching in Navan"), canonical URLs, a sitemap and a robots file
  that keeps the member, staff and API areas out of search.
- An FAQ page with FAQ structured data.
- Real app screenshots (now the same seven as the store listings) and a contact form.

## Status (2026-10-30)

- **Done:** 1 (HealthClub structured data, from the facts the site already states), 4 (store badges link to each listing once
  `NEXT_PUBLIC_APP_STORE_LISTING_LIVE` / `NEXT_PUBLIC_PLAY_LISTING_LIVE` are set to `true` at build), 5 (the App Subscription price in the app
  section and the FAQ, and that it is separate from a gym Membership), 7 (`/llms.txt`, and the app FAQ corrected to the current plans).
- **Already in place:** 10. Google Analytics 4 is built in, consent-gated, and off until `NEXT_PUBLIC_ANALYTICS_ENABLED=true` and
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` are set. Check the privacy policy covers it with the solicitor before switching it on.
- **Owner's step:** 2 (Google Business Profile). Once it exists, send the street address, Eircode and opening hours and they go into the
  structured data, matching the profile exactly; and the review link for item 3.
- **Needs an owner decision before building:** 3 (the Google review link, and which moments prompt: a personal best, a 4-week streak, the
  10th class), 6 (what the first-visit offer is, if any), 8 (the referral reward), 9 (the win-back offer and timing).

## Highest value, in order

1. **Local business structured data on the home page.** There is no `HealthClub` / `LocalBusiness` JSON-LD: name, address in Navan,
   phone, opening hours, geo position, price range, the logo and the class types. This is what Google's map results and AI answers read
   first for "gym near me" and "strength coaching Navan". Small, safe, high value. (Skills: schema, seo-audit.)
2. **Google Business Profile, kept in step with the site.** Same name, address and phone everywhere (the site footer, the profile and the
   structured data), the same opening hours, class photos, and the booking link. The single biggest local-search lever; it's done in
   Google's own console, so it's your step, with a checklist from me.
3. **Reviews, asked for at the right moment.** The app already knows good moments: a personal best, a 4-week streak, the 10th class.
   A gentle in-app prompt there ("Enjoying S&C? A Google review helps a lot") linking to the Google review page. Plus a review link on
   the website footer. No incentives (Google forbids paying for reviews). (Skill: referrals.)
4. **App store badges and a "Get the app" section.** The site describes the app but doesn't link to the Play Store or App Store yet
   (`lib/app-links.ts` exists). Add the official badges once each listing is public, and a smart banner on phones.
5. **Pricing clarity.** A page or section with the gym Memberships (from the catalog) and the App Subscription (€12.99 / €119.99, 7-day
   trial), stating plainly that they're separate. Visitors look for prices first; hiding them costs enquiries. (Skill: cro.)
6. **A short free trial or first-class offer on the home page**, with one clear call to action above the fold ("Book a free intro
   session"), repeated after the classes section. Today the page has several actions of similar weight. (Skill: cro.)
7. **AI search readiness.** Clear question-and-answer copy on the class and FAQ pages ("Is semi-private training good for beginners?",
   "How much does it cost?"), an `llms.txt` describing the gym, the classes and the app, and consistent facts across pages, so AI
   assistants quote the gym accurately. (Skill: ai-seo.)
8. **Referral loop for members.** "Bring a friend" in the app: the member shares a link, the friend's first class is free, the member
   gets a reward the gym chooses (a free week, extra class passes). The class-pass ledger already supports giving extra passes.
   (Skill: referrals.)
9. **Win-back and save offers.** When a member ends a gym Membership or the App Subscription lapses: a short "why are you leaving?"
   question, a pause option instead of cancelling (pause already exists), and a win-back message 2–4 weeks later. (Skill:
   churn-prevention.)
10. **Measure it.** Privacy-friendly analytics (page views, contact form and booking clicks, app badge clicks), so changes above can be
    judged on numbers. Must match the solicitor-cleared privacy policy, so the policy wording is checked first and not changed without
    the solicitor.

## Not recommended now

- Programmatic SEO pages, paid ads, cold email, influencer work: too early for a single gym before it opens.
- Pop-ups: they hurt mobile visits and Google's ranking for a small local site.

## Suggested first slice

Items 1 and 4 together: structured data plus app badges. Both are small, invisible to members until the listings are public, and have
no effect on the app or the data.
