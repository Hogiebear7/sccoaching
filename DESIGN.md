---
version: 1
name: S&C Performance Coaching
description: |
  A navy-and-gold athletic system for a small-group strength and conditioning
  gym in Navan, Co. Meath, and its member app. Deep navy surfaces, one gold
  accent, uppercase Teko headlines over plain Inter text, and a slow
  "chalk haze" behind the marketing hero. The voice is coached, calm and
  specific: "Coached, not crowded."

colors:
  # Surfaces (darkest to lightest)
  sidebar: "#050e1d"
  bg-0: "#0a1526"
  bg-1: "#0e1b2e"
  surface-1: "#10203a"
  surface-2: "#142b4a"
  surface-3: "#24405f"
  # Accent
  gold: "#c6a15b"
  gold-hover: "#e0be7c"
  on-gold: "#0a1526"
  # Text
  text-primary: "#fcfeff"
  text-secondary: "rgb(255 255 255 / 0.80)"
  text-tertiary: "rgb(255 255 255 / 0.70)"
  # Lines
  border-subtle: "rgb(255 255 255 / 0.16)"
  border-default: "rgb(255 255 255 / 0.26)"
  # Status and data
  accent-data: "#55c4fe"
  success: "#8fbf9f"
  warning: "#e9b452"
  danger: "#e62b34"
  # Editorial band (one per page, website only)
  ivory: "#f2eee6"
  ivory-ink: "#0a1526"
  ivory-body: "#2c3a52"
  ivory-gold: "#8a6a2f"

typography:
  headline:
    family: "Teko"
    weight: 600
    transform: uppercase
    letter-spacing: "0.01em"
    line-height: 0.9
  body:
    family: "Inter"
    weight: 400
    size: "16px"
    line-height: 1.5
  label:
    family: "Inter"
    weight: 600
    size: "12px"
    transform: uppercase
    letter-spacing: "0.2em"
    color: "{colors.gold}"

sizes:
  hero-headline: "64px (phone) / 96px (≥640px)"
  section-headline: "44px / 56px"
  app-page-title: "40px / 48px"
  sub-headline: "28–34px"
  figure: "44px"
  lead: "18px"
  body: "16px"
  small: "14px"
  label: "12px"

rounded:
  button-website: "3px"
  card: "4px"
  pricing-card: "16px"
  pill: "9999px"
---

## Overview

S&C is a coaching floor, not a workout class, and the design says the same
thing: calm, deep navy surfaces, one gold accent used sparingly, and big
uppercase Teko headlines that read like a gym's own signage. Everything else
is quiet Inter text at a comfortable size.

The website (Next.js, `gym-app`) and the member app (Expo, `sc-coaching-mobile`)
share one palette, value for value. This file is the source of truth for both.
When code and this file disagree, fix the code or update this file in the same
change; don't let them drift.

**Key characteristics**
- Navy surfaces from `{colors.sidebar}` to `{colors.surface-3}`; never flat black. One exception: a single warm ivory editorial band per page (`ivory`) for the brand story.
- One accent: `{colors.gold}`. It marks the primary action, figures, labels and the second half of a headline. Not decoration.
- Headlines are uppercase Teko; body is Inter at 16px. No third face in new work.
- Square-ish geometry: 3px buttons on the website, 4px cards, a 2px gold line along the top of signature cards.
- One ambient effect: the marketing hero's chalk haze. Everything else moves only to enter or respond.

## Colors

All values below are identical in `gym-app/app/globals.css` (as OKLCH tokens
under `[data-theme="navy"]` / `[data-palette="gold"]`) and
`sc-coaching-mobile/src/constants/theme.ts` (as hex).

### Surface
| Token | Hex | Use |
|---|---|---|
| `sidebar` | `#050e1d` | App sidebar, deepest shade |
| `bg-0` | `#0a1526` | Page background |
| `bg-1` | `#0e1b2e` | Slightly raised background |
| `surface-1` | `#10203a` | Cards, panels, alternating sections |
| `surface-2` | `#142b4a` | Raised panels, popovers |
| `surface-3` | `#24405f` | Highest surface, muted fills |

Separate surfaces by a step in tone first; a 1px `border-subtle` line is the
most a card needs.

### Accent
- **Gold** `#c6a15b`: primary buttons, key figures, labels, headline accents, progress bars.
- **Gold hover** `#e0be7c`: hover and pressed state of gold elements only.
- **On gold** `#0a1526`: text on gold buttons.

Gold appears on the primary action and a small number of signals per screen.
If a screen has gold in more than four or five places, remove some.

### Text
- **Primary** `#fcfeff`: headlines and body text.
- **Secondary** white at 80%: supporting copy.
- **Tertiary** white at 70%: metadata, captions.

Running text is never dimmer than secondary. Small grey text on navy is the
fastest way to make this system look unfinished.

### Status and data
- **Data blue** `#55c4fe`: charts and data highlights, focus rings in the app.
- **Success** `#8fbf9f`, **Warning** `#e9b452`, **Danger** `#e62b34`: state only, never decoration.

## Typography

