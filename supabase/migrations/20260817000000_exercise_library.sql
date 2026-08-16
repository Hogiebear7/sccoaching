-- Exercise Library — production schema, built and tested against a small
-- sample pack (see import-data/sample-pack/) before the full dataset
-- purchase. Deliberately a separate subsystem from the JSON-DB-backed
-- lib/db.ts ExerciseRecord (which stays untouched — it's a lightweight
-- staff-curated name list feeding workout-log autocomplete, not a media
-- library). This is a reference dataset with rich taxonomy + GIF media, a
-- much better fit for Postgres + Storage than the app's flat JSON store.
--
-- Security model: the anon/publishable key is PUBLIC (shipped in client
-- JS), so RLS on every table here is default-deny for that role — no
-- policies are granted to anon at all. All reads and writes for this
-- feature go through Next.js API routes using SUPABASE_SERVICE_ROLE_KEY
-- (server-only env var, never NEXT_PUBLIC_), which bypasses RLS entirely.
-- That mirrors this app's existing shape everywhere else (client talks to
-- Next.js API routes, never to a datastore directly) instead of the
-- narrower anon-insert-only pattern contact_inquiries uses for its public
-- lead-capture form (a genuinely different, intentionally-open case).
-- The one deliberate exception is the Storage bucket's public READ policy
-- below — the GIFs themselves are meant to be fetched directly by URL from
-- the browser, same trust level as any other public static asset.

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  -- Where this record came from. 'sample-pack' now; a future full-dataset
  -- import would use its own source value so re-imports of different packs
  -- never collide, and 'custom' for anything staff add by hand.
  source text not null default 'custom',
  -- The vendor's original id (e.g. "0025"), when imported. Null for custom
  -- exercises. Combined with source below for idempotent re-import.
  source_id text,
  slug text not null unique,
  name text not null,
  aliases text[] not null default '{}',
  body_part text,
  target_muscle text,
  secondary_muscles text[] not null default '{}',
  equipment text,
  category text,
  difficulty text,
  description text,
  instructions text[] not null default '{}',
  -- The vendor's extended taxonomy blob (movement pattern, mechanic, force
  -- type, similar/substitute/progression/regression exercise refs, etc.) —
  -- kept as-is rather than modeled column-by-column since it's read-only
  -- reference data the app surfaces but doesn't query structurally yet.
  taxonomy jsonb,
  is_custom boolean not null default false,
  -- Staff review gate for imported content — imported rows land unapproved
  -- so a coach can spot-check before members see them; custom exercises
  -- staff add directly are approved immediately.
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running an import for the same source is a no-op/update, never a dupe.
create unique index exercises_source_source_id_key
  on public.exercises (source, source_id)
  where source_id is not null;

create index exercises_aliases_gin_idx on public.exercises using gin (aliases);
create index exercises_body_part_idx on public.exercises (body_part);
create index exercises_equipment_idx on public.exercises (equipment);
create index exercises_category_idx on public.exercises (category);
create index exercises_approved_idx on public.exercises (approved);
create index exercises_name_trgm_idx on public.exercises using gin (to_tsvector('english', name));

alter table public.exercises enable row level security;

create table public.exercise_media (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  kind text not null default 'gif',
  -- '180' | '360' | '720' | '1080' for the sample pack's resolution
  -- ladder — stored as text since a future source might use different
  -- labels (e.g. 'thumb'/'full') rather than numeric heights.
  resolution text,
  storage_path text not null,
  url text not null,
  width int,
  height int,
  bytes int,
  created_at timestamptz not null default now()
);

create unique index exercise_media_exercise_kind_res_key
  on public.exercise_media (exercise_id, kind, resolution);
create index exercise_media_exercise_id_idx on public.exercise_media (exercise_id);

alter table public.exercise_media enable row level security;

create table public.exercise_import_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  source text not null,
  mode text not null check (mode in ('dry_run', 'import')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_rows int not null default 0,
  imported_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  failed_count int not null default 0,
  media_mapped_count int not null default 0,
  media_missing_count int not null default 0,
  -- Array of {row, sourceId, name, outcome, message} — enough detail for
  -- the admin "failed rows / media mismatches" view without a separate
  -- per-row table.
  details jsonb not null default '[]',
  triggered_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index exercise_import_logs_batch_id_idx on public.exercise_import_logs (batch_id);
create index exercise_import_logs_started_at_idx on public.exercise_import_logs (started_at desc);

alter table public.exercise_import_logs enable row level security;

create table public.exercise_favorites (
  id uuid primary key default gen_random_uuid(),
  -- References a member id from the app's own JSON-file user store, not a
  -- Supabase Auth user — no FK possible across the two systems, same as
  -- every other cross-system id in this schema.
  user_id text not null,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

create index exercise_favorites_user_id_idx on public.exercise_favorites (user_id);

alter table public.exercise_favorites enable row level security;

-- Public bucket: exercise demo GIFs are non-sensitive marketing-like
-- content, so serving them directly from Storage's public CDN URL (stable,
-- cacheable) is simpler and cheaper than proxying through a signed-URL
-- Next.js route for no security benefit. Only SELECT is public — uploads
-- go through the service-role key server-side (the import pipeline), never
-- from the browser.
insert into storage.buckets (id, name, public)
values ('exercise-media', 'exercise-media', true)
on conflict (id) do nothing;

create policy "exercise_media_bucket_public_read" on storage.objects
  for select to anon using (bucket_id = 'exercise-media');
