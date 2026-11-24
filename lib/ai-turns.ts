// Dates for the AI chats. The coach used to get the last 20 messages as plain text with no dates, so a readiness score a member logged a month ago read
// exactly like today's (reported 2026-11-23: "you logged a readiness of 71 today" came from an old message). Every earlier message now starts with
// a bracketed date the app adds, and the model is told today's date and that figures from an earlier day are stale (see the two system prompts in lib/ai.ts).

export interface DatedChatTurn {
  role: "user" | "assistant";
  content: string;
  /** ISO timestamp the message was saved. Missing or unparsable: the turn is sent unchanged. */
  createdAt?: string | null;
}

const TIME_ZONE = "Europe/Dublin";

function dublinParts(date: Date): { ymd: string; weekday: string; day: string; month: string; year: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return { ymd, weekday: parts.weekday, day: parts.day, month: parts.month, year: parts.year, time: `${parts.hour}:${parts.minute}` };
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

function relativeLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** "[Mon 23 Nov 2026, 11:06 · yesterday]" for a message sent at `sent`, as seen on `now` (Irish dates). */
export function messageStamp(sent: Date, now: Date): string {
  const s = dublinParts(sent);
  return `[${s.weekday} ${s.day} ${s.month} ${s.year}, ${s.time} · ${relativeLabel(daysBetween(s.ymd, dublinParts(now).ymd))}]`;
}

/** The turns with each message prefixed by its date stamp. Turns without a usable createdAt are left as they were. */
export function stampTurns<T extends DatedChatTurn>(turns: T[], now: Date = new Date()): Array<{ role: T["role"]; content: string }> {
  return turns.map((turn) => {
    const sent = turn.createdAt ? new Date(turn.createdAt) : null;
    if (!sent || Number.isNaN(sent.getTime())) return { role: turn.role, content: turn.content };
    return { role: turn.role, content: `${messageStamp(sent, now)} ${turn.content}` };
  });
}

/** One line for the member-data block: today's Irish date and time. */
export function todayLine(now: Date = new Date()): string {
  const n = dublinParts(now);
  return `Today is ${n.weekday} ${n.day} ${n.month} ${n.year}, ${n.time} (Irish time).`;
}

/** Shared rule for both chat system prompts. Static text, so the prompt-cache prefix stays stable between requests. */
export const CHAT_DATES_RULE = `Dates:
- The app puts a bracketed date at the start of every earlier message in the conversation, for example [Mon 23 Nov 2026, 11:06 · yesterday]. Never write one in your own replies.
- Readiness, sleep, soreness, illness, mood and body weight change daily. What a member or you said on an earlier day is only true for that day. For today, use the Member data block; if it has nothing for today, say so instead of repeating an earlier day's number.
- When you mention something from an earlier day, say when it was ("on Monday", "a few weeks ago").`;
