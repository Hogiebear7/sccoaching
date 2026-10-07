// Kill switch and environment label for Google Play purchases.
//
// Defaults are OFF. Nothing in this repository turns purchases on: enabling them is an explicit
// operator action that sets BOTH variables below on a specific deployment. Values are read at call
// time (not import time) so a deployment-level change takes effect without a rebuild, and tests can
// set them per case.
//
//   GOOGLE_PLAY_IAP_ENABLED      must be exactly "true". Anything else, including unset, is off.
//   GOOGLE_PLAY_IAP_ENVIRONMENT  must be exactly "test", "staging" or "production". It labels the
//                                deployment so an audit row and a runbook can say which one a
//                                purchase was verified against. Unset or any other value is off.
//
// What the switch gates (owner default D7, plan interpretation I6): NEW claims (the verify route)
// and the purchase context (the account binding handed to the client). It does NOT gate lifecycle
// processing for purchases already claimed: notifications, reconciliation and acknowledgement retry
// keep running with the switch off, because a kill switch must never stop access being withdrawn
// after a refund, expiry or revocation.
//
// Provider credentials (GOOGLE_PLAY_PACKAGE_NAME, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
// GOOGLE_PLAY_RTDN_TOKEN) are separate and are checked separately. This module never reads them.

export type IapEnvironment = "test" | "staging" | "production";

const ENVIRONMENTS: readonly IapEnvironment[] = ["test", "staging", "production"];

export function iapEnvironment(): IapEnvironment | null {
  const value = process.env.GOOGLE_PLAY_IAP_ENVIRONMENT?.trim();
  return ENVIRONMENTS.find((e) => e === value) ?? null;
}

export type IapDisabledReason = "kill_switch_off" | "environment_unset";

// null means purchases are enabled.
export function iapDisabledReason(): IapDisabledReason | null {
  if (process.env.GOOGLE_PLAY_IAP_ENABLED?.trim() !== "true") return "kill_switch_off";
  if (!iapEnvironment()) return "environment_unset";
  return null;
}

export function isGooglePlayIapEnabled(): boolean {
  return iapDisabledReason() === null;
}
