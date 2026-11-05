// Production was configured with the earlier euro-named AI budgets (AI_ALLOWANCE_PAID_EUR ... plus AI_USD_PER_EUR). The code reads USD names; these tests pin
// that the euro names still work (converted with AI_USD_PER_EUR), that USD wins when both are set, and that a euro budget with no usable rate is NOT SET.
// All numbers are TEST values.
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BASES = ["AI_ALLOWANCE_FREE", "AI_ALLOWANCE_TRIAL", "AI_ALLOWANCE_PAID", "AI_ALLOWANCE_COMPLIMENTARY", "AI_STAFF", "AI_APP_CEILING", "AI_TRIAL_POOL", "AI_PAID_POOL", "AI_COMPLIMENTARY_POOL"];
const TOUCHED = [...BASES.flatMap((b) => [`${b}_USD`, `${b}_EUR`]), "AI_USD_PER_EUR", "ANTHROPIC_MODEL", "DATA_DIR"];
const saved: Record<string, string | undefined> = {};
let dir: string;

const setEuros = () => {
  const v: Record<string, string> = { AI_ALLOWANCE_FREE: "0.1", AI_ALLOWANCE_TRIAL: "0.25", AI_ALLOWANCE_PAID: "1", AI_ALLOWANCE_COMPLIMENTARY: "0.5", AI_STAFF: "5", AI_APP_CEILING: "50", AI_TRIAL_POOL: "5", AI_PAID_POOL: "20", AI_COMPLIMENTARY_POOL: "5" };
  for (const [b, n] of Object.entries(v)) process.env[`${b}_EUR`] = n;
};

beforeEach(() => {
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = fs.mkdtempSync(path.join(tmpdir(), "ai-eur-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("euro-named AI budgets", () => {
  it("are converted with AI_USD_PER_EUR and satisfy the same configuration check as the USD names", async () => {
    setEuros();
    process.env.AI_USD_PER_EUR = "2"; // deliberately not 1, so the conversion is visible
    const { aiAllowanceBudgets, aiPoolBudgets, aiAllowanceConfigured } = await import("@/lib/ai-allowance");
    expect(aiAllowanceBudgets()).toEqual({ free: 0.2, trial: 0.5, paid: 2, complimentary: 1 });
    expect(aiPoolBudgets()).toEqual({ staff: 10, ceiling: 100, trial: 10, paid: 40, complimentary: 10 });
    expect(aiAllowanceConfigured()).toBe(true);
  });

  it("without a usable AI_USD_PER_EUR they are NOT SET, never converted at a guessed rate (fail closed)", async () => {
    setEuros();
    const { aiAllowanceBudgets, aiPoolBudgets, aiAllowanceConfigured } = await import("@/lib/ai-allowance");
    for (const bad of [undefined, "", "0", "-1", "abc"]) {
      if (bad === undefined) delete process.env.AI_USD_PER_EUR;
      else process.env.AI_USD_PER_EUR = bad;
      expect(Object.values(aiAllowanceBudgets()).every((v) => v === null)).toBe(true);
      expect(Object.values(aiPoolBudgets()).every((v) => v === null)).toBe(true);
      expect(aiAllowanceConfigured()).toBe(false);
    }
  });

  it("the USD name wins when both are set, and a mix of names works one budget at a time", async () => {
    setEuros();
    process.env.AI_USD_PER_EUR = "2";
    process.env.AI_ALLOWANCE_PAID_USD = "7";
    const { aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    expect(aiAllowanceBudgets().paid).toBe(7);
    expect(aiAllowanceBudgets().trial).toBe(0.5);
  });

  it("0 stays valid (it means none), and an invalid euro value is NOT SET", async () => {
    setEuros();
    process.env.AI_USD_PER_EUR = "2";
    process.env.AI_ALLOWANCE_FREE_EUR = "0";
    process.env.AI_ALLOWANCE_TRIAL_EUR = "abc";
    const { aiAllowanceBudgets } = await import("@/lib/ai-allowance");
    expect(aiAllowanceBudgets().free).toBe(0);
    expect(aiAllowanceBudgets().trial).toBeNull();
  });
});