### Families
- **Teko** (self-hosted, `app/fonts/teko`, OFL): every headline, card title, class name and large figure. Web utility: `text-headline` (Teko 600, uppercase, 0.01em tracking, 0.9 line height).
- **Inter** (self-hosted): everything else.
- **Retired:** Fraunces (editorial serif), Oswald (condensed) and IBM Plex Mono remain registered for older surfaces, but new work does not use them. Space Grotesk stays only for data readouts in the app (stat values, tabular numbers) until those are reviewed.

### Scale
| Role | Size | Notes |
|---|---|---|
| Hero headline | 64px / 96px | Two lines at every width; second half in gold |
| Section headline | 44px / 56px | One per section |
| App page title | 40px / 48px | Every member page, auth page, error page |
| Sub-headline | 28–34px | FAQ groups, differentiators, class names |
| Figure | 44px | Teko, gold, tabular |
| Lead | 18px | The sentence directly under a headline |
| Body | 16px | Minimum for anything meant to be read; line length ≤ 60ch |
| Small | 14px | Metadata, captions, card support text |
| Label | 12px | Inter 600, uppercase, 0.2em tracking, gold |

### Rules
- Headlines are uppercase, so a decade plural must keep its lowercase "s": render class names through `components/ui/HeadlineText` so "Over 50s" shows as **OVER 50s**, never "OVER 50S" (which reads as "505").
- Keep headlines short. Teko capitals are tall and narrow; aim for two lines, three at most on a phone.
- Gold is allowed on the second half of a headline (`{HERO_HEADLINE.accent}`), nowhere else in a headline.
- Use labels sparingly: one above a section heading only when it adds information (place, standard, action). Never repeat the heading in the label.

## Layout

- Website container: `max-w-6xl` with 24px side padding (`px-6`); FAQ narrows to `max-w-3xl`.
- Section rhythm: 96px vertical padding on phones, 128px from `lg` (`py-24 lg:py-32`). Separate neighbours with a step in surface (`bg-0` ↔ `surface-1`) or the ivory band, plus at most a 1px `white/6%` line.
- Homepage order (the "trust & authority + conversion" pattern): sticky header → hero → proof strip → classes → ivory approach band → progress → app → FAQ → contact. Every section has an `id` for the header links and `scroll-mt-20` so jumps land under the sticky bar.
- **Website pages:** Home `/`, Classes `/classes`, About `/about`, FAQ `/faq`, Contact `/contact` (plus `/privacy`, `/terms`, Member login). Inner pages use `components/marketing/MarketingPage` (shared header, static haze, footer) and its `PageIntro`, `SectionLabel`, `CtaBand`, `SECTION`, `H2` and button classes, so every page shares the homepage's frame. The animated haze stays on the homepage only.
- Inner-page rhythm: `PageIntro` → alternating `bg-0` / `surface-1` sections → at most one ivory band → `CtaBand` → footer. Every page answers who it is for, what is offered and the next step, and ends with one clear action.
- Images always carry `width`/`height` (or a fixed aspect ratio) so lazy loading never shifts the layout or breaks anchor jumps.
- Breakpoints (Tailwind): `sm` 640px, `lg` 1024px. The hero is two columns from `lg`; the preview cards hide below `lg`.
- Phones are their own composition: section links move into the header menu, nav links never wrap, tap targets are at least 44px.

## Shapes and depth

- **Website buttons:** 3px radius, flat gold fill (primary) or a `white/14%` outline (secondary). No gradients, no glow.
- **App buttons:** pill (`9999px`) primary buttons remain in the member app; see Known gaps.
- **Cards:** `surface-1` fill, 1px `border-subtle`, 4px radius (`surface-card`). Signature cards add a 2px gold line along the top.
- **Class cards:** typographic, no photo: 4px radius, 2px gold top line, no shadow at rest; hover lifts 2px and turns the border gold.
- **Shadows:** only on things that float (menus, dialogs). No glass, no backdrop blur on new work.

## Imagery

- Only S&C's own imagery: the real training-floor photo and real app screenshots. No stock photos standing in for members, classes or the coach.
- Class cards carry no image until S&C has its own photography of each class; never use stock to fill the slot.
- Never bake text into a photo.
- Real app screenshots, not mock dashboards, when showing the product.
- Wanted: photography of S&C's own coach, floor and classes.

## Components

