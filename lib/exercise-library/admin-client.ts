import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for the exercise library's own server-side
// operations (import pipeline, staff admin routes, member-facing reads/
// writes). Deliberately separate from lib/supabase/server.ts's anon-key
// client — every table this feature touches has RLS default-deny for the
// anon role (see supabase/migrations/20260817000000_exercise_library.sql),
// since the anon/publishable key is public (shipped in client JS) and
// authorization for this feature is enforced in the Next.js route, not at
// the DB layer. Only this service-role client — imported exclusively from
// server-side route handlers and scripts — can actually reach these
// tables. Never import this from a "use client" component.
let cached: SupabaseClient | null = null;

export function getExerciseLibraryClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Exercise library needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured in the environment."
    );
  }

  cached = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const EXERCISE_MEDIA_BUCKET = "exercise-media";
