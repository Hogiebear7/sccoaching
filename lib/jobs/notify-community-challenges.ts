import { daysBetween, todayIso } from "@/lib/challenges";
import { gymCommunityAudience, notifyCommunityUser } from "@/lib/community-notify";
import { findAllChallenges, findGroupById, findGroupMembers, findUserById, type ChallengeRecord } from "@/lib/db";
import type { JobDefinition } from "./types";

// Tells the people in a challenge when it starts and when it has finished. Runs with the other housekeeping jobs, so a notice goes out within a few hours of
// the day rather than at midnight. It is safe to run any number of times: each person is told once per challenge (the notification's dedupe key), and only
// challenges that started in the last 2 days or finished in the last 3 are announced, so nothing old is ever sent late. A canceled challenge, and one in a
// closed group, is never announced.
const START_WINDOW_DAYS = 2;
const END_WINDOW_DAYS = 3;

const METRIC_LABEL: Record<ChallengeRecord["metric"], string> = {
  volume: "Total volume",
  workouts: "Workouts logged",
  squat: "Best squat",
  bench: "Best bench",
  deadlift: "Best deadlift",
};

/** Who is in the challenge: a group's members, or the gym's members who can open the gym community. Empty when the group is gone or closed. */
function audienceFor(c: ChallengeRecord): string[] {
  if (c.scopeType === "group") {
    const group = findGroupById(c.scopeId);
    if (!group || group.closedAt) return [];
    return findGroupMembers(group.id)
      .map((m) => m.userId)
      .filter((id) => {
        const user = findUserById(id);
        return !!user && !user.archivedAt;
      });
  }
  return gymCommunityAudience(c.scopeId === "primary" ? null : c.scopeId);
}

const linkFor = (c: ChallengeRecord) =>
  c.scopeType === "group"
    ? `/community/challenge?scope=group&groupId=${encodeURIComponent(c.scopeId)}&challengeId=${encodeURIComponent(c.id)}`
    : `/community/challenge?scope=gym&challengeId=${encodeURIComponent(c.id)}`;

export const notifyCommunityChallengesJob: JobDefinition = {
  name: "notify-community-challenges",
  description: "Tells the people in a group or gym challenge when it starts and when it has finished.",
  async run() {
    const today = todayIso();
    let started = 0;
    let finished = 0;

    for (const c of findAllChallenges()) {
      if (c.canceledAt) continue;
      const sinceStart = daysBetween(c.startDate, today);
      const sinceEnd = daysBetween(c.endDate, today);
      const announceStart = sinceStart >= 0 && sinceStart <= START_WINDOW_DAYS && sinceEnd <= 0;
      const announceEnd = sinceEnd >= 1 && sinceEnd <= END_WINDOW_DAYS;
      if (!announceStart && !announceEnd) continue;

      const audience = audienceFor(c);
      const link = linkFor(c);
      for (const userId of audience) {
        if (announceStart) {
          const sent = notifyCommunityUser(userId, {
            type: "challenge_started",
            title: `Challenge started: ${c.title}`,
            body: `${METRIC_LABEL[c.metric]}. It runs until ${c.endDate}. Your logged workouts count automatically.`,
            linkHref: link,
            dedupeKey: `challenge-start:${c.id}`,
          });
          if (sent) started++;
        }
        if (announceEnd) {
          const sent = notifyCommunityUser(userId, {
            type: "challenge_ended",
            title: `Challenge finished: ${c.title}`,
            body: "See the final standings.",
            linkHref: link,
            dedupeKey: `challenge-end:${c.id}`,
          });
          if (sent) finished++;
        }
      }
    }

    return `Told ${started} ${started === 1 ? "person" : "people"} a challenge started and ${finished} one finished.`;
  },
};
