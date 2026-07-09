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

const TYPE_IS_GOLD: Record<NotificationType, boolean> = {
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

export function NotificationsView({
  initialNotifications,
}: {
  initialNotifications: NotificationRecord[];
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

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

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-caps">Account</p>
          <h1 className="text-display mt-1 text-[28px] leading-tight">Notifications</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>

        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-60"
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
        <ul className="space-y-2">
          {notifications.map((n) => {
            const isUnread = n.readAt === null;
            const isGold = TYPE_IS_GOLD[n.type];
            const iconPath = TYPE_ICON[n.type];

            const inner = (
              <div
                className={`flex gap-3 rounded-[10px] border p-4 transition ${
                  isUnread
                    ? isGold
                      ? "border-gold/25 bg-gold/5"
                      : "border-primary/25 bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                {/* Icon */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    isUnread
                      ? isGold
                        ? "bg-gold/15 text-gold"
                        : "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
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
                      {/* Type chip */}
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          isUnread
                            ? isGold
                              ? "bg-gold/15 text-gold"
                              : "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {TYPE_LABEL[n.type]}
                      </span>

                      {/* Title */}
                      <p
                        className={`mt-1 text-sm font-medium ${
                          isUnread ? "text-foreground" : "text-foreground/70"
                        }`}
                      >
                        {n.title}
                      </p>

                      {/* Body */}
                      <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="text-[11px] text-muted-foreground/50">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleMarkRead(n.id);
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
            );

            return (
              <li key={n.id}>
                {n.linkHref ? (
                  <Link
                    href={n.linkHref}
                    onClick={() => isUnread && handleMarkRead(n.id)}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
