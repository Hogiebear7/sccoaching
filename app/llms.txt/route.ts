import { CONTACT_INFO } from "@/lib/content";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";
import { getSiteUrl } from "@/lib/site-url";

// /llms.txt: a plain summary of the gym, its classes and the app for AI assistants (docs/website-growth-plan-2026-10.md, item 7). Built from
// the same content the pages use, so the facts never drift from the site.
export const dynamic = "force-static";

export function GET() {
  const url = getSiteUrl();
  const classes = MARKETING_CLASSES.map((c) => `- [${c.name}](${url}/classes#${c.slug}): ${c.tagline} From ${c.price.from} per ${c.price.per}.`).join("\n");
  const text = `# S&C Performance Coaching

> Small-group strength and conditioning coaching in ${CONTACT_INFO.location}, Ireland, with a member app for training, nutrition and recovery.

## Classes

${classes}

## The app

- Free to download, for iPhone and Android (launching soon on the App Store and Google Play). Logging workouts, meals and daily check-ins is free.
- The App Subscription adds the AI coach and AI nutrition coach, food logging from a photo or description, adaptive calorie and macro targets, programmes and full history: EUR 12.99 a month or EUR 119.99 a year, with a 7-day free trial, bought in the app.
- The App Subscription and a gym Membership are separate: neither includes the other.

## Contact

- Email: ${CONTACT_INFO.email}
- Phone: ${CONTACT_INFO.phone}
- Website: ${url}

## Pages

- [Classes](${url}/classes)
- [About](${url}/about)
- [FAQ](${url}/faq)
- [Contact](${url}/contact)
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
