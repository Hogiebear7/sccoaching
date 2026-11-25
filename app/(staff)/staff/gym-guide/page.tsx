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
      "In Gym setup, add a link to your logo (https, a .png, .jpg, .webp or .svg image) and pick one accent colour. Your members see them in the app and on the member website the next time they open it.",
      "The accent has to be readable on the app's dark background, so very dark colours are refused with a message. If you set nothing, members see the S&C look.",
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
      "Invite members from Invites. They get a link, create their account and land in your gym. Your members can never see another gym's members, classes or messages, and other gyms can never see yours.",
    ],
  },
  {
    id: "memberships",
    title: "Memberships and pricing",
    body: ["Memberships & Pricing is where you set your plans, packs and prices. Members choose a plan in the app or on the website. The money for your memberships goes to you through your own payment provider; the platform never holds it."],
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
      "Your gym pays S&C a subscription to use the platform. The platform team gives you a payment link; pay it before the date shown and nothing changes.",
      "If a payment is overdue you get a grace period first. During grace, your staff see a banner with a Pay link, and members notice nothing. If it is still unpaid after the grace period, access is paused: members see that the gym is temporarily unavailable and staff see a Pay now button.",
      "Nothing is ever deleted. The moment the payment is made, everything comes back exactly as it was.",
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
