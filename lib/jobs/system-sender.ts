import { findStaffUsers, findUserById, type StoredUser } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";

// The staff account a system-generated message to `memberId` is attributed to.
// It must be a staff user in the MEMBER's own gym (gymId null = primary gym,
// lib/gym-scope.ts) — attributing it to an arbitrary staff account would
// surface another gym's staff identity in this member's thread. Returns
// undefined when the member can't be resolved or their gym has no staff; the
// caller then skips the in-thread message (fail closed) and carries on with its
// other work.
export function findSystemSenderForMember(memberId: string): StoredUser | undefined {
  const member = findUserById(memberId);
  if (!member) return undefined;
  return findStaffUsers().find((staff) => sameGym(member, staff));
}
