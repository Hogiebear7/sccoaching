import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — safe to import from "use client" components.
// No auth is configured yet: every request goes out as the anon role, so
// table access is controlled entirely by Postgres Row Level Security
// policies (see docs/supabase.md once that's written).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
