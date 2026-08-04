// Some hosts cap the number of environment variables on their free tier
// (observed: exactly 3 on Hostinger's free plan). NEXT_PUBLIC_SUPABASE_URL
// and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY can't be renamed — Next.js only
// inlines vars with that exact prefix into the client bundle — so that
// leaves one slot for everything else. APP_CONFIG packs the rest as JSON
// into that single slot: `{"sessionSecret":"...","dataDir":"..."}`.
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

  try {
    cached = JSON.parse(raw) as AppConfig;
  } catch {
    cached = {};
  }

  return cached;
}

export function getConfiguredSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET?.trim() || loadAppConfig().sessionSecret;
}

export function getConfiguredDataDir(): string | undefined {
  return process.env.DATA_DIR?.trim() || loadAppConfig().dataDir;
}
