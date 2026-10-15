// Drift guard: every API route that can send a member's data to the AI provider must check consent first. A route that imports the AI library's
// provider-calling functions without calling lib/ai-consent.ts fails this test, so a future AI route cannot ship without the consent check.
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Routes that use lib/ai.ts but send NO member data to the provider (staff-authored library content). Each entry needs a reason.
const NO_MEMBER_DATA = new Map<string, string>([["app/api/staff/exercises/generate/route.ts", "drafts exercise-library text from a staff-typed exercise name; no member data"]]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}
const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

describe("AI consent drift guard", () => {
  const root = process.cwd();
  const routes = routeFiles(path.join(root, "app", "api"));

  it("finds the AI routes (the scan itself works)", () => {
    const aiRoutes = routes.filter((f) => readFileSync(f, "utf8").includes('from "@/lib/ai"'));
    expect(aiRoutes.length).toBeGreaterThanOrEqual(13);
  });

  it("every route that imports a provider-calling function from lib/ai.ts calls the consent check", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      const m = src.match(/import \{([^}]*)\} from "@\/lib\/ai";/);
      if (!m) continue;
      const names = m[1].split(",").map((n) => n.trim()).filter(Boolean);
      const callsProvider = names.some((n) => n !== "isAiConfigured" && !n.startsWith("type ") && !n.startsWith("AI_NOT_CONFIGURED") && !n.startsWith("parse"));
      if (!callsProvider) continue;
      const r = rel(root, file);
      if (NO_MEMBER_DATA.has(r)) continue;
      if (!/requireAiConsent|requireAiConsentForMember|hasAiConsent/.test(src)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });

  it("the consent check comes before the request body is read in each route that enforces it", () => {
    const bad: string[] = [];
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      const consentAt = src.indexOf("requireAiConsent(");
      if (consentAt === -1) continue;
      const bodyAt = src.search(/await request\.(json|formData|text)\(\)/);
      if (bodyAt !== -1 && consentAt > bodyAt) bad.push(rel(root, file));
    }
    expect(bad).toEqual([]);
  });

  // The web screens that talk to the AI provider must offer the choice and handle the server's refusal; Settings must let the member withdraw.
  it("the web AI screens use the consent card and handle the refusal; Settings offers the switch", () => {
    const read = (p: string) => readFileSync(path.join(root, p), "utf8");
    for (const screen of ["app/(dashboard)/dashboard/messages/AiChat.tsx", "app/(dashboard)/dashboard/nutrition/NutritionAiCoach.tsx"]) {
      const src = read(screen);
      expect(src, screen).toContain("useAiConsent");
      expect(src, screen).toContain("AiConsentCard");
      expect(src, screen).toContain("AI_CONSENT_REQUIRED_CODE");
    }
    expect(read("app/(dashboard)/dashboard/settings/SettingsView.tsx")).toContain("AiFeaturesPanel");
    expect(read("components/settings/AiFeaturesPanel.tsx")).toContain("consent.withdraw");
  });
});
