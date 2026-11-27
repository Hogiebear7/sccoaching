import { describe, expect, it } from "vitest";

import { parseInviteList } from "@/lib/bulk-invite-parse";
import { isOldExcelFileName, isXlsxFileName, spreadsheetRowsToText } from "@/lib/spreadsheet-to-text";

describe("spreadsheetRowsToText", () => {
  it("turns rows into tab-separated lines the invite reader understands", () => {
    const text = spreadsheetRowsToText([
      ["Name", "Email"],
      ["Aoife Byrne", "aoife@example.test"],
      [null, "no-name@example.test"],
      [],
      ["", ""],
    ]);
    const parsed = parseInviteList(text);
    expect(parsed.rows.map((r) => r.email)).toEqual(["aoife@example.test", "no-name@example.test"]);
    expect(parsed.rows[0].name).toBe("Aoife Byrne");
    expect(parsed.invalid).toEqual([]);
  });
  it("handles numbers, hyperlink cells and stray line breaks", () => {
    const text = spreadsheetRowsToText([[42, { text: "link@example.test", url: "mailto:link@example.test" }], ["a\nb", "c@example.test"]]);
    expect(text.split("\n")).toHaveLength(2);
    expect(parseInviteList(text).rows.map((r) => r.email)).toEqual(["link@example.test", "c@example.test"]);
  });
  it("recognises file types", () => {
    expect(isXlsxFileName("Members.XLSX")).toBe(true);
    expect(isOldExcelFileName("old.xls")).toBe(true);
    expect(isXlsxFileName("list.csv")).toBe(false);
    expect(isOldExcelFileName("a.xlsx")).toBe(false);
  });
});
