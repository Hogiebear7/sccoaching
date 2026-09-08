import { describe, expect, it } from "vitest";

import { communityDisplayName, isDiscoverable } from "@/lib/community-display-name";
import type { CommunityPrivacyRecord } from "@/lib/db";

function privacy(overrides: Partial<CommunityPrivacyRecord> = {}): CommunityPrivacyRecord {
  return {
    userId: "user-1",
    discoverable: true,
    leaderboardVisible: true,
    showRealName: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("communityDisplayName", () => {
  it("shows the full name when no privacy record exists (visible by default)", () => {
    expect(communityDisplayName("Jamie Fox", undefined)).toBe("Jamie Fox");
  });

  it("shows the full name when showRealName is true", () => {
    expect(communityDisplayName("Jamie Fox", privacy({ showRealName: true }))).toBe("Jamie Fox");
  });

  it("shows first name + last initial when showRealName is false", () => {
    expect(communityDisplayName("Jamie Fox", privacy({ showRealName: false }))).toBe("Jamie F.");
  });

  it("leaves a single-word name unchanged even when showRealName is false", () => {
    expect(communityDisplayName("Jamie", privacy({ showRealName: false }))).toBe("Jamie");
  });

  it("is independent of discoverable — a non-discoverable member still resolves a name", () => {
    expect(communityDisplayName("Jamie Fox", privacy({ discoverable: false, showRealName: false }))).toBe(
      "Jamie F."
    );
  });
});

describe("isDiscoverable", () => {
  it("is true when no privacy record exists (discoverable by default)", () => {
    expect(isDiscoverable(undefined)).toBe(true);
  });

  it("is true when discoverable is true", () => {
    expect(isDiscoverable(privacy({ discoverable: true }))).toBe(true);
  });

  it("is false only when discoverable is explicitly false", () => {
    expect(isDiscoverable(privacy({ discoverable: false }))).toBe(false);
  });

  it("is independent of leaderboardVisible and showRealName", () => {
    expect(isDiscoverable(privacy({ discoverable: true, leaderboardVisible: false, showRealName: false }))).toBe(
      true
    );
  });
});
