import { describe, expect, it } from "vitest";

import { checkinState, chooseCheckin, gymCheckinCode, liveCheckinCode, readAnyCheckinCode, readCheckinCode, secondsUntilChange, selfCheckinModeOf, type CheckinCandidate } from "@/lib/class-checkin";

const secret = "test-secret";

describe("check-in code", () => {
  it("round-trips for the primary gym and a tenant gym", () => {
    expect(readCheckinCode(secret, gymCheckinCode(secret, null))).toEqual({ gymId: null });
    expect(readCheckinCode(secret, gymCheckinCode(secret, "gym-7"))).toEqual({ gymId: "gym-7" });
  });
  it("rejects tampering, other secrets and junk", () => {
    const code = gymCheckinCode(secret, "gym-7");
    expect(readCheckinCode(secret, code.replace("gym-7", "gym-8"))).toBeUndefined();
    expect(readCheckinCode("other", code)).toBeUndefined();
    expect(readCheckinCode(secret, "hello")).toBeUndefined();
    expect(readCheckinCode(secret, 42)).toBeUndefined();
    expect(readCheckinCode(secret, "sc-checkin:gym-7:")).toBeUndefined();
  });
});

describe("live code", () => {
  const t = Date.parse("2026-12-01T18:00:30Z");
  it("is accepted now and one minute later, then runs out", () => {
    const code = liveCheckinCode(secret, "gym-7", t);
    expect(readAnyCheckinCode(secret, code, t)).toMatchObject({ kind: "live", gymId: "gym-7" });
    expect(readAnyCheckinCode(secret, code, t + 60_000)).toMatchObject({ kind: "live", gymId: "gym-7" });
    expect(readAnyCheckinCode(secret, code, t + 3 * 60_000)).toMatchObject({ kind: "expired", gymId: "gym-7" });
  });
  it("changes every minute and cannot be forged or moved to another period or gym", () => {
    const a = liveCheckinCode(secret, null, t);
    expect(liveCheckinCode(secret, null, t + 60_000)).not.toBe(a);
    expect(readAnyCheckinCode(secret, a.replace(":primary:", ":gym-9:"), t)).toBeUndefined();
    const parts = a.split(":");
    parts[2] = String(Number(parts[2]) + 1);
    expect(readAnyCheckinCode(secret, parts.join(":"), t + 60_000)).toBeUndefined();
    expect(readAnyCheckinCode("other", a, t)).toBeUndefined();
  });
  it("a weekly code lasts the week (plus a short grace) and a daily one the day", () => {
    const week = liveCheckinCode(secret, "gym-7", t, "week");
    expect(readAnyCheckinCode(secret, week, t + 5 * 86_400_000)).toMatchObject({ kind: "live", period: "week" });
    expect(readAnyCheckinCode(secret, week, t + 8 * 86_400_000)).toMatchObject({ kind: "expired" });
    const day = liveCheckinCode(secret, "gym-7", t, "day");
    expect(readAnyCheckinCode(secret, day, t + 3 * 3_600_000)).toMatchObject({ kind: "live", period: "day" });
    expect(readAnyCheckinCode(secret, day, t + 2 * 86_400_000)).toMatchObject({ kind: "expired" });
  });
  it("weeks change on Monday morning", () => {
    expect(secondsUntilChange(Date.parse("2026-12-06T23:59:00Z"), "week")).toBe(60); // Sunday night: a minute to Monday
    expect(secondsUntilChange(Date.parse("2026-12-07T00:00:00Z"), "week")).toBe(604_800);
  });
  it("reports when the next change is due", () => {
    expect(secondsUntilChange(Date.parse("2026-12-01T00:00:00Z") + 30_000, "minute")).toBe(30);
    expect(secondsUntilChange(Date.parse("2026-12-01T23:59:00Z"), "day")).toBe(60);
  });
  it("a code cannot be relabelled as another schedule", () => {
    const week = liveCheckinCode(secret, null, t, "week");
    expect(readAnyCheckinCode(secret, week.replace(":w", ":d"), t)).toBeUndefined();
  });
  it("is not valid as a poster code", () => {
    expect(readCheckinCode(secret, liveCheckinCode(secret, null, Date.now()))).toBeUndefined();
  });
});

describe("selfCheckinModeOf", () => {
  it("defaults to off", () => {
    expect(selfCheckinModeOf(undefined)).toBe("off");
    expect(selfCheckinModeOf({})).toBe("off");
    expect(selfCheckinModeOf({ selfCheckin: "nonsense" })).toBe("off");
    expect(selfCheckinModeOf({ selfCheckin: "live" })).toBe("live");
  });
});

// Winter dates: Dublin is UTC, so a 18:00 class starts 18:00Z.
const at = (hhmm: string) => Date.parse(`2026-12-01T${hhmm}:00Z`);

describe("check-in window", () => {
  it("opens 30 minutes before and closes at the end", () => {
    expect(checkinState("2026-12-01", "18:00", 45, at("17:20"))).toBe("too_early");
    expect(checkinState("2026-12-01", "18:00", 45, at("17:30"))).toBe("open");
    expect(checkinState("2026-12-01", "18:00", 45, at("18:44"))).toBe("open");
    expect(checkinState("2026-12-01", "18:00", 45, at("18:46"))).toBe("ended");
  });
});

const cand = (over: Partial<CheckinCandidate>): CheckinCandidate => ({
  bookingId: "b1", classId: "c1", title: "Boxing", date: "2026-12-01", startTime: "18:00", durationMins: 45, attendedAt: null, ...over,
});

describe("chooseCheckin", () => {
  it("checks in the open class", () => {
    expect(chooseCheckin([cand({})], at("17:45"))).toEqual({ kind: "checked_in", bookingId: "b1", title: "Boxing" });
  });
  it("says already when scanned twice", () => {
    expect(chooseCheckin([cand({ attendedAt: "x" })], at("17:45"))).toEqual({ kind: "already", title: "Boxing" });
  });
  it("says too early with the start time", () => {
    expect(chooseCheckin([cand({})], at("16:00"))).toEqual({ kind: "too_early", title: "Boxing", startTime: "18:00" });
  });
  it("does nothing when nothing is booked or the class is over", () => {
    expect(chooseCheckin([], at("17:45")).kind).toBe("none");
    expect(chooseCheckin([cand({})], at("19:30")).kind).toBe("none");
  });
  it("picks the earliest unattended open class when two overlap", () => {
    const second = cand({ bookingId: "b2", title: "Mobility", startTime: "18:15" });
    expect(chooseCheckin([second, cand({})], at("18:20"))).toMatchObject({ kind: "checked_in", bookingId: "b1" });
  });
});
