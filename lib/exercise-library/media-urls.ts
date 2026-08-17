import type { SupabaseClient } from "@supabase/supabase-js";

import { EXERCISE_MEDIA_BUCKET } from "./admin-client";

// exercise-media is a private bucket (see migration
// 20260817200000_exercise_media_private_bucket.sql — the EULA governing
// this data prohibits exposing it through any endpoint that allows bulk/
// automated retrieval, which a stable public CDN URL is). Every read path
// generates a short-lived signed URL server-side instead; the client never
// sees a durable link to the raw file. Called with the service-role client,
// which bypasses RLS entirely, so this works regardless of storage policy.
const SIGNED_URL_TTL_SECONDS = 3600;

export async function signMediaUrl(client: SupabaseClient, storagePath: string): Promise<string | null> {
  const { data, error } = await client.storage
    .from(EXERCISE_MEDIA_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("[exercise-library] failed to sign media URL:", error);
    return null;
  }
  return data.signedUrl;
}

// Batch variant for list/thumbnail views — one round trip for N paths
// instead of N, via Supabase's own bulk-sign endpoint.
export async function signMediaUrls(client: SupabaseClient, storagePaths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(storagePaths)];
  if (unique.length === 0) return new Map();

  const { data, error } = await client.storage
    .from(EXERCISE_MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("[exercise-library] failed to batch-sign media URLs:", error);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const entry of data) {
    if (entry.signedUrl && !entry.error) map.set(entry.path ?? "", entry.signedUrl);
  }
  return map;
}
