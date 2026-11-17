import { describe, expect, it } from "vitest";

import { currentSeason, easterSunday, seasonKeyFor } from "@/lib/seasons";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("seasons", () => {
  it("Christmas runs 1 Dec to 6 Jan", () => {
    expect(currentSeason(at("2026-11-30")).season).toBeNull();
    expect(currentSeason(at("2026-12-01")).season?.key).toBe("christmas");
    expect(currentSeason(at("2027-01-06")).season?.key).toBe("christmas");
    expect(currentSeason(at("2027-01-07")).season).toBeNull();
  });

  it("New Year: the message runs 1 to 6 January, the fireworks only 1 and 2 January", () => {
    expect(currentSeason(at("2027-01-01")).overlay).toMatchObject({ key: "new-year", fireworks: true });
    expect(currentSeason(at("2027-01-02")).overlay).toMatchObject({ fireworks: true });
    expect(currentSeason(at("2027-01-03")).overlay).toMatchObject({ key: "new-year", fireworks: false });
    expect(currentSeason(at("2027-01-06")).overlay).toMatchObject({ key: "new-year", fireworks: false });
    expect(currentSeason(at("2027-01-07")).overlay).toBeNull();
    expect(currentSeason(at("2027-01-07")).season).toBeNull();
    expect(currentSeason(at("2026-12-25")).overlay).toBeNull();
  });

  it("each event shows on its own days only, with the right pieces", () => {
    // Valentine's: the one day.
    expect(currentSeason(at("2027-02-13")).season).toBeNull();
    expect(currentSeason(at("2027-02-14")).season).toMatchObject({ key: "valentines", particle: "hearts" });
    expect(currentSeason(at("2027-02-15")).season).toBeNull();
    // St Patrick's: the two days before, and the day.
    expect(currentSeason(at("2027-03-14")).season).toBeNull();
    expect(currentSeason(at("2027-03-15")).season).toMatchObject({ key: "stpatricks", particle: "shamrocks" });
    expect(currentSeason(at("2027-03-17")).season?.key).toBe("stpatricks");
    expect(currentSeason(at("2027-03-18")).season).toBeNull();
    // Halloween: the last eight days of October.
    expect(currentSeason(at("2026-10-23")).season).toBeNull();
    expect(currentSeason(at("2026-10-24")).season).toMatchObject({ key: "halloween", particle: "cobwebs" });
    expect(currentSeason(at("2026-10-31")).season?.key).toBe("halloween");
    expect(currentSeason(at("2026-11-01")).season).toBeNull();
    // No summer or autumn theme.
    expect(currentSeason(at("2027-07-04")).season).toBeNull();
    expect(currentSeason(at("2026-09-20")).season).toBeNull();
    expect(currentSeason(at("2027-05-10")).season).toBeNull();
  });

  it("Easter runs from the Thursday before Easter Sunday to the Tuesday after", () => {
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(seasonKeyFor(2027, 3, 24)).toBeNull(); // Wednesday before
    expect(seasonKeyFor(2027, 3, 25)).toBe("easter"); // Holy Thursday
    expect(seasonKeyFor(2027, 3, 28)).toBe("easter"); // Easter Sunday
    expect(seasonKeyFor(2027, 3, 30)).toBe("easter"); // Easter Tuesday
    expect(seasonKeyFor(2027, 3, 31)).toBeNull();
    expect(seasonKeyFor(2026, 4, 2)).toBe("easter");
    expect(seasonKeyFor(2026, 4, 7)).toBe("easter");
    expect(seasonKeyFor(2026, 4, 8)).toBeNull();
  });

  it("the Happy Christmas message starts on 18 December; the snow look starts on 1 December", () => {
    expect(currentSeason(at("2026-12-01")).greeting).toBeNull();
    expect(currentSeason(at("2026-12-17")).greeting).toBeNull();
    expect(currentSeason(at("2026-12-18")).greeting).toBe("Happy Christmas");
    expect(currentSeason(at("2026-12-31")).greeting).toBe("Happy Christmas");
    // 1 to 6 January: the New Year message takes over.
    expect(currentSeason(at("2027-01-01")).greeting).toBeNull();
    expect(currentSeason(at("2027-01-01")).overlay?.message).toContain("Happy New Year");
    expect(currentSeason(at("2027-02-14")).greeting).toBe("Happy Valentine's Day");
    // A forced preview always has its greeting.
    expect(currentSeason(at("2026-05-10"), { forceKey: "christmas" }).greeting).toBe("Happy Christmas");
  });

  it("uses the Irish date, not the server's", () => {
    // 23:30 UTC on 30 Nov is already 1 Dec? No: Ireland is on GMT in winter, so it's still 30 Nov.
    expect(currentSeason(new Date("2026-11-30T23:30:00Z")).season).toBeNull();
    expect(currentSeason(new Date("2026-12-01T00:30:00Z")).season?.key).toBe("christmas");
  });

  it("can be switched off, or forced for a preview", () => {
    expect(currentSeason(at("2026-12-10"), { enabled: false }).season).toBeNull();
    expect(currentSeason(at("2026-05-10"), { forceKey: "christmas" }).season?.key).toBe("christmas");
    expect(currentSeason(at("2026-05-10"), { forceKey: "nonsense" }).season).toBeNull();
  });
});
