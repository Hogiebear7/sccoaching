import { describe, expect, it } from "vitest";

import { INJURY_GUIDANCE_RULE, triageInjuryMessage, triageReplyFor } from "@/lib/injury-triage";

const level = (text: string) => triageInjuryMessage(text)?.level ?? null;
const flags = (text: string) => triageInjuryMessage(text)?.flags ?? [];

describe("emergency red flags", () => {
  it.each([
    ["I've got chest pain when I run", "chest_pain"],
    ["there's pressure in my chest", "chest_pain"],
    ["I can't catch my breath after squats", "breathing"],
    ["I nearly passed out on the last set", "collapse"],
    ["I hit my head on the bar and I'm feeling confused", "head_injury_symptoms"],
    ["my face is drooping and my speech is slurred speech", "stroke_signs"],
    ["the bone is sticking out", "open_or_deformed"],
    ["my finger looks deformed", "open_or_deformed"],
    ["it's bleeding heavily", "heavy_bleeding"],
    ["I've lost control of my bladder since the deadlift", "cauda_equina"],
    ["numbness in my groin and inner thighs", "cauda_equina"],
  ])("%s", (text, flag) => {
    expect(level(text)).toBe("emergency");
    expect(flags(text)).toContain(flag);
  });

  it("uses a fixed reply that sends them to 112 or 999 and gives no diagnosis", () => {
    const reply = triageInjuryMessage("chest pain")!.reply;
    expect(reply).toMatch(/112 or 999/);
    expect(reply).toMatch(/AI coach, not a medical service/);
    expect(reply).not.toMatch(/\b(you have|it is a|sounds like|probably|strain|sprain|tear)\b/i);
  });
});

describe("urgent: get seen today", () => {
  it.each([
    ["I can't put any weight on my ankle", "cannot_bear_weight"],
    ["I felt a pop in my knee", "pop_snap"],
    ["my knee is locked", "locked_joint"],
    ["my calf is swollen and hot", "calf_swelling"],
    ["pins and needles down my leg since yesterday", "numb_tingling_limb"],
    ["I have a fever and my knee is swollen", "fever_with_joint"],
    ["unbearable pain in my shoulder", "severe_pain"],
    ["I fell off the box and landed on my wrist", "major_trauma"],
  ])("%s", (text, flag) => {
    expect(level(text)).toBe("urgent");
    expect(flags(text)).toContain(flag);
  });

  it("says to be seen today, to avoid training the area, and never gives a timeline", () => {
    const reply = triageReplyFor("urgent");
    expect(reply).toMatch(/seen today/);
    expect(reply).toMatch(/don't train the affected area/);
    expect(reply).not.toMatch(/\b\d+\s*(days?|weeks?|months?)\b/i);
  });
});

describe("pregnancy", () => {
  it.each([
    "I'm 20 weeks pregnant and noticed some bleeding after my walk",
    "my waters broke",
    "I've had vaginal bleeding",
    "the baby has stopped moving much since the workout",
    "I have severe stomach pain and I'm pregnant",
  ])("%s", (text) => {
    expect(level(text)).toBe("pregnancy");
  });
  it("sends them to the maternity unit or GP", () => {
    expect(triageReplyFor("pregnancy")).toMatch(/maternity unit or GP/);
  });
});

describe("the most serious level wins", () => {
  it("emergency beats urgent", () => {
    expect(level("I fell off a ladder and now I have chest pain")).toBe("emergency");
  });
  it("pregnancy beats urgent", () => {
    expect(level("I fell down the stairs and I'm pregnant with bleeding")).toBe("pregnancy");
  });
});

describe("ordinary training talk is left to the coach", () => {
  it.each([
    "My shoulder is a bit sore after bench day, what should I train tomorrow?",
    "my quads are really sore from squats",
    "should I deadlift with a slightly tight lower back?",
    "how many sets should I do for chest",
    "my knee feels a bit achy on stairs",
    "I tweaked my hamstring a little but I can walk fine",
    "what's a good warm up for my hips",
  ])("%s", (text) => {
    expect(triageInjuryMessage(text)).toBeNull();
  });

  it("copes with curly apostrophes, capitals and extra spaces", () => {
    expect(level("I  CAN’T   put weight on it")).toBe("urgent");
  });

  it("never puts the member's own words in the flags", () => {
    expect(JSON.stringify(triageInjuryMessage("my secret chest pain 12345")?.flags)).not.toContain("12345");
  });
});

describe("the AI's injury rule", () => {
  it("forbids diagnosis, timelines and AI-written rehab, and points to a professional and the Rehab section", () => {
    expect(INJURY_GUIDANCE_RULE).toMatch(/not medical advice/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/Never diagnose/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/Never give a recovery time/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/Never write a rehab programme/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/physio or GP/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/Rehab/);
    expect(INJURY_GUIDANCE_RULE).toMatch(/112 or 999/);
  });
});
