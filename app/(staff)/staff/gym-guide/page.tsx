import Link from "next/link";

import { requireStaffPage } from "@/lib/staff-auth";

// The instruction manual for a gym running on the platform. Plain, in the order a new gym owner needs it. It describes only what the platform does today.
export const metadata = { title: "Gym guide" };

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: "start",
    title: "Getting started",
    body: [
      "When you sign up, your gym is created in a waiting state and you are signed in as its owner. You can set everything up straight away. Your gym appears in the directory members search only after the platform team approves it.",
      "Open Gym setup in the Admin menu. It shows a checklist worked out from your real data, so a tick means the step is actually done.",
    ],
  },
  {
    id: "branding",
    title: "Your logo and colour",
    body: [
      "In Gym setup, upload your logo (a .png, .jpg or .webp picture up to 1 MB) or paste a link to one that is already online, and pick one accent colour. Your members see both on the member website and in the S&C app the next time they open it.",
      "In the app, your colour replaces the S&C gold for your members: the tab bar, links, progress bars, badges and small highlights. On the app's light theme the colour is darkened a little if needed so it stays readable. The colour has to be readable on the dark background, so very dark colours are refused with a message. If you set nothing, members see the S&C look.",
      "Replace or remove your logo any time from the same place. The preview shows how it will look before you save.",
    ],
  },
  {
    id: "classes",
    title: "Classes and the timetable",
    body: ["Staff area, Classes. Create a class once, or as a repeating series, with its coach, time, capacity and place. Members book from the app and the website. You can see who is booked and mark attendance."],
  },
  {
    id: "people",
    title: "Coaches and members",
    body: [
      "Staff, in the Admin menu, is where you add coaches and choose each one's role. A coach sees the members they coach; an admin sees more. Give people the lowest role that lets them do their job.",
      "Invite members from the Members page, under Invite by email. Choose Many people to paste a list of emails or upload a file (a spreadsheet saved as CSV works), up to 100 at a time: you see what will happen to each address before anything is sent. They get a link, create their account and land in your gym. Your members can never see another gym's members, classes or messages, and other gyms can never see yours.",
    ],
  },
  {
    id: "memberships",
    title: "Memberships and pricing",
    body: ["Memberships & Pricing is where you set your plans, packs and prices. Members choose a plan in the app or on the website. The money for your memberships goes to you through your own payment provider; the platform never holds it.",
      "Trial pass: when you add or edit a package you can tick Trial pass, for a one-off \"try the gym\" offer such as 3 classes for a single payment. Each member can buy it once, and only before they have paid for a membership. Once they have a membership it is hidden from their account. Set it to a one-off payment, then make it visible.",],
  },
  {
    id: "community",
    title: "Community",
    body: ["Your members have a community space inside your gym, plus private groups. Staff, Gym community shows anything members report so you can review and remove it."],
  },
  {
    id: "platform",
    title: "Your platform subscription",
    body: [
      "Your gym pays S&C a subscription to use the platform. In Gym setup, open Your subscription, choose Monthly or Yearly and press Subscribe. You pay on a secure payment page; your card details never touch the platform. After that, Pay or renew starts a renewal, and Manage card, invoices or cancel opens a page where you can update your card, download invoices and cancel. A yearly plan costs eleven months of the monthly price, so you get about one month free.",
      "Your price depends on your gym's size: up to 50 members, 51 to 100, 101 to 150, 151 to 300, 301 to 500, or more than 500 (members who have not been archived). Your plan follows the most members you had at any point in your billing period, not the number on the day you pay, so removing members before the end of the period does not lower it. It only comes down when a whole period stayed lower. You are told by notification and email when you reach about 90% of the top of your plan and when you go over it, so a change is never a surprise.",
      "Money-back guarantee: if the platform is not right for you, ask the platform team within 14 days of your first payment and your latest payment is refunded and your subscription ended. After 14 days you can still cancel at any time and keep access to the end of the period you paid for.",
      "If a payment is overdue you get a grace period of 14 days first. During grace, your admins see a banner with a Pay link for the whole period, and your coaches see it too in the second half. Members notice nothing. If it is still unpaid after the grace period, access is paused: members see that the gym is temporarily unavailable and staff see a Pay now button.",
      "Nothing is ever deleted. The moment the payment is made, everything comes back exactly as it was.",
    ],
  },
  {
    id: "ai",
    title: "AI features and fair use",
    body: [
      "Your members can use the app's AI features, such as the AI coach, food photo and description logging, meal ideas, programme generation and workout reviews. Each member has a fair-use allowance, and your gym has its own monthly allowance that depends on your plan size and covers everyone in the gym together.",
      "If your gym uses up its allowance, AI features pause for your members until it frees up. Everything else in the app keeps working, and other gyms are not affected. If this happens often, a bigger plan gives you a bigger allowance.",
    ],
  },
  {
    id: "app",
    title: "What your members get in the app",
    body: [
      "Members download the free S&C app and sign up to your gym using your invite link. Once their account is in your gym, whenever they open the app they see your gym's logo and colour, your class timetable and booking, your gym community and private groups, and messaging with your coaches.",
      "Training and wellbeing tools in the app include workouts and programmes, food and water logging, and a daily recovery check-in. Members can add today's check-in and edit yesterday's, but not older ones. On the community leaderboard members appear under an alias they choose instead of their name, and can filter the alias choices by male or female names.",
      "An account belongs to one gym at a time. A member who wants to join a different gym needs to use a different account for now.",
    ],
  },
  {
    id: "privacy",
    title: "Member privacy",
    body: [
      "Health and training information belongs to the member. Only the coaches and admins in your gym can see it, and only for members of your gym. Members can delete their own account at any time.",
      "Do not share staff logins. Create an account for each person so changes can be traced to who made them.",
    ],
  },
  {
    id: "help",
    title: "Getting help",
    body: ["If something is wrong or you are unsure, contact the platform team at the address you were given when you signed up. Say which gym you are and what you were doing, and include a screenshot if you can."],
  },
];

export default async function StaffGymGuidePage() {
  await requireStaffPage("staff.access");
  return (
    <article className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-50">Gym guide</h1>
        <p className="mt-1 text-sm text-zinc-400">How to run your gym on the platform. Start with the <Link href="/staff/gym-setup" className="underline underline-offset-2 hover:text-zinc-100">setup checklist</Link>.</p>
      </header>
      <nav aria-label="Guide contents">
        <ul className="flex flex-wrap gap-2 text-xs">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="rounded-full border border-white/15 px-3 py-1 text-zinc-300 hover:text-white">{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 space-y-2">
          <h2 id={`${s.id}-h`} className="text-lg font-semibold text-zinc-50">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p.slice(0, 40)} className="text-sm leading-relaxed text-zinc-300">{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
