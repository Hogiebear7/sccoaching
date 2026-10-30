import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { aiAllowanceConfigured } from "@/lib/ai-allowance";
import { getConfiguredSessionSecret } from "@/lib/app-config";
import { appStoreAcceptsSandbox, appStoreIapDisabledReason, appStoreIapEnvironment } from "@/lib/iap/apple-config";
import { iapDisabledReason } from "@/lib/iap/config";
import { configuredRootCertificatesPem, isAppStoreConfigured } from "@/lib/providers/app-store";
import { isGooglePlayConfigured } from "@/lib/providers/google-play";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET /api/staff/store-status: which store purchase settings this deployment can see, as yes/no and short codes. Platform operator only
// (finance.view). It never returns a value: no key, id or secret leaves the server, only whether each one is present and usable. For checking
// a purchase that is refused with "Subscriptions aren't available right now" without reading the hosting panel.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "finance.view");
  if (!auth.ok) return auth.response;

  const set = (name: string) => !!process.env[name]?.trim();
  return NextResponse.json(
    {
      success: true,
      data: {
        appStore: {
          purchasesOn: appStoreIapDisabledReason() === null,
          refusedBecause: appStoreIapDisabledReason(),
          environment: appStoreIapEnvironment(),
          acceptsSandbox: appStoreAcceptsSandbox(),
          configured: isAppStoreConfigured(),
          settings: {
            APP_STORE_BUNDLE_ID: set("APP_STORE_BUNDLE_ID"),
            APP_STORE_ISSUER_ID: set("APP_STORE_ISSUER_ID"),
            APP_STORE_KEY_ID: set("APP_STORE_KEY_ID"),
            APP_STORE_PRIVATE_KEY_BASE64: set("APP_STORE_PRIVATE_KEY_BASE64"),
            APP_STORE_ROOT_CERTIFICATES_BASE64: set("APP_STORE_ROOT_CERTIFICATES_BASE64"),
            rootCertificatesReadable: configuredRootCertificatesPem() !== null,
          },
        },
        googlePlay: { purchasesOn: iapDisabledReason() === null, refusedBecause: iapDisabledReason(), configured: isGooglePlayConfigured() },
        aiAllowancesSet: aiAllowanceConfigured(),
        accountBindingSecretSet: !!getConfiguredSessionSecret(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
