// What the webhook messages say about a member and a class. Looked up only when a gym actually has a webhook for the event (the emit functions take a function), and always inside the
// safety wrapper, so a problem here can never reach the member. Only what a mailing list or a spreadsheet needs: name, email, and the class's name and time. No health, payment or training data.
import { findClassById, findProfileByUserId, findUserById } from "@/lib/db";

export function memberData(userId: string): Record<string, unknown> {
  const user = findUserById(userId);
  const profile = findProfileByUserId(userId);
  return { id: userId, name: profile?.fullName?.trim() || null, email: user?.email ?? null };
}

export function classData(classId: string): Record<string, unknown> {
  const c = findClassById(classId);
  return c ? { id: c.id, title: c.title, date: c.date, startTime: c.startTime, durationMins: c.durationMins } : { id: classId };
}
