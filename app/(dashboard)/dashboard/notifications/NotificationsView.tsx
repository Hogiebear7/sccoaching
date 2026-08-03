"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { NotificationRecord, NotificationType } from "@/lib/db";

const TYPE_LABEL: Record<NotificationType, string> = {
  message: "Message",
  membership: "Membership",
  class_reminder: "Class reminder",
  cancellation: "Cancellation",
  waitlist_offer: "Spot offer",
  waitlist_timeout: "Offer expiring",
};

const TYPE_ICON: Record<NotificationType, string> = {
  message:
    "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  membership:
    "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  class_reminder:
    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  cancellation:
    "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  waitlist_offer:
    "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  waitlist_timeout:
    "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
};

// Time-sensitive types get their own "Needs a response" group ahead of
// everything else — a spot offer has a real expiry, so it shouldn't be
// competing for attention in the same flat list as a membership update.
// Named for what it means, not the color it used to map to (the old
// TYPE_IS_GOLD name was the root of the routine-vs-urgent collision this
// redesign fixes — see the palette-semantics audit in memory).
const TYPE_IS_URGENT: Record<NotificationType, boolean> = {
  message: false,
  membership: false,
  class_reminder: false,
  cancellation: false,
  waitlist_offer: true,
  waitlist_timeout: true,
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

// Notifications — same IA-first standard as Workouts/Nutrition/Recovery,
// applied to an inbox rather than a dashboard: urgent, time-sensitive items
// (spot offers) get their own group ahead of routine updates, instead of
// being told apart only by a background tint. Distinction between the two
// groups now runs on THREE channels, not just color — a section header,
// a solid vs. hollow unread dot, and (for those who do perceive color) the
// gold/data split the palette audit approved — so it still reads correctly
// even if the color signal is lost. Underlying read/unread logic and the
// notification data model are unchanged.
export function NotificationsView({
  initialNotifications,
}: {
  initialNotifications: NotificationRecord[];
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;
  const urgentUnreadCount = notifications.filter(
    (n) => n.readAt === null && TYPE_IS_URGENT[n.type]
  ).length;

  const urgent = notifications.filter((n) => TYPE_IS_URGENT[n.type]);
  const routine = notifications.filter((n) => !TYPE_IS_URGENT[n.type]);

  async function handleMarkRead(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n
      )
    );
    router.refresh();
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    await fetch("/api/notifications/read-all", { method: "POST" });
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    router.refresh();
    setMarkingAll(false);
  }

  const subtitle =
    unreadCount === 0
      ? "All caught up."
      : urgentUnreadCount > 0
        ? `${unreadCount} unread — ${urgentUnreadCount} need${urgentUnreadCount === 1 ? "s" : ""} a response before it expires.`
        : `${unreadCount} unread.`;

  return (
    <section className="anim-rise space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Account</p>
          <h1 className="text-editorial mt-2 text-[28px] leading-[1.05] text-zinc-50 sm:text-[32px]">
            What needs your attention first.
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>

        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="shrink-0 rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:opacity-60"
          >
            {markingAll ? "Marking…" : "Mark all read"}
          </button>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <div className="empty-state p-10">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto h-8 w-8 text-muted-foreground/30"
          >
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="mt-3 text-sm font-medium">No notifications yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Messages from your coach and membership updates will appear here.
          </p>
        </div>
      ) : (
        <>
          {urgent.length > 0 && (
            <div>
              <p className="mb-3 px-1 label-caps text-gold">Needs a response</p>
              <ul className="space-y-2">
                {urgent.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    urgent
                    onMarkRead={() => handleMarkRead(n.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {routine.length > 0 && (
            <div>
              <p className="mb-3 px-1 label-caps">Updates</p>
              <ul className="space-y-2">
                {routine.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    urgent={false}
                    onMarkRead={() => handleMarkRead(n.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NotificationRow({
  notification: n,
  urgent,
  onMarkRead,
}: {
  notification: NotificationRecord;
  urgent: boolean;
  onMarkRead: () => void;
}) {
  const isUnread = n.readAt === null;
  const iconPath = TYPE_ICON[n.type];

  // Two channels carry "unread", not one: the left accent bar (color, for
  // those who perceive it) and a filled vs. hollow dot next to the
  // timestamp (shape, for those who don't). Urgent items always use gold;
  // routine items use --data, the palette's stable "informational, distinct
  // from gold" token — never --primary, which the gold palette repoints to
  // the same hue as gold itself.
  const accent = urgent ? "bg-gold" : "bg-data";
  const chipClass = isUnread
    ? urgent
      ? "bg-gold/15 text-gold"
      : "bg-data/15 text-data"
    : "bg-white/[0.05] text-zinc-500";

  const inner = (
    <div className="surface-card relative overflow-hidden p-4 pl-5">
      {isUnread && <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} aria-hidden="true" />}
      <div className="flex gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${chipClass}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d={iconPath} />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClass}`}>
                {TYPE_LABEL[n.type]}
              </span>

              <p className={`mt-1 text-sm font-medium ${isUnread ? "text-foreground" : "text-foreground/70"}`}>
                {n.title}
              </p>

              <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                {/* Filled dot = unread, hollow ring = read — a shape cue
                    that survives even if color can't be perceived. */}
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${isUnread ? `${accent}` : "border border-white/[0.2]"}`}
                />
                {formatRelativeTime(n.createdAt)}
              </span>
              {isUnread ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMarkRead();
                  }}
                  className="text-[11px] text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
                >
                  Mark read
                </button>
              ) : (
                <span className="h-[18px]" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {n.linkHref ? (
        <Link href={n.linkHref} onClick={() => isUnread && onMarkRead()} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}
