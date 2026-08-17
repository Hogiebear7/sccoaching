-- Reverses the public-bucket decision in 20260817000000_exercise_library.sql.
-- That call was made before the app was licensed under a EULA (ExerciseDB,
-- DevWorx Consulting LLC) that explicitly prohibits exposing the licensed
-- "Exercise Visuals" through any endpoint that allows bulk download,
-- scraping, or automated retrieval of the raw files — a fully public,
-- unauthenticated storage bucket is exactly that. Every read path now
-- generates a short-lived signed URL server-side (via the service-role
-- client, which bypasses RLS entirely) instead of relying on a stable
-- public CDN URL, so there is no anon policy needed on this bucket at all.

update storage.buckets set public = false where id = 'exercise-media';

drop policy if exists "exercise_media_bucket_public_read" on storage.objects;
