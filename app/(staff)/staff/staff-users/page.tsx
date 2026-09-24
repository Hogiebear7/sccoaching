import { findProfileByUserId, findStaffUsers } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { type StaffRole } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import { StaffUsersView } from "./StaffUsersView";

export const dynamic = "force-dynamic";

export default async function StaffUsersPage() {
  const actor = await requireStaffPage("staffUsers.manage");

  // Scoped to the acting manager's own gym, taken from the server-side
  // session user (this page reads no query/form/client gym value). The filter
  // runs BEFORE the profile lookup, so no other gym's email or name is ever
  // read into the page data. findStaffUsers() itself is deliberately left
  // unscoped — its other callers are unrelated.
  const rows = findStaffUsers()
    .filter((u) => sameGym(actor, u))
    .map((u) => ({
      id: u.id,
      email: u.email,
      fullName: findProfileByUserId(u.id)?.fullName ?? null,
      role: u.role as StaffRole,
      archivedAt: u.archivedAt ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return <StaffUsersView rows={rows} currentUserId={actor.id} />;
}
