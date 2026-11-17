import { describe, expect, it } from "vitest";

import { currentSeason, easterSunday, seasonKeyFor } from "@/lib/seasons";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("seasons", () => {
  it("Christmas runs 1 Dec to 6 Jan, and only Christmas is ready", () => {
    expect(currentSeason(at("2026-11-30")).season).toBeNull();
    expect(currentSeason(at("2026-12-01")).season?.key).toBe("christmas");
    expect(currentSeason(at("2027-01-06")).season?.key).toBe("christmas");
    expect(currentSeason(at("2027-01-07")).season).toBeNull();
  });

  it("New Year adds fireworks and a message on 1 and 2 January only", () => {
    expect(currentSeason(at("2027-01-01")).overlay).toMatchObject({ key: "new-year", fireworks: true });
    expect(currentSeason(at("2027-01-02")).overlay?.key).toBe("new-year");
    expect(currentSeason(at("2027-01-03")).overlay).toBeNull();
    expect(currentSeason(at("2026-12-25")).overlay).toBeNull();
  });

  it("the other seasons are on the calendar but not shown until their artwork is ready", () => {
    expect(seasonKeyFor(2027, 2, 10)).toBe("valentines");
    expect(seasonKeyFor(2027, 3, 14)).toBe("stpatricks");
    expect(seasonKeyFor(2027, 7, 4)).toBe("summer");
    expect(seasonKeyFor(2026, 9, 20)).toBe("autumn");
    expect(seasonKeyFor(2026, 10, 25)).toBe("halloween");
    expect(currentSeason(at("2027-02-10")).season).toBeNull();
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
    expect(currentSeason(at("2026-06-10"), { forceKey: "christmas" }).season?.key).toBe("christmas");
    expect(currentSeason(at("2026-06-10"), { forceKey: "nonsense" }).season).toBeNull();
  });
});
