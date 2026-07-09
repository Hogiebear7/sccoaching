import { cookies } from "next/headers";

import { findProfileByUserId, findProgrammeByUserId, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { ProgrammeForm } from "./ProgrammeForm";

export default async function DashboardProgrammePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const programme = user ? findProgrammeByUserId(user.id) : undefined;

  // Coach-enabled feature: same "not available" pattern the Cycle tab uses
  // when a member doesn't have access.
  if (user && profile && !profile.programmeEnabled) {
    return (
      <section className="space-y-5">
        <div>
          <p className="label-caps">Programme</p>
          <h1 className="text-display mt-1 text-[28px] text-foreground">Not available</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Programmes are set up with your coach. Ask at your next session, or message your
            coach from the Messages tab, and this area will be switched on for you.
          </p>
        </div>
      </section>
    );
  }

  if (!user || !profile) {
    return (
      <section>
        <p className="label-caps">
          Programme
        </p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">
          No programme yet
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          We couldn&apos;t load profile data for this account. Try logging out and
          back in.
        </p>
      </section>
    );
  }

  return <ProgrammeForm programme={programme} />;
}
