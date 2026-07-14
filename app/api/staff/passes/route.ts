import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassPassProductById,
  findUserById,
  saveClassPassProduct,
  type ClassPassProductRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

// Create / edit a pass-pack product. Mirrors the plans route shape. Note:
// editing passCount, price or validity affects FUTURE purchases only —
// entitlements are stamped onto the ledger at credit time.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage pass packs." },
      { status: 401 }
    );
  }

  if (user.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage pass packs." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id, name, description, passCount, priceEur, validityDays, isActive } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { success: false, message: "Pack name is required." },
      { status: 400 }
    );
  }

  const passCountValue = Number(passCount);
  if (
    typeof passCount !== "string" ||
    !passCount.trim() ||
    !Number.isInteger(passCountValue) ||
    passCountValue <= 0 ||
    passCountValue > 100
  ) {
    return NextResponse.json(
      { success: false, message: "Passes per pack must be a whole number between 1 and 100." },
      { status: 400 }
    );
  }

  if (
    typeof priceEur !== "string" ||
    !priceEur.trim() ||
    Number.isNaN(Number(priceEur)) ||
    Number(priceEur) <= 0
  ) {
    return NextResponse.json(
      { success: false, message: "A valid price greater than zero is required." },
      { status: 400 }
    );
  }

  // Validity: empty string / null = never expires; otherwise whole days.
  let validityValue: number | null = null;
  if (validityDays !== undefined && validityDays !== null && validityDays !== "") {
    const parsed = Number(validityDays);
    if (typeof validityDays !== "string" || !Number.isInteger(parsed) || parsed <= 0 || parsed > 1825) {
      return NextResponse.json(
        {
          success: false,
          message: "Use-by must be a whole number of days between 1 and 1825, or blank for no expiry.",
        },
        { status: 400 }
      );
    }
    validityValue = parsed;
  }

  const existing = typeof id === "string" && id.trim() ? findClassPassProductById(id) : undefined;

  if (typeof id === "string" && id.trim() && !existing) {
    return NextResponse.json(
      { success: false, message: "This pass pack no longer exists." },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();

  const product: ClassPassProductRecord = {
    id: existing?.id ?? randomUUID(),
    name: name.trim(),
    description:
      typeof description === "string" && description.trim() ? description.trim() : null,
    passCount: passCountValue,
    priceCents: Math.round(Number(priceEur) * 100),
    validityDays: validityValue,
    isActive: typeof isActive === "boolean" ? isActive : true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveClassPassProduct(product);

  return NextResponse.json(
    { success: true, message: existing ? "Pass pack updated." : "Pass pack created." },
    { status: 200 }
  );
}
