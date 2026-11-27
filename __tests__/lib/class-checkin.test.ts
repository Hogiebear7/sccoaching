import { describe, expect, it } from "vitest";

import { checkinState, chooseCheckin, gymCheckinCode, readCheckinCode, type CheckinCandidate } from "@/lib/class-checkin";

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
