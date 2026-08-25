import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteFinanceLedgerEntry, findFinanceLedgerEntryById } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "finance.view");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "An entry id is required." }, { status: 400 });
  }

  if (!findFinanceLedgerEntryById(id)) {
    return NextResponse.json({ success: false, message: "This entry no longer exists." }, { status: 404 });
  }

  deleteFinanceLedgerEntry(id);
  return NextResponse.json({ success: true, message: "Entry deleted." }, { status: 200 });
}
