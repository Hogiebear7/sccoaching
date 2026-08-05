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
  anthropicApiKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  resendApiKey?: string;
  emailFrom?: string;
  contactNotifyEmail?: string;
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
    if (key === "anthropicApiKey") config.anthropicApiKey = value;
    if (key === "stripeSecretKey") config.stripeSecretKey = value;
    if (key === "stripeWebhookSecret") config.stripeWebhookSecret = value;
    if (key === "resendApiKey") config.resendApiKey = value;
    if (key === "emailFrom") config.emailFrom = value;
    if (key === "contactNotifyEmail") config.contactNotifyEmail = value;
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

export function getConfiguredAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || loadAppConfig().anthropicApiKey;
}

export function getConfiguredStripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || loadAppConfig().stripeSecretKey;
}

export function getConfiguredStripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || loadAppConfig().stripeWebhookSecret;
}

export function getConfiguredResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || loadAppConfig().resendApiKey;
}

export function getConfiguredEmailFrom(): string | undefined {
  return process.env.EMAIL_FROM?.trim() || loadAppConfig().emailFrom;
}

export function getConfiguredContactNotifyEmail(): string | undefined {
  return process.env.CONTACT_NOTIFY_EMAIL?.trim() || loadAppConfig().contactNotifyEmail;
}
