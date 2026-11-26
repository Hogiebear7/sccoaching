// A cap on how much AI a whole tenant gym can use (owner request 2026-11-25: a very large gym must never cost S&C money on AI).
//
// The shared pools in lib/ai-allowance.ts stop total spending, but they are shared by everyone, so one huge gym could use up what everyone else (S&C's own members
// included) was meant to have. This gives each tenant gym its own ceiling over any rolling 30 days, set by the size band it pays for (lib/tenant-pricing.ts), so a bigger
// gym gets a bigger share and the price it pays is meant to cover it.
//
// The numbers are the owner's, in euros, in the environment, one per band:
//   AI_TENANT_GYM_CAPS_EUR = {"b50":20,"b100":40,"b150":60,"b300":120,"b500":200,"b501":300}
// Unset (or not all six bands given as plain numbers): no per-gym cap, exactly as before. S&C's own gym (gymId null) is never capped by this. A tenant gym that has no band
// yet (not billed, or size-based pricing not switched on) is held to the SMALLEST band's cap, so an unpaid gym can never be the expensive one.
import { aiUsdPerEur } from "./ai-allowance";
import { findGymById, findUserById } from "./db";
import { TENANT_BANDS, type TenantBand } from "./tenant-pricing";

export type GymAiCaps = Record<TenantBand, number>;

export function parseGymAiCaps(raw: string | undefined | null): GymAiCaps | null {
  if (!raw || !raw.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const out: Partial<GymAiCaps> = {};
  for (const { key } of TENANT_BANDS) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    out[key] = n;
  }
  return out as GymAiCaps;
}

/** The gym ceiling that applies to a call made by this user, in USD (converted once, at the same cautious rate as the other AI budgets), or null when none applies. */
export function tenantGymAiCap(userId: string | null | undefined): { gymId: string; usd: number } | null {
  if (!userId) return null;
  const caps = parseGymAiCaps(process.env.AI_TENANT_GYM_CAPS_EUR);
  if (!caps) return null;
  const user = findUserById(userId);
  if (!user?.gymId) return null; // S&C's own gym, and platform accounts, are not capped here
  const band = findGymById(user.gymId)?.platformBilling?.band ?? TENANT_BANDS[0].key;
  return { gymId: user.gymId, usd: caps[band] * aiUsdPerEur() };
}
