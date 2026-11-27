import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import Link from "next/link";
import { findGymById, findProfileByUserId, findUserById } from "@/lib/db";
import { can, NAV_CAPABILITY, STAFF_ROLE_LABEL, type Capability, type StaffRole } from "@/lib/permissions";
import { verifySession } from "@/lib/session";
import { StaffShell } from "@/components/staff/admin/StaffShell";
import type { AdminIconName } from "@/components/staff/admin/icons";
import { tenantStatusFor, userInLockedGym } from "@/lib/tenant-lockout";
import { gymNotLive } from "@/lib/tenant-live";
import { touchDraftActivity } from "@/lib/gym-draft-activity";

export const dynamic = "force-dynamic";

// Nav items are grouped by admin job-to-be-done, mirroring the label-caps
// group pattern already used on the member dashboard sidebar (see
// app/(dashboard)/dashboard/layout.tsx's navGroups) rather than inventing a
// second pattern. Every item declares the capability that reveals it — the
// menu is a projection of the permission model, and each destination
// re-checks the same capability server-side (see lib/staff-auth.ts
// requireStaffPage). A section is dropped entirely if none of its items are
// visible to the signed-in role; group titles themselves are never links
// (Operations' own dashboard is reachable via its "Overview" item instead,
// keeping every heading uniformly non-clickable).
interface StaffNavItem {
  label: string;
  href: string;
  capability: Capability;
  icon: AdminIconName;
  hint: string;
}

interface StaffNavSection {
  title: string;
  items: StaffNavItem[];
}

