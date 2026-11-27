// Which gym record a signed-in person belongs to for the check-in setting, and its mode. The original S&C gym has no gym id on its accounts, so it is found by its slug.
import { findGymById, findGymBySlug } from "@/lib/db";
import { selfCheckinModeOf, type SelfCheckinMode } from "@/lib/class-checkin";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";

export function gymRecordForUser(user: { gymId?: string | null }) {
  return user.gymId ? findGymById(user.gymId) : findGymBySlug(PRIMARY_GYM_SLUG);
}

export function selfCheckinModeForUser(user: { gymId?: string | null }): SelfCheckinMode {
  return selfCheckinModeOf(gymRecordForUser(user));
}
