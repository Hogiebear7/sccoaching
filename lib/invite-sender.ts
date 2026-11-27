// Who an invite email is "from" in the words of the email: the inviting gym's name, and where a reply should go.
// The mail still leaves from the platform's one sending address (a sending address has to be verified with the mail provider); a tenant gym's own
// contact email is used as the Reply-To, so a person who answers the invite writes to the gym, not to S&C.
import { findGymById } from "@/lib/db";

export const PRIMARY_GYM_NAME = "S&C Performance Coaching";

export function inviteSenderFor(staff: { gymId?: string | null }): { gymName: string; replyTo: string | undefined } {
  if (!staff.gymId) return { gymName: PRIMARY_GYM_NAME, replyTo: undefined };
  const gym = findGymById(staff.gymId);
  const name = gym?.name?.trim();
  const reply = gym?.contactEmail?.trim();
  return { gymName: name || PRIMARY_GYM_NAME, replyTo: reply && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply) ? reply : undefined };
}