- **Primary button:** gold fill, `on-gold` text, Inter 14px semibold, 3px radius, 48px tall (website). Label says what happens: "Book your first session", "Email to book".
- **Copy lives in data:** homepage copy is in `lib/homepage-content.ts` and the classes in `lib/marketing-classes.ts`, ready to move to a back end/CMS; layout files hold no copy.
- **Secondary button:** transparent, `white/14%` border, Inter 14px medium.
- **Section label:** short gold rule (32×1px) + 12px uppercase gold text.
- **Site header:** slim sticky bar, opaque navy (no blur): logo, page links (`SITE_NAV`: Classes, About, The app, FAQ, Contact), a quiet "Member login", one gold "Book a session" to `/contact`. The current page gets `aria-current` and a 1px gold underline. Below `lg` the links live in a `<details>` menu that closes when a link is chosen (`components/marketing/SiteHeader`).
- **Hero:** Teko headline (gold second half), one-sentence who/where/what, primary + secondary button, the real training-floor photo with a 2px gold top line and a caption.
- **Proof strip:** four short process markers (Teko value + 14px label) on `surface-1`: how the coaching works (baseline, group size, programming, app). No statistics, years or qualifications unless confirmed by the owner.
- **Class card** (`components/marketing/ClassOffers`): Teko name, "From €x / per" with the figure in gold Teko, one-line summary, Details toggle and Enquire link. The full description replaces the summary in a fixed-height area on hover or keyboard focus, and via the toggle on touch. The class is "Over 50s" (lowercase s via `HeadlineText`), never "Older Athletes".
- **Ivory band:** Teko navy headline, `ivory-body` text, pillars separated by a 2px gold rule; the label uses `ivory-gold` for contrast.
- **Preview card** (progress section): `surface-1`, gold top line, Teko title (26px), Inter 12px uppercase gold tag, Teko gold figure (44px).
- **Every plan includes** (progress section): four concrete terms (coach messaging, booking/waitlist, 3-hour cancelling, pausing) with gold top rules, taken from the FAQ and the app's real rules (`HOME_INCLUDED`).
- **Testimonials:** none on the site until real, consented member quotes exist. Do not add an empty or hidden shell; trust comes from process and terms instead.
- **FAQ:** copy in `lib/faq-content.ts`. Homepage shows two groups ("Training with us", "The app") with a link to `/faq`; `/faq` shows four anchored groups with a sticky topic index and FAQPage structured data. Only the first question open on load; gold chevrons.
- **Class detail** (`/classes`): numbered section per class (sticky name, gold price, tagline, its own "Enquire about …" button to `/contact?class=<slug>`), then "Who it's for" (gold-dash list), "What's included" (ruled two-column list) and "What makes it different" (gold left rule). Class data in `lib/marketing-classes.ts`.
- **Comparison table** (`/about`): two plain columns, muted "Typical gym" vs bright "S&C"; a real `<table>` with a caption. No ticks, crosses or colour-coded cells.
- **Site footer** (`components/marketing/SiteFooter`): brand line, site links, direct contact, member and legal links.
- **Contact form:** name, email, message required; phone and "Interested in" optional. The class preselects from `?class=`; the choice is prefixed to the message (the API is unchanged).
- **Inner-page copy** lives in `lib/site-content.ts` (nav, page copy, the shared four-step "how you start").
- **App page header:** gold eyebrow chip + Teko page title (40/48px) + muted subtitle (`components/ui/PageHeader`).

## Motion

- **Entrances:** `anim-rise` (480ms, 10px rise, ease-out-expo) staggered 60–100ms; `ScrollReveal` once per element as it enters.
- **Hero haze:** `components/marketing/HeroShader*` — a server-rendered static navy haze, with the animated WebGPU haze (mesh gradient, faint cloud, slow chalk specks) faded in over it once ready. Rendered at half resolution; telemetry off; pauses off screen.
- **Feedback:** colour transitions 150ms on hover; buttons press down 1px.
- **Reduced motion:** no haze animation (static haze only), no entrance travel, no splash.
- **Splash:** the logo splash plays once per tab on app routes; never on the website.

## Do's and don'ts

**Do**
- Use `text-headline` for every heading and `HeadlineText` for class names.
- Keep body text at 16px and secondary colour or brighter.
- Measure performance on a production build (`next start`), not the dev server.
- Check new screens at 390px wide.

**Don't**
- Bring back the old "liquid glass" look: frosted panels, onyx/lime, teal capsules, aurora gradients, silver gradient text (`title-athletic`).
- Add Fraunces, Oswald or monospace to new work.
- Use gold for decoration, or more than one accent colour.
- Put text inside photos, or text smaller than 12px.
- Add a second ambient animation; the hero haze is the only one.

## Mapping to the mobile app

| This file | `sc-coaching-mobile/src/constants/theme.ts` |
|---|---|
| Colours | `Color.*` — identical hex values |
| Headline (Teko) | `Font.display` — currently the system serif (gap) |
| Body (Inter) | `Font.body` — currently the system font (gap) |
| Sizes | `FontSize` — xs 11, sm 13, base 15, md 17, lg 20, xl 24, xxl 32 (app scale; body 15 vs web 16) |

## Known gaps

- **Mobile fonts:** the Expo app bundles no custom fonts, so its headings use the phone's serif and body uses the system font. Matching the website needs Teko (and ideally Inter) added via `expo-font`, `Font.display = "Teko"` with uppercase headings, and a new app build.
- **App buttons** are pills while website buttons are 3px rectangles; decide one shape.
- **Space Grotesk** still renders stat values in the app; review whether Teko figures should replace it.
- **Older surfaces** (staff/admin tools, `/app` and `/admin` prototypes) still use retired styles in places.
- **Photography:** only the training-floor photo is S&C's own; the coach and classes are not yet shown.
