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
- Navy surfaces from `{colors.sidebar}` to `{colors.surface-3}`; never flat black, never light mode.
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
- Section rhythm: 80px vertical padding (`py-20`), a 1px `white/6%` line between sections, alternate `bg-0` and `surface-1` to separate neighbours.
- Breakpoints (Tailwind): `sm` 640px, `lg` 1024px. The hero is two columns from `lg`; the preview cards hide below `lg`.
- Phones are their own composition: the logo drops to 80px, nav links never wrap, tap targets are at least 44px.

## Shapes and depth

- **Website buttons:** 3px radius, flat gold fill (primary) or a `white/14%` outline (secondary). No gradients, no glow.
- **App buttons:** pill (`9999px`) primary buttons remain in the member app; see Known gaps.
- **Cards:** `surface-1` fill, 1px `border-subtle`, 4px radius (`surface-card`). Signature cards add a 2px gold line along the top.
- **Pricing cards:** 16px radius with a real class photo on top; the featured card gets a gold border and a soft gold shadow.
- **Shadows:** only on things that float (menus, dialogs, the featured pricing card). No glass, no backdrop blur on new work.

## Imagery

- Real photography of training: coach and member together, dark gym, warm practical light. Class photos live in `public/marketing/`.
- Never bake text into a photo; the class name is set in Teko over the image's dark lower edge.
- Real app screenshots, not mock dashboards, when showing the product.
- Wanted: photography of S&C's own coach and floor to replace the stock-style class photos.

## Components

- **Primary button:** gold fill, `on-gold` text, Inter 14px semibold, 3px radius (website). Label says what happens: "Start training", "Book your first session".
- **Secondary button:** transparent, `white/14%` border, Inter 14px medium.
- **Section label:** short gold rule (32×1px) + 12px uppercase gold text.
- **Preview card** (hero): `surface-1`, gold top line, Teko title (26px), Inter 12px uppercase gold tag, Teko gold figure (44px).
- **Class panel:** class names in Teko 34–44px over the training-floor photo; tap/hover reveals the description.
- **Pricing card:** photo header with Teko class name, white Teko price (44px), "Get started" button; one featured card.
- **FAQ:** one section, two groups ("Training with us", "The app"); only the first question open on load; gold chevrons.
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
- **Photography:** class photos are stock-style; S&C's own coach and floor are not yet shown.
