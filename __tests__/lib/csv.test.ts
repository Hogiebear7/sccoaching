// lib/csv.ts: the CSV text behind every "Export this view" button and the server's CSV exports.
import { describe, expect, it } from "vitest";

import { csvCell, csvText, safeText } from "@/lib/csv";

describe("csv", () => {
  it("guards text a spreadsheet would run as a formula", () => {
    expect(safeText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("Aoife")).toBe("Aoife");
  });

  it("quotes commas, quotes and line breaks; leaves numbers and blanks plain", () => {
    expect(csvCell('Byrne, "Jo"')).toBe('"Byrne, ""Jo"""');
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
  });

  it("writes a byte-order mark, a header row and Windows line endings", () => {
    expect(csvText(["Name", "Classes"], [["Aoife", 3]])).toBe("﻿Name,Classes\r\nAoife,3\r\n");
  });
});
