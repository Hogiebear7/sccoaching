import QRCode from "qrcode";

import { getConfiguredSessionSecret } from "@/lib/app-config";
import { gymCheckinCode } from "@/lib/class-checkin";
import { requireStaffPage } from "@/lib/staff-auth";

import { PrintButton } from "./PrintButton";

// A printable poster for the gym wall. Members scan it with the app to check in to the class they booked. The code is signed and belongs to this gym only.
export const metadata = { title: "Check-in poster" };

export default async function CheckinPosterPage() {
  const staff = await requireStaffPage("classes.manage");
  const secret = getConfiguredSessionSecret();

  if (!secret) {
    return <p className="rounded-xl border border-border p-4 text-sm">Check-in is not available right now. Please contact support.</p>;
  }

  const code = gymCheckinCode(secret, staff.gymId ?? null);
  const svg = await QRCode.toString(code, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="print:hidden">
        <h2 className="text-display text-[28px] leading-tight">Check-in poster</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Print this and put it on the wall near the door. Members open the app, tap Scan to check in, and point their phone at it. They are checked in to the class they have booked, from 30 minutes
          before it starts until it ends. Nobody can check in to a class they have not booked.
        </p>
        <div className="mt-4">
          <PrintButton />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-8 text-center text-black">
        <p className="text-sm font-semibold uppercase tracking-[0.2em]">Check in here</p>
        <h3 className="mt-2 text-3xl font-bold">Scan to check in to your class</h3>
        <div className="mx-auto mt-6 w-full max-w-xs" role="img" aria-label="Check-in code for this gym" dangerouslySetInnerHTML={{ __html: svg }} />
        <ol className="mx-auto mt-6 max-w-xs list-decimal space-y-1 pl-5 text-left text-base">
          <li>Open the app</li>
          <li>Tap Scan to check in</li>
          <li>Point your phone at this code</li>
        </ol>
        <p className="mt-6 text-xs text-neutral-600">You need to have booked the class first.</p>
      </div>
    </div>
  );
}
