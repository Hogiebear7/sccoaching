// Size-based pricing rules: the four bands, the price setting, and above all that removing members before the end of a period and adding them back afterwards cannot lower
// the band (the band for the next period comes from the highest count seen, not the count on renewal day).
import { describe, expect, it } from "vitest";

import { bandForCount, bandForNextPeriod, bandNotice, parseTenantPrices, recordMemberCount, startNewPeriod } from "@/lib/tenant-pricing";

const ids = (p: string) => ({ b50: `${p}50`, b100: `${p}100`, b149: `${p}149`, b150: `${p}150` });
const VALID = JSON.stringify({ month: ids("price_m"), year: ids("price_y") });

describe("bands", () => {
  it("up to 50, 51 to 100, 101 to 149, 150 or more", () => {
    const at = (n: number) => bandForCount(n);
    expect([at(0), at(1), at(50)]).toEqual(["b50", "b50", "b50"]);
    expect([at(51), at(100)]).toEqual(["b100", "b100"]);
    expect([at(101), at(149)]).toEqual(["b149", "b149"]);
    expect([at(150), at(151), at(5000)]).toEqual(["b150", "b150", "b150"]);
  });
});

describe("the price setting", () => {
  it("needs all eight Stripe price ids, in the right shape", () => {
    expect(parseTenantPrices(VALID)?.year.b149).toBe("price_y149");
    expect(parseTenantPrices(undefined)).toBeNull();
    expect(parseTenantPrices("not json")).toBeNull();
    expect(parseTenantPrices(JSON.stringify({ month: ids("price_m") }))).toBeNull();
    expect(parseTenantPrices(JSON.stringify({ month: ids("price_m"), year: { ...ids("price_y"), b150: "oops" } }))).toBeNull();
  });
});

describe("keeping a gym on the right band", () => {
  it("the peak only goes up within a period", () => {
    let hw = recordMemberCount(undefined, 48, "2026-12-01");
    hw = recordMemberCount(hw, 55, "2026-12-10");
    hw = recordMemberCount(hw, 30, "2026-12-29");
    expect(hw).toEqual({ peak: 55, since: "2026-12-01" });
  });

  it("removing members just before renewal does not lower the next band", () => {
    let hw = recordMemberCount(undefined, 60, "2026-12-01"); // 60 members: band 51-100
    hw = recordMemberCount(hw, 45, "2026-12-30"); // trims to 45 on the last day
    expect(bandForNextPeriod(hw, 45)).toBe("b100"); // still billed as 51-100
  });

  it("the band does come down when the whole period stayed lower", () => {
    const next = startNewPeriod(60, "2027-01-01");
    let hw = recordMemberCount(next, 44, "2027-01-15");
    hw = recordMemberCount(hw, 40, "2027-01-30");
    expect(hw.peak).toBe(60); // the period started at 60, so that is its peak
    const fresh = startNewPeriod(44, "2027-02-01");
    expect(bandForNextPeriod(recordMemberCount(fresh, 40, "2027-02-20"), 40)).toBe("b50");
  });

  it("the band goes up straight away when the live count is above the recorded peak", () => {
    expect(bandForNextPeriod({ peak: 48, since: "2026-12-01" }, 52)).toBe("b100");
  });
});

describe("plan notices", () => {
  it("approach at 90% of the limit, crossed above it, nothing for the top band", () => {
    expect(bandNotice("b50", 44)).toBeNull();
    expect(bandNotice("b50", 45)).toBe("approach");
    expect(bandNotice("b50", 50)).toBe("approach");
    expect(bandNotice("b50", 51)).toBe("crossed");
    expect(bandNotice("b100", 90)).toBe("approach");
    expect(bandNotice("b149", 135)).toBe("approach");
    expect(bandNotice("b149", 150)).toBe("crossed");
    expect(bandNotice("b150", 5000)).toBeNull();
  });
});
