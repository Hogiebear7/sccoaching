import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  buildExportSheet,
  buildMasterWorkbook,
  EXPORT_RANGES,
  EXPORT_SHEET_KEYS,
  type ExportRange,
  type ExportSheetKey,
} from "@/lib/exports";
import { toCsv, toXlsx } from "@/lib/exports-format";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// GET /api/staff/exports?sheet=members|memberships|classes|bookings|app-access|master&format=csv|xlsx&range=30d|90d|12m|all
// Spreadsheet downloads for the Reports & exports page (docs/admin-revamp-plan-2026-10.md, slice S1). Admin only (reports.view). Every sheet is
// built for the signed-in staff member's own gym (lib/exports.ts scopes before reading), never from a client-supplied gym. "master" is the
// whole workbook (Excel only): Summary plus every sheet.
export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;
  if (!staffUser || staffUser.archivedAt) {
    return NextResponse.json({ success: false, message: "You must be signed in to export." }, { status: 401 });
  }
  if (!can(staffUser.role, "reports.view")) {
    return NextResponse.json({ success: false, message: "Only admins can export reports." }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const sheet = params.get("sheet") ?? "master";
  const format = params.get("format") ?? "xlsx";
  const range = (params.get("range") ?? "90d") as ExportRange;
  if (sheet !== "master" && !EXPORT_SHEET_KEYS.includes(sheet as ExportSheetKey)) {
    return NextResponse.json({ success: false, message: "Unknown sheet." }, { status: 400 });
  }
  if (format !== "csv" && format !== "xlsx") {
    return NextResponse.json({ success: false, message: "Format must be csv or xlsx." }, { status: 400 });
  }
  if (!EXPORT_RANGES.includes(range)) {
    return NextResponse.json({ success: false, message: "Unknown period." }, { status: 400 });
  }
  if (sheet === "master" && format === "csv") {
    return NextResponse.json({ success: false, message: "The master workbook is Excel only; download sheets one at a time as CSV." }, { status: 400 });
  }

  const actor = { gymId: staffUser.gymId ?? null };
  const date = new Date().toISOString().slice(0, 10);
  const base = `sc-${sheet === "master" ? "master" : sheet}-${range}-${date}`;
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${base}.${ext}"`,
    "Cache-Control": "no-store",
  });

  if (format === "csv") {
    const csv = toCsv(buildExportSheet(sheet as ExportSheetKey, actor, range));
    return new NextResponse(csv, { status: 200, headers: headers("text/csv; charset=utf-8", "csv") });
  }
  const sheets = sheet === "master" ? buildMasterWorkbook(actor, range) : [buildExportSheet(sheet as ExportSheetKey, actor, range)];
  const xlsx = await toXlsx(sheets, { title: sheet === "master" ? "S&C master report" : sheets[0].title });
  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
  });
}
