// createNotification keeps each member's newest MAX_NOTIFICATIONS_PER_USER
// notifications, against a real datastore file in a temp directory.
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Db = typeof import("@/lib/db");

let db: Db;
let dir: string;

function note(userId: string, i: number) {
  return {
    id: `${userId}-${i}`,
    userId,
    type: "message" as const,
    title: `n${i}`,
    body: "",
    readAt: null,
    linkHref: null,
    dedupeKey: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "notif-retention-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("notification retention", () => {
  it("keeps only a member's newest notifications", () => {
    const cap = db.MAX_NOTIFICATIONS_PER_USER;
    for (let i = 0; i < cap + 5; i++) db.createNotification(note("a", i));

    const kept = db.findNotificationsByUserId("a");
    expect(kept).toHaveLength(cap);
    expect(kept[0].id).toBe(`a-${cap + 4}`);
    expect(kept.some((n) => n.id === "a-4")).toBe(false);
    expect(kept.some((n) => n.id === "a-5")).toBe(true);
  });

  it("never drops another member's notifications", () => {
    db.createNotification(note("b", 0));
    for (let i = 0; i < db.MAX_NOTIFICATIONS_PER_USER + 10; i++) db.createNotification(note("a", i));

    expect(db.findNotificationsByUserId("b").map((n) => n.id)).toEqual(["b-0"]);
  });
});
