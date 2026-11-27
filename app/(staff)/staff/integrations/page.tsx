import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { MAX_API_KEYS_PER_GYM, publicApiKey } from "@/lib/gym-api-keys";
import { MAX_WEBHOOKS_PER_GYM, WEBHOOK_EVENTS } from "@/lib/gym-webhooks";
import { publicWebhook } from "@/lib/gym-webhooks-admin";
import { getSiteUrl } from "@/lib/site-url";
import { requireStaffPage } from "@/lib/staff-auth";

import { ApiKeysPanel } from "./ApiKeysPanel";
import { IntegrationsPanel } from "./IntegrationsPanel";

// Connect the gym to other tools (Zapier, Make, n8n ...) by sending them a message when something happens. See lib/gym-webhooks.ts.
export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const staff = await requireStaffPage("gym.manageBranding");
  const gym = gymRecordForUser(staff);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="text-display text-[28px] leading-tight">Integrations</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Connect your gym to Zapier or similar tools. For example, add each new member to your mailing list, or log every booking in a spreadsheet, automatically.
        </p>
      </div>
      <h3 className="pt-2 text-base font-semibold text-zinc-50">Send a message to another tool when something happens</h3>
      <IntegrationsPanel
        initial={(gym?.webhooks ?? []).map(publicWebhook)}
        events={WEBHOOK_EVENTS.map((e) => ({ type: e.type, label: e.label, detail: e.detail }))}
        max={MAX_WEBHOOKS_PER_GYM}
      />
      <h3 className="pt-4 text-base font-semibold text-zinc-50">Let other tools do things for your gym</h3>
      <ApiKeysPanel initial={(gym?.apiKeys ?? []).filter((k) => !k.revokedAt).map(publicApiKey)} max={MAX_API_KEYS_PER_GYM} siteUrl={getSiteUrl()} />
    </div>
  );
}
