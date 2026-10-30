// Staff change log (admin revamp slice S6, docs/admin-revamp-plan-2026-10.md): every change a staff member makes to a member's access or
// account, with who, to whom, what and when. Written by the staff member routes after a change succeeds; read by the Staff changes page and the
// "Staff changes" export sheet, both filtered to the acting staff member's own gym. SERVER-ONLY (lib/db.ts).

import { appendStaffAction, findProfileByUserId, findStaffActions, findUserById, type StaffActionRecord, type StaffActionType, type StoredUser } from "@/lib/db";

export const STAFF_ACTION_LABEL: Record<StaffActionType, string> = {
  app_access_granted: "Gave free App Subscription",
  app_access_withdrawn: "Withdrew free App Subscription",
  gym_membership_granted: "Gave gym Membership",
  gym_membership_ended: "Ended gym Membership",
  ai_paused: "Paused AI",
  ai_resumed: "Resumed AI",
  membership_paused: "Paused membership",
  membership_resumed: "Resumed membership",
  membership_status_set: "Changed membership status",
  extra_sessions_granted: "Added extra sessions",
  member_archived: "Archived account",
  member_restored: "Restored account",
  member_deleted: "Deleted account",
};

/** Records a change one staff member made to one member. The member's gym decides who can see it later. */
export function recordStaffAction(
  staff: Pick<StoredUser, "id">,
  member: Pick<StoredUser, "id" | "gymId">,
  type: StaffActionType,
  detail: StaffActionRecord["detail"] = {}
): void {
  // Never fails the staff member's change, which has already been saved.
  try {
    appendStaffAction({ gymId: member.gymId ?? null, staffUserId: staff.id, memberUserId: member.id, type, detail });
  } catch (error) {
    console.error("[staff-actions] could not record", type, error);
  }
}

export interface StaffActionRow {
  id: string;
  at: string;
  staff: string;
  member: string;
  memberUserId: string;
  action: string;
  detail: string;
}

const DETAIL_LABEL: Record<string, (v: string | number | boolean) => string> = {
  endsOn: (v) => `until ${v}`,
  note: (v) => `"${v}"`,
  status: (v) => `status: ${String(v).replace(/_/g, " ")}`,
  classes: (v) => `${v} class${v === 1 ? "" : "es"}`,
  bulk: () => "bulk change",
};
const describeDetail = (d: StaffActionRecord["detail"]): string =>
  Object.entries(d)
    .filter((e): e is [string, string | number | boolean] => e[1] !== null && e[1] !== "" && e[1] !== false)
    .map(([k, v]) => (DETAIL_LABEL[k] ? DETAIL_LABEL[k](v) : `${k}: ${v}`))
    .join(" · ");

const personName = (id: string, fallback: string): string => {
  const user = findUserById(id);
  if (!user) return fallback;
  return findProfileByUserId(id)?.fullName?.trim() || user.email;
};

/** The acting staff member's gym's changes, newest first, between two dates (YYYY-MM-DD, inclusive; start null = from the beginning). */
export function listStaffActions(staff: { gymId?: string | null }, start: string | null, end: string, limit = Infinity): StaffActionRow[] {
  const gymId = staff.gymId ?? null;
  const rows: StaffActionRow[] = [];
  const all = findStaffActions();
  for (let i = all.length - 1; i >= 0 && rows.length < limit; i--) {
    const a = all[i];
    const day = a.at.slice(0, 10);
    if (a.gymId !== gymId || day > end || (start && day < start)) continue;
    rows.push({
      id: a.id,
      at: a.at,
      staff: personName(a.staffUserId, "Former staff"),
      member: personName(a.memberUserId, "Deleted member"),
      memberUserId: a.memberUserId,
      action: STAFF_ACTION_LABEL[a.type] ?? a.type,
      detail: describeDetail(a.detail),
    });
  }
  return rows;
}
