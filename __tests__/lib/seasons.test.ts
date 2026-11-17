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

  it("every season shows on its dates, with the right pieces", () => {
    expect(currentSeason(at("2027-02-10")).season).toMatchObject({ key: "valentines", particle: "hearts" });
    expect(currentSeason(at("2027-03-14")).season).toMatchObject({ key: "stpatricks", particle: "shamrocks" });
    expect(currentSeason(at("2027-03-27")).season).toMatchObject({ key: "easter", particle: "eggs" });
    expect(currentSeason(at("2027-07-04")).season).toBeNull();
    expect(currentSeason(at("2026-09-20")).season).toBeNull();
    expect(currentSeason(at("2026-10-25")).season).toMatchObject({ key: "halloween", particle: "cobwebs" });
    expect(currentSeason(at("2027-04-20")).season).toBeNull();
    expect(currentSeason(at("2027-05-10")).season).toBeNull();
    expect(seasonKeyFor(2027, 2, 10)).toBe("valentines");
  });

  it("works out Easter, and a week either side", () => {
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(seasonKeyFor(2027, 3, 22)).toBe("easter");
    expect(seasonKeyFor(2027, 4, 4)).toBe("easter");
    expect(seasonKeyFor(2027, 4, 6)).toBeNull();
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
