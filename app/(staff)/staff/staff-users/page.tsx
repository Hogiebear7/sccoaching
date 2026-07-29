import { findProfileByUserId, findStaffUsers } from "@/lib/db";
import { type StaffRole } from "@/lib/permissions";
import { requireStaffPage } from "@/lib/staff-auth";
import { StaffUsersView } from "./StaffUsersView";

export const dynamic = "force-dynamic";

export default async function StaffUsersPage() {
  const actor = await requireStaffPage("staffUsers.manage");

  const rows = findStaffUsers()
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
