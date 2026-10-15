// Kill switch, environment label and sandbox policy for App Store purchases. Independent of the Google Play switch
// (lib/iap/config.ts): each store can be turned on, off or restricted on its own.
//
// Defaults are OFF. Nothing in this repository turns purchases on: enabling them is an explicit operator action that sets
// the variables below on a specific deployment. Values are read at call time so a deployment-level change takes effect
// without a rebuild, and tests can set them per case.
//
//   APP_STORE_IAP_ENABLED      must be exactly "true". Anything else, including unset, is off.
//   APP_STORE_IAP_ENVIRONMENT  must be exactly "test", "staging" or "production". Labels the deployment for audit rows.
//   APP_STORE_ACCEPT_SANDBOX   must be exactly "true" for a SANDBOX transaction to be accepted. Off by default.
//
// Sandbox policy. Apple reviews an app with sandbox purchases against whatever server the build points at, so a deployment
// that is to be reviewed must accept sandbox transactions; one that must not be reachable by test purchases must not. The
// setting is explicit and per deployment rather than inferred, and a sandbox entitlement is stored with environment
// "sandbox" so it is always distinguishable from a real paid one (and is never counted as revenue). The Xcode and
// LocalTesting environments are never accepted: they are signed locally, not by Apple's servers.
//
// What the kill switch gates: NEW claims and the purchase context. It does NOT gate lifecycle processing of purchases already
// claimed (notifications, reconciliation): a kill switch must never stop access being withdrawn after a refund or expiry.

import type { IapEnvironment } from "./config";

const ENVIRONMENTS: readonly IapEnvironment[] = ["test", "staging", "production"];

export function appStoreIapEnvironment(): IapEnvironment | null {
  const value = process.env.APP_STORE_IAP_ENVIRONMENT?.trim();
  return ENVIRONMENTS.find((e) => e === value) ?? null;
}

export type AppStoreIapDisabledReason = "kill_switch_off" | "environment_unset";

export function appStoreIapDisabledReason(): AppStoreIapDisabledReason | null {
  if (process.env.APP_STORE_IAP_ENABLED?.trim() !== "true") return "kill_switch_off";
  if (!appStoreIapEnvironment()) return "environment_unset";
  return null;
}

export function isAppStoreIapEnabled(): boolean {
  return appStoreIapDisabledReason() === null;
}

export function appStoreAcceptsSandbox(): boolean {
  return process.env.APP_STORE_ACCEPT_SANDBOX?.trim() === "true";
}

// Maps Apple's environment string to one this deployment accepts, or null.
export function acceptedAppStoreEnvironment(environment: unknown): "production" | "sandbox" | null {
  if (environment === "Production") return "production";
  if (environment === "Sandbox") return appStoreAcceptsSandbox() ? "sandbox" : null;
  return null;
}
