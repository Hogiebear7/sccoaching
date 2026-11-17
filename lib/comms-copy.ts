// The wording and layout of the getting-started, payment and owner emails (DRAFT wording: the owner approves it before COMMS_ENABLED is switched on). One
// place for every word, so changing a sentence is a one-line edit. Plain on purpose: one column, one link per email, no hard selling.
import { getConfiguredAppUrl } from "@/lib/app-config";

export const BUSINESS_NAME = "S&C Performance Coaching";
export const BUSINESS_ADDRESS = "The Willows, Liscarton, Navan, Co. Meath, Ireland";
export const BUSINESS_EMAIL = "info@sandccoaching.com";
const SIGN_OFF = "Conor\nS&C Performance Coaching";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const appUrl = () => (getConfiguredAppUrl() || "http://localhost:3000").replace(/\/$/, "");

interface Block {
  /** Paragraph text, or a list when an array. */
  p?: string;
  list?: string[];
  heading?: string;
  link?: { label: string; href: string };
}

function render(subject: string, blocks: Block[], footer: { reason: string; unsubscribeUrl?: string; unsubscribeLabel?: string }): BuiltEmail {
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (const b of blocks) {
    if (b.heading) {
      textParts.push(b.heading.toUpperCase());
      htmlParts.push(`<h2 style="font-size:17px;margin:24px 0 6px;color:#111;">${esc(b.heading)}</h2>`);
    }
    if (b.p) {
      textParts.push(b.p);
      htmlParts.push(`<p style="margin:0 0 14px;">${esc(b.p).replace(/\n/g, "<br>")}</p>`);
    }
    if (b.list) {
      textParts.push(b.list.map((l, i) => `${i + 1}. ${l}`).join("\n"));
      htmlParts.push(`<ol style="margin:0 0 14px;padding-left:20px;">${b.list.map((l) => `<li style="margin-bottom:6px;">${esc(l)}</li>`).join("")}</ol>`);
    }
    if (b.link) {
      textParts.push(`${b.link.label}: ${b.link.href}`);
      htmlParts.push(`<p style="margin:0 0 14px;"><a href="${esc(b.link.href)}" style="color:#111;font-weight:600;">${esc(b.link.label)}</a></p>`);
    }
  }
  const footerText = [
    footer.reason,
    `${BUSINESS_NAME}, ${BUSINESS_ADDRESS}`,
    footer.unsubscribeUrl ? `${footer.unsubscribeLabel ?? "Unsubscribe"}: ${footer.unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="background:#000;color:#fff;padding:18px 20px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.08em;text-align:center;">S&amp;C PERFORMANCE COACHING</td></tr>
<tr><td style="background:#fff;padding:22px 24px;border-radius:10px;font-size:15px;line-height:1.55;">${htmlParts.join("")}</td></tr>
<tr><td style="padding:14px 8px;font-size:12px;color:#71717a;line-height:1.5;text-align:center;">${esc(footer.reason)}<br>${esc(BUSINESS_NAME)}, ${esc(BUSINESS_ADDRESS)}${
    footer.unsubscribeUrl ? `<br><a href="${esc(footer.unsubscribeUrl)}" style="color:#71717a;">${esc(footer.unsubscribeLabel ?? "Unsubscribe")}</a>` : ""
  }</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text: `${textParts.join("\n\n")}\n\n--\n${footerText}`, html };
}

export interface JourneyContext {
  name: string;
  /** Signed link that stops getting-started emails. */
  unsubscribeUrl: string;
  /** True when the PAR-Q health check is switched on (lib/parq.ts parqRequired). */
  parqOn: boolean;
}

const hi = (name: string) => `Hi ${name.split(" ")[0] || "there"},`;
const tipsFooter = (c: JourneyContext) => ({
  reason: "You're getting this because you joined S&C Performance Coaching.",
  unsubscribeUrl: c.unsubscribeUrl,
  unsubscribeLabel: "Stop these getting-started emails",
});

export function journeyEmail(stepId: string, c: JourneyContext): BuiltEmail | null {
  const open: Block = { link: { label: "Open your dashboard", href: `${appUrl()}/dashboard` } };
  switch (stepId) {
    case "app-welcome":
      return render(
        "Welcome to S&C Performance Coaching",
        [
          { p: hi(c.name) },
          { p: "Thanks for joining. S&C is a training, nutrition and recovery app built by a real coach and grounded in sports science, to help you train well and keep going." },
          { heading: "Three steps to get started" },
          {
            list: [
              "Open the app and fill in your profile: your goal, how many days you can train, and your weight.",
              "Log your first workout or your first meal. Both are quick, and you can come back to edit them.",
              "Do a daily check-in (sleep, soreness, how you feel). It takes about 30 seconds and tells you how ready you are to train.",
            ],
          },
          { heading: "Your data is yours" },
          { p: "We never sell your data or share it with advertisers." },
          { p: "I'll send a few short tips over the next days. If you have a question at any point, just reply to this email." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "app-how-it-works":
      return render(
        "How S&C works, in a minute",
        [
          { p: hi(c.name) },
          { p: "The app does three things, and they work best together." },
          { heading: "Log" },
          { p: "Record your workouts and your food. For food you can search, scan a barcode, or take a photo of a label or meal. You check what the app read before it's saved." },
          { heading: "Check in" },
          { p: "A daily check-in gives you a readiness score and a seven-day view of your training load, so you know when to push and when to ease off." },
          { heading: "Adjust" },
          { p: "Your calorie and protein targets and your training can change as your data builds up." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "app-check-in":
      return render(
        "How are you getting on?",
        [
          { p: hi(c.name) },
          { p: "A quick check-in from me. You've had the app for a few days, and I wanted to see how you're settling in." },
          { p: "Starting a new routine brings up questions. If you've hit a snag, or just want to check you're set up properly, reply to this email and I'll get back to you." },
          { p: "Don't worry about being perfect. Logging honestly and often is what makes it work." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "app-tip":
      return render(
        "One habit that makes the biggest difference",
        [
          { p: hi(c.name) },
          { p: "If you only build one habit, make it the daily check-in. It takes about 30 seconds, and over a week or two it shows you patterns in your sleep, soreness and energy that are hard to spot otherwise." },
          { p: "Then let it guide your sessions: push on the days you feel ready, and keep it lighter on the days you don't." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "gym-welcome":
      return render(
        "Welcome to the gym",
        [
          { p: hi(c.name) },
          { p: "Welcome to S&C Performance Coaching. Your gym membership is active, and it includes the full app." },
          { heading: "Get set up" },
          {
            list: [
              "Open the app and check your profile, including your emergency contact. We need it before you can book a class.",
              ...(c.parqOn ? ["Complete the quick health check (it takes about two minutes) before your first session."] : []),
              "Go to Schedule and book your first class.",
            ],
          },
          { p: "If you have any injuries, health conditions or anything else I should know about before you train, reply to this email, message me in the app, or tell me in person." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "gym-booking":
      return render(
        "Booking and managing your classes",
        [
          { p: hi(c.name) },
          { p: "A few notes on using the app alongside the gym." },
          { p: "Book and cancel classes in the Schedule tab. You'll get a confirmation by email when you book." },
          { p: "On the day of a class, the app may ask you to do a quick check-in beforehand, so your coach can see how you're feeling." },
          { p: "Your workouts, food and recovery all sit in the same app, so your coach can see how you're doing." },
          open,
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    case "gym-anything-we-should-know":
      return render(
        "Anything I should know?",
        [
          { p: hi(c.name) },
          { p: "You've been with us for a few days now. Is there anything I should know about how you're getting on, or anything about your training, injuries or health that would help me coach you better?" },
          { p: "Just reply to this email or message me in the app. Both come straight to me." },
          { p: SIGN_OFF },
        ],
        tipsFooter(c)
      );
    default:
      return null;
  }
}

// ── Payment emails (a service message: no unsubscribe, they're about the member's own payment) ──
export function paymentFailedEmail(name: string): BuiltEmail {
  return render(
    "Your membership payment didn't go through",
    [
      { p: hi(name) },
      { p: "We couldn't take your latest membership payment. This is usually an expired card or a bank block, and it's quick to fix." },
      { p: "Please check your payment details so your membership stays active. If you need a hand, reply to this email." },
      { link: { label: "Manage your membership", href: `${appUrl()}/dashboard/membership` } },
      { p: SIGN_OFF },
    ],
    { reason: "You're getting this because it's about your S&C Performance Coaching membership payment." }
  );
}

export function membershipEndedEmail(name: string): BuiltEmail {
  return render(
    "Your membership has ended",
    [
      { p: hi(name) },
      { p: "Your S&C Performance Coaching membership has ended. Your account and your history are still there, and you can keep using the app on the free plan." },
      { p: "If this wasn't expected, or you'd like to come back, reply to this email and I'll sort it." },
      { link: { label: "Manage your membership", href: `${appUrl()}/dashboard/membership` } },
      { p: SIGN_OFF },
    ],
    { reason: "You're getting this because it's about your S&C Performance Coaching membership." }
  );
}
