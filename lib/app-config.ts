// Hostinger's env var UI silently failed to persist a variable literally
// named APP_CONFIG (added fine, vanished on Apply — reproduced via both the
// Add-variable form and Import .env), most likely colliding with something
// reserved on their platform. Renaming to SANDC_APP_CONFIG fixed it. Packs
// everything into one slot using a quote/brace-free format (not JSON, in
// case that was ever a factor too): `key=value|key=value`.
//
// Standalone SESSION_SECRET / DATA_DIR vars (used locally, and on any host
// without this naming collision) still take priority when present, so
// nothing changes for local dev.

interface AppConfig {
  sessionSecret?: string;
  dataDir?: string;
  appUrl?: string;
}

let cached: AppConfig | null = null;

function loadAppConfig(): AppConfig {
  if (cached) return cached;

  const raw = process.env.SANDC_APP_CONFIG?.trim();
  if (!raw) {
    cached = {};
    return cached;
  }

  const config: AppConfig = {};
  for (const pair of raw.split("|")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key === "sessionSecret") config.sessionSecret = value;
    if (key === "dataDir") config.dataDir = value;
    if (key === "appUrl") config.appUrl = value;
  }

  cached = config;
  return cached;
}

export function getConfiguredSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET?.trim() || loadAppConfig().sessionSecret;
}

export function getConfiguredDataDir(): string | undefined {
  return process.env.DATA_DIR?.trim() || loadAppConfig().dataDir;
}

export function getConfiguredAppUrl(): string | undefined {
  return process.env.APP_URL?.trim() || loadAppConfig().appUrl;
}
