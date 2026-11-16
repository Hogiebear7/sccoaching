import { describe, expect, it } from "vitest";

import { PARQ_QUESTIONS, PARQ_VERSION, parqIsCurrent, parqYesItems, validateParqSubmission } from "@/lib/parq";

const allNo = () => Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.id, { yes: false, note: "" }]));
const good = (over: Record<string, unknown> = {}) => ({ answers: allNo(), consent: true, declaration: true, ...over });

describe("PAR-Q", () => {
  it("accepts a complete submission and records version and time", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const r = validateParqSubmission(good(), now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.version).toBe(PARQ_VERSION);
      expect(r.record.answeredAt).toBe(now.toISOString());
    }
  });

  it("refuses a missing answer, or missing consent or declaration", () => {
    const missing = allNo();
    delete missing.heart;
    expect(validateParqSubmission(good({ answers: missing })).ok).toBe(false);
    expect(validateParqSubmission(good({ consent: false })).ok).toBe(false);
    expect(validateParqSubmission(good({ declaration: undefined })).ok).toBe(false);
  });

  it("trims and caps notes", () => {
    const a = allNo();
    a.bp = { yes: true, note: `  ${"x".repeat(500)}  ` };
    const r = validateParqSubmission(good({ answers: a }));
    expect(r.ok && r.record.answers.bp.note.length).toBe(300);
  });

  it("is current for 12 months, then asks again", () => {
    const r = validateParqSubmission(good(), new Date("2026-01-01T00:00:00Z"));
    if (!r.ok) throw new Error("setup");
    expect(parqIsCurrent(r.record, new Date("2026-12-31T00:00:00Z"))).toBe(true);
    expect(parqIsCurrent(r.record, new Date("2027-01-02T00:00:00Z"))).toBe(false);
    expect(parqIsCurrent(null)).toBe(false);
  });

  it("lists only the Yes answers", () => {
    const a = allNo();
    a.conditions = { yes: true, note: "Type 2 diabetes" };
    const r = validateParqSubmission(good({ answers: a }));
    if (!r.ok) throw new Error("setup");
    expect(parqYesItems(r.record)).toEqual([{ question: PARQ_QUESTIONS.find((q) => q.id === "conditions")!.text, note: "Type 2 diabetes" }]);
  });
});
