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

  if (!user || !profile) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
          Programme
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          No programme yet
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We couldn&apos;t load profile data for this account. Try logging out and
          back in.
        </p>
      </section>
    );
  }

  return <ProgrammeForm programme={programme} />;
}