const navSections: StaffNavSection[] = [
  // Grouped by what an owner is doing: the day to day (top), the people and classes, money and what you sell, the numbers, then settings and things to review.
  {
    title: "Today",
    items: [
      { label: "Overview",   href: "/staff/operations", capability: NAV_CAPABILITY["/staff/operations"], icon: "overview", hint: "Today's figures, to-dos, schedule and settings" },
      { label: "Messages",   href: "/staff/messages",   capability: NAV_CAPABILITY["/staff/messages"], icon: "messages", hint: "Conversations with members" },
    ],
  },
  {
    title: "Gym",
    items: [
      { label: "Classes",    href: "/staff/classes",    capability: NAV_CAPABILITY["/staff/classes"], icon: "classes", hint: "Timetable, bookings and class workouts" },
      { label: "Check-in", href: "/staff/checkin-poster", capability: NAV_CAPABILITY["/staff/checkin-poster"], icon: "attendance", hint: "Let members check in by scanning a code" },
      { label: "Members",    href: "/staff/members",    capability: NAV_CAPABILITY["/staff/members"], icon: "members", hint: "Every member, plans, access and invites" },
      { label: "Attendance", href: "/staff/attendance", capability: NAV_CAPABILITY["/staff/attendance"], icon: "attendance", hint: "Who came, who has gone quiet" },
      { label: "Workouts",   href: "/staff/workouts",   capability: NAV_CAPABILITY["/staff/workouts"], icon: "workouts", hint: "Workout templates" },
      // The standalone "Exercises" destination (hand-curated section list) still exists at /staff/exercises for staff who already know it's there, but it's no longer a first-class
      // nav item: Exercise Library is the one exercise-related destination the sidebar surfaces.
      { label: "Exercise Library", href: "/staff/exercise-library", capability: NAV_CAPABILITY["/staff/exercise-library"], icon: "library", hint: "Exercises, demos and cues" },
    ],
  },
  {
    title: "Money",
    items: [
      { label: "Memberships & Pricing", href: "/staff/catalog",   capability: NAV_CAPABILITY["/staff/catalog"], icon: "catalog", hint: "What you sell: add an offer, plans, packs and prices" },
      { label: "Finances",              href: "/staff/finances",  capability: NAV_CAPABILITY["/staff/finances"], icon: "finances", hint: "Payments and the ledger" },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Briefings",             href: "/staff/briefings", capability: NAV_CAPABILITY["/staff/briefings"], icon: "reports", hint: "Weekly and monthly briefings, and what to look at" },
      { label: "Reports",               href: "/staff/reports",   capability: NAV_CAPABILITY["/staff/reports"], icon: "reports", hint: "Trends over time" },
      { label: "Exports",               href: "/staff/exports",   capability: NAV_CAPABILITY["/staff/exports"], icon: "exports", hint: "Spreadsheets and the master workbook" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Gym setup",    href: "/staff/gym-setup",    capability: NAV_CAPABILITY["/staff/gym-setup"], icon: "catalog", hint: "Checklist, logo, colour, subscription and AI allowance" },
      { label: "Integrations", href: "/staff/integrations", capability: NAV_CAPABILITY["/staff/integrations"], icon: "exports", hint: "Connect Zapier and other tools" },
      { label: "Staff",        href: "/staff/staff-users",  capability: NAV_CAPABILITY["/staff/staff-users"], icon: "staff", hint: "Staff accounts and roles" },
      { label: "Staff changes", href: "/staff/changes",     capability: NAV_CAPABILITY["/staff/changes"], icon: "changes", hint: "Every staff change to a member" },
      { label: "Gym guide",    href: "/staff/gym-guide",    capability: NAV_CAPABILITY["/staff/gym-guide"], icon: "reports", hint: "How to run your gym on the platform" },
    ],
  },
  {
    title: "To review",
    items: [
      { label: "Food Reviews", href: "/staff/nutrition-submissions", capability: NAV_CAPABILITY["/staff/nutrition-submissions"], icon: "food", hint: "Foods members submitted" },
      { label: "Community reports", href: "/staff/community-reports", capability: NAV_CAPABILITY["/staff/community-reports"], icon: "flag", hint: "Reported comments and posts" },
      { label: "Gym community", href: "/staff/gym-community", capability: NAV_CAPABILITY["/staff/gym-community"], icon: "flag", hint: "Reports in your gym's community and groups" },
      // TRIAL-ONLY — see docs/bug-reports.md.
      { label: "Bug reports",  href: "/staff/bug-reports",  capability: NAV_CAPABILITY["/staff/bug-reports"], icon: "bug", hint: "Problems members reported" },
    ],
  },
];

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || user.archivedAt || !can(user.role, "staff.access")) {
    redirect("/dashboard");
  }
  // A locked gym's staff see the unavailable page (with the way to pay) instead of the staff area.
  if (userInLockedGym(user)) redirect("/gym-unavailable");

  const tenant = tenantStatusFor(user);
  // A new gym that has not paid yet can set everything up; this tells its staff what is left (lib/tenant-live.ts, off by default).
  const notLive = !!user.gymId && gymNotLive(findGymById(user.gymId));
  // Someone from this unpaid gym is using the setup pages: keep its saved setup from the last use (lib/gym-draft-expiry.ts).
  if (notLive && user.gymId) touchDraftActivity(user.gymId);

  const visibleNavSections = navSections
    .map((section) => ({
      title: section.title,
      items: section.items
        .filter((item) => can(user.role, item.capability))
        .map(({ label, href, icon, hint }) => ({ label, href, icon, hint })),
    }))
    .filter((section) => section.items.length > 0);

  const name = findProfileByUserId(user.id)?.fullName?.trim() || user.email.split("@")[0];
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S";
  const role = STAFF_ROLE_LABEL[user.role as StaffRole] ?? (user.role === "staff" ? STAFF_ROLE_LABEL.admin_manager : "Staff");

  return (
    <StaffShell sections={visibleNavSections} user={{ name, email: user.email, role, initials }}>
      {notLive ? (
        <div role="status" className="mx-auto mb-4 max-w-5xl rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          Your gym is not live yet. You can set everything up now. Your members can sign in, and you can invite them, once you go live.{" "}
          <Link href="/staff/gym-setup" className="font-semibold underline underline-offset-4">
            Go live
          </Link>
        </div>
      ) : null}
      {tenant.state === "grace" ? (
        <div role="alert" className="mx-auto mb-4 max-w-5xl rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Your gym&apos;s platform payment is overdue. Access pauses {tenant.graceDaysLeft === null ? "soon" : tenant.graceDaysLeft <= 1 ? "tomorrow" : `in ${tenant.graceDaysLeft} days`} unless it is paid.
          {tenant.payUrl ? (
            <>
              {" "}
              <a href={tenant.payUrl} rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
                Pay now
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {children}
    </StaffShell>
  );
}
