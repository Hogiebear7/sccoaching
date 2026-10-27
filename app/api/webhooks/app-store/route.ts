import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { processAppStoreNotification } from "@/lib/iap/apple-service";

// App Store Server Notifications V2 endpoint. Apple posts { "signedPayload": "<JWS>" } here for every subscription lifecycle
// event. The payload is verified against Apple's pinned root before anything is read from it; a notification is then only a
// "go and look" signal: lib/iap/apple-service.ts asks Apple for the live state and never trusts the notification type for the
// state itself. The one thing taken from the notification is a revocation date Apple stamped on the transaction.
//
// Idempotent by notificationUUID. Lifecycle processing deliberately ignores the purchases kill switch.
//
// Response codes matter: Apple retries on anything outside 2xx. 401 for a payload that does not verify (never retried
// usefully), 502/503 for a transient failure (worth retrying), 200 for everything this handler considered, including "nothing
// to do". No response body ever contains a transaction id or provider text.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = await processAppStoreNotification((body as { signedPayload?: unknown } | null)?.signedPayload);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
