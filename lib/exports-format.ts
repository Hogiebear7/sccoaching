// CSV and Excel output for lib/exports.ts. SERVER-ONLY (exceljs).
//
// Formula injection: in a CSV, a cell that starts with = + - @ (or a tab / carriage return) is read as a formula by Excel and Sheets.
// Member-entered text (names, notes) could carry one, so in CSV such text is prefixed with an apostrophe, the standard defence. In the Excel
// files every text value is stored as a text cell, which a spreadsheet never runs as a formula, so it is written exactly as it is (a phone
// number like +353… stays readable). Real numbers are written as numbers.

import { safeText } from "@/lib/csv";
import type { ExportCell, ExportColumn, ExportSheet } from "@/lib/exports";

export { safeText };

function csvCell(value: ExportCell, column: ExportColumn): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") {
    text = column.kind === "percent" ? `${Math.round(value * 1000) / 10}%` : String(value);
  } else {
    text = safeText(value);
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One sheet as CSV (UTF-8 with a byte-order mark, so Excel opens accented names correctly). */
export function toCsv(sheet: ExportSheet): string {
  const lines = [sheet.columns.map((c) => csvCell(c.header, { ...c, kind: "text" })).join(",")];
  for (const row of sheet.rows) lines.push(sheet.columns.map((c) => csvCell(row[c.key] ?? null, c)).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const NUM_FMT: Partial<Record<NonNullable<ExportColumn["kind"]>, string>> = {
  number: "#,##0",
  percent: "0.0%",
  money: "€#,##0.00",
};

/** Several sheets as one Excel workbook: bold frozen header row, filters on, sensible widths, numbers stored as numbers. */
export async function toXlsx(sheets: ExportSheet[], meta: { title: string }): Promise<Buffer> {
  // Loaded only when a workbook is actually written: exceljs is large, and the job registry (which every job run and many tests import)
  // reaches this module through the monthly report job.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "S&C Performance Coaching";
  workbook.title = meta.title;
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? (c.kind === "date" ? 12 : c.kind ? 12 : 18),
      style: NUM_FMT[c.kind ?? "text"] ? { numFmt: NUM_FMT[c.kind ?? "text"] } : {},
    }));
    for (const row of sheet.rows) {
      const out: Record<string, ExportCell> = {};
      for (const c of sheet.columns) {
        out[c.key] = row[c.key] ?? null;
      }
      ws.addRow(out);
    }
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A1526" } };
    header.alignment = { vertical: "middle" };
    header.height = 20;
    if (sheet.rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    // The Summary sheet's Value column mixes text, counts, a percentage and euros: format the two special rows by their measure.
    if (sheet.key === "summary") {
      ws.eachRow((r, i) => {
        if (i === 1) return;
        const measure = String(r.getCell(1).value ?? "");
        if (measure.includes("fill rate")) r.getCell(2).numFmt = "0.0%";
        else if (measure.includes("(€)")) r.getCell(2).numFmt = "€#,##0.00";
      });
    }
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
