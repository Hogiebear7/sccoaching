// Live-render inspection: opens the running app in real Chromium, dumps the
// exact computed styles the user asked for, and captures screenshots.
import { chromium } from "playwright";
import fs from "fs";

const cookieLine = fs
  .readFileSync(process.env.COOKIE_JAR, "utf8")
  .split("\n")
  .find((l) => l.includes("\tsession\t"));
const sessionValue = cookieLine.trim().split("\t").pop();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([
    { name: "session", value: sessionValue, domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const pickFn = (el) => {
      const cs = getComputedStyle(el);
      return {
        className: typeof el.className === "string" ? el.className : "(svg)",
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        border: cs.border,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow.slice(0, 240),
        opacity: cs.opacity,
        outline: cs.outline,
      };
    };
    const body = document.body;
    const wrapper = document.querySelector("div.min-h-screen");
    const panel = document.querySelector(".panel");
    const nav = document.querySelector("nav.fixed ul");
    return {
      bodyDataDesign: body.dataset.design ?? "(none)",
      body: pickFn(body),
      wrapper: wrapper ? pickFn(wrapper) : "(not found)",
      panel: panel ? pickFn(panel) : "(not found)",
      nav: nav ? pickFn(nav) : "(not found)",
    };
  });

  fs.writeFileSync("scripts/tmp-inspect-report.json", JSON.stringify(report, null, 2));
  await page.screenshot({ path: "scripts/tmp-mobile.png", fullPage: false });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.addCookies([
    { name: "session", value: sessionValue, domain: "localhost", path: "/" },
  ]);
  const dpage = await desktop.newPage();
  await dpage.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await dpage.waitForTimeout(1500);
  await dpage.screenshot({ path: "scripts/tmp-desktop.png", fullPage: false });

  await browser.close();
  console.log("done");
})();
