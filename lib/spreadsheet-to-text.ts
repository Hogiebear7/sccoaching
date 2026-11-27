// Turns the rows read from an Excel sheet into the plain text the invite list reader already understands (one row per line, cells separated by tabs), so an Excel
// file and a pasted list go through exactly the same checks. Pure; the Excel file itself is read in the browser (components/staff/BulkInviteForm.tsx).
export const SPREADSHEET_MAX_ROWS = 2000;

export function spreadsheetRowsToText(rows: readonly (readonly unknown[])[]): string {
  const lines: string[] = [];
  for (const row of rows.slice(0, SPREADSHEET_MAX_ROWS)) {
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) return "";
      if (cell instanceof Date) return "";
      // A cell holding an email can come back as a hyperlink object ({ text, url }) or rich text in some files.
      if (typeof cell === "object") {
        const text = (cell as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return String(cell);
    });
    // Tabs or line breaks inside a cell would split it into several cells or lines.
    const line = cells.map((c) => c.replace(/[\t\r\n]+/g, " ").trim()).join("\t");
    if (line.replace(/\t/g, "").trim() !== "") lines.push(line);
  }
  return lines.join("\n");
}

/** True for the Excel file type we can read. The old .xls format is not supported and the message says what to do. */
export function isXlsxFileName(name: string): boolean {
  return /\.xlsx$/i.test(name.trim());
}

export function isOldExcelFileName(name: string): boolean {
  return /\.xls$/i.test(name.trim());
}
