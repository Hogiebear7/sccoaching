import { checkinPeriodOf } from "@/lib/class-checkin";
import { gymRecordForUser, selfCheckinModeForUser } from "@/lib/gym-checkin-setting";
import { requireStaffPage } from "@/lib/staff-auth";

import { CheckinPanel } from "./CheckinPanel";

// Where a gym chooses how members check in (off, a poster, or a live code on a screen) and prints or shows the code. The route keeps its original name so existing links still work.
export const metadata = { title: "Check-in" };

export default async function CheckinPage() {
  const staff = await requireStaffPage("classes.manage");
  return (
    <div className="mx-auto max-w-xl">
      <CheckinPanel initialMode={selfCheckinModeForUser(staff)} initialPeriod={checkinPeriodOf(gymRecordForUser(staff))} />
    </div>
  );
}
