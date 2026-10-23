# Soft launch: public website and member sign-in

What has to be set on the host, and checked, before testers are pointed at the
public website (`/`, `/classes`, `/about`, `/faq`, `/contact`) and the member
sign-in screens. The member app, billing and datastore launch work are covered
by `docs/launch-checklist.md` and `docs/deployment-operations.md`; this file
only adds what the website needs.

Build: `next build --webpack` (see `deployment-operations.md` §1).

## 1. Environment variables

Set these in the host's environment-variable settings so they are present
**for the build and for the running app**. Static pages bake metadata at
build time; the homepage, `/contact` and the auth-link pages read it per
request, so a value present in only one of the two produces mixed results.

| Variable | Value | Why |
|---|---|---|
| `APP_URL` | `https://<live domain>` (origin only, no trailing slash) | Canonical URLs, social preview, `sitemap.xml`, `robots.txt`, email links, Stripe redirects. Unset or invalid falls back to `https://sandccoaching.com` (`lib/site-url.ts`). |
| `SESSION_SECRET` | 64-char hex | Sessions (existing requirement). |
| `DATA_DIR` | folder outside the deploy tree | Datastore survives redeploys (existing requirement). |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | **Contact form stores every enquiry in `contact_inquiries`; without these the form fails.** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key | As above (public by design; RLS allows insert only). |
| `RESEND_API_KEY` | production key, "Sending access" | Enquiry notifications and password-reset emails. Unset = emails are only logged. |
| `EMAIL_FROM` | `S&C Performance Coaching <info@<domain>>` | Must be a sender on a domain verified in Resend (SPF/DKIM). `onboarding@resend.dev` is rejected in production. |
| `CONTACT_NOTIFY_EMAIL` | the inbox that answers enquiries | Where enquiries go; Reply-To is the enquirer. |
| `SEARCH_INDEXING` | `off` on staging only; **unset in production** | `off` makes `robots.txt` disallow everything. |
| `GOOGLE_SITE_VERIFICATION` | token from Search Console's "HTML tag" method | Only if verifying by HTML tag; DNS verification needs nothing here. |
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | leave unset until analytics is approved, then `true` | GA4 master switch (build time). |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-XXXXXXXXXX` | GA4 web stream id (build time). |

Hosts with a capped variable count: the server-side values above (not the
`NEXT_PUBLIC_` ones, which must be real variables at build time) can be packed
into `SANDC_APP_CONFIG` as `key=value|key=value` — see `.env.local.example`.

Never commit real values: `.env*` is git-ignored except `.env.local.example`.
No client component reads a server-only variable.

## 2. Domain, canonical, sitemap, robots

With `APP_URL=https://<domain>`:

- Canonical: every public page declares `https://<domain>/<path>`;
  `/contact?class=…` canonicalises to `/contact`.
- `https://<domain>/sitemap.xml`: `/`, `/classes`, `/about`, `/faq`,
  `/contact`, `/privacy`, `/terms` (read per request).
- `https://<domain>/robots.txt`: allows `/`; disallows `/api/`, `/dashboard`,
  `/staff`, `/app`, `/admin`, `/admin-mobile`, `/invite`, `/reset-password`,
  `/verify-email-change`; points at the sitemap. With `SEARCH_INDEXING=off`:
  `Disallow: /`.
- `noindex`: `/login`, `/signup` (`noindex, follow`), `/forgot-password`,
  `/reset-password`, `/verify-email-change`.
- Social preview: `og:image` = `https://<domain>/marketing/training-floor.jpg`.

Staging: set `SEARCH_INDEXING=off`, and `APP_URL` to the staging origin so
email links point at staging. Pick one canonical host (with or without `www`)
and redirect the other to it at the host/DNS level.

## 3. Contact form

Flow: browser validation → `POST /api/contact` → server validation + honeypot
+ rate limit (30 enquiries per 10 minutes site-wide until
`TRUSTED_PROXY_HOPS` is verified) → insert into Supabase `contact_inquiries`
→ notification email to `CONTACT_NOTIFY_EMAIL` via Resend, Reply-To set to
the enquirer → "Enquiry sent" with the one-working-day reply promise.

- The Supabase table exists (project "S&C Coaching") with RLS on and a single
  anon INSERT policy. Its schema is not in `supabase/migrations/`.
- If the insert fails, the visitor sees "Something went wrong" and no email
  is sent. If the email fails, the enquiry is still stored and the visitor
  still sees success, so **check the table, not only the inbox**.
- The class choice is prefixed to the message ("Interested in: Over 50s").

Test on staging, not production: send one enquiry, confirm the row in
`contact_inquiries`, the email in the inbox, and that Reply answers the
enquirer.

## 4. Google Analytics 4 (prepared, off)

`components/analytics/SiteAnalytics.tsx`, on public pages only (never member,
staff or auth screens):

- Off unless `NEXT_PUBLIC_ANALYTICS_ENABLED=true` and a valid
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` are present at build time.
- When on, a cookie banner asks first. Nothing from Google loads until
  "Accept"; "Decline" stores the choice, disables the tag and removes `_ga`
  cookies. "Cookie settings" in the footer reopens the choice.
- Google signals and ad personalisation are off. One custom event:
  `generate_lead` (param `interest`) after a successful enquiry.

To switch on (after approval, and after the Privacy Policy names Google
Analytics, its cookies and retention):

1. analytics.google.com → create a GA4 property → Web data stream for the
   live domain → copy the Measurement ID.
2. In the property: Data retention → 14 months (or your choice); leave Google
   signals off.
3. Set both `NEXT_PUBLIC_` variables, rebuild and deploy.
4. Visit the site, accept the banner, confirm the visit in GA Realtime.
5. Optionally mark `generate_lead` as a key event.

## 5. Google Search Console

1. search.google.com/search-console → Add property → **Domain** property for
   the live domain (covers http/https and www) → add the TXT record it gives
   at your DNS provider. (Alternative: URL-prefix property with the HTML tag
   method → set `GOOGLE_SITE_VERIFICATION`, rebuild, deploy, then Verify.)
2. After verification: Sitemaps → submit `https://<domain>/sitemap.xml`.
3. URL inspection → test `https://<domain>/` → Request indexing.
4. Do this only once `SEARCH_INDEXING` is unset in production and the site
   is ready to be found.

## 6. Post-deploy checks

- `https://<domain>/robots.txt` and `/sitemap.xml` show the live domain.
- View source on `/classes`: canonical and `og:image` use the live domain.
- `/login` view source contains `noindex`.
- Staging enquiry test from §3 passes.
- Forgot password with a real member address delivers an email whose link
  opens `https://<domain>/reset-password?token=…`.
- Demo or tester login reaches `/dashboard`.
