// Some hosts cap the number of environment variables on their free tier
// (observed: exactly 2-3 on Hostinger's free plan, and specifically any
// value containing JSON syntax like `{`, `}`, or `"` silently fails to save
// even within that count — Import .env and the Add-variable form both
// exhibit this). NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// can't be renamed — Next.js only inlines vars with that exact prefix into
// the client bundle — so that leaves limited room for everything else.
// APP_CONFIG packs the rest into that one slot using a quote/brace-free
// format instead of JSON: `key=value|key=value`.
//
// Standalone SESSION_SECRET / DATA_DIR vars (used locally, and on any host
// without this limit) still take priority when present, so nothing changes
// for local dev.

interface AppConfig {
  sessionSecret?: string;
  dataDir?: string;
}

let cached: AppConfig | null = null;

function loadAppConfig(): AppConfig {
  if (cached) return cached;

  const raw = process.env.APP_CONFIG?.trim();
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
