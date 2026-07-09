import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isBillingProviderConfigured } from "@/lib/billing";
import {
  findPurchaseByIdempotencyKey,
  findUserById,
  savePurchase,
} from "@/lib/db";
import {
  buildPassPackPurchase,
  findActivePassProduct,
  isPurchaseCheckoutReusable,
} from "@/lib/payments";
import { createRevolutOrder } from "@/lib/providers/revolut";
import { verifySession } from "@/lib/session";

// Starts a one-off checkout for a class pass pack.
//
// Safety properties:
//  - Auth required; the purchase is bound to the signed-in member only.
//  - Duplicate submits: the client sends an idempotency key (falling back
//    to user+product), and an existing fresh pending purchase for that key
//    is returned as-is — no second provider order is created.
//  - Nothing is credited here. The purchase stays "pending" until the
//    signed webhook confirms payment (see /api/billing/webhook).
export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to buy passes." },
      { status: 401 }
    );
  }

  const user = findUserById(sessionUserId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to buy passes." },
      { status: 401 }
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

  const { productId, idempotencyKey } = (body ?? {}) as Record<string, unknown>;

  if (typeof productId !== "string" || !productId.trim()) {
    return NextResponse.json(
      { success: false, message: "A pass product is required." },
      { status: 400 }
    );
  }

  const product = findActivePassProduct(productId.trim());

  if (!product) {
    return NextResponse.json(
      { success: false, message: "This pass pack is not available." },
      { status: 404 }
    );
  }

  if (!isBillingProviderConfigured()) {
    // Never fake a grant: without a provider there is no online purchase.
    // Staff can add passes manually in the member editor.
    return NextResponse.json(
      {
        success: false,
        message:
          "Online payment isn't set up yet. Ask staff about buying passes at the club.",
      },
      { status: 503 }
    );
  }

  // Scope the key to the member so one member's key can never collide with
  // another's; a missing key degrades to one-open-checkout-per-product.
  const cleanKey =
    typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? `${user.id}:${idempotencyKey.trim().slice(0, 80)}`
      : `${user.id}:${product.id}`;

  const existing = findPurchaseByIdempotencyKey(cleanKey);
  if (existing && existing.userId === user.id && isPurchaseCheckoutReusable(existing)) {
    return NextResponse.json(
      {
        success: true,
        purchaseId: existing.id,
        checkoutUrl: existing.checkoutUrl,
        reused: true,
        message: "Resuming your existing checkout.",
      },
      { status: 200 }
    );
  }

  // Stale/terminal purchase under this key: retire the key so history keeps
  // the old row and the new attempt gets a fresh identity.
  const purchase = buildPassPackPurchase({
    userId: user.id,
    product,
    idempotencyKey: existing ? `${cleanKey}:${Date.now()}` : cleanKey,
  });
  savePurchase(purchase);

  // merchant_order_ext_ref = our purchase id — the reconciliation thread
  // between provider dashboard rows and our internal ledger.
  const order = await createRevolutOrder({
    amountCents: product.priceCents,
    internalReference: purchase.id,
    customerEmail: user.email,
  });

  if (!order.ok) {
    savePurchase({ ...purchase, status: "failed", updatedAt: new Date().toISOString() });
    console.warn("[passes checkout] provider order creation failed", {
      purchaseId: purchase.id,
      message: order.message,
    });
    return NextResponse.json(
      { success: false, message: "Could not start checkout. Please try again." },
      { status: 502 }
    );
  }

  savePurchase({
    ...purchase,
    providerOrderId: order.orderId,
    checkoutUrl: order.checkoutUrl,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      success: true,
      purchaseId: purchase.id,
      checkoutUrl: order.checkoutUrl,
      reused: false,
      message: "Redirecting to checkout. Passes are added once payment is confirmed.",
    },
    { status: 200 }
  );
}
