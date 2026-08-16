# Exercise library import staging

Gitignored on purpose — this holds source packs (JSON + GIF media) too large
and too binary-heavy to check into git, whether the current sample pack or
the eventual full dataset purchase.

## Expected directory shape

A pack directory (e.g. `sample-pack/`, or a future `full-pack/`) contains:

- `exerciseList.json` — optional flat array of exercise name strings. Only
  used by the importer to report catalog coverage (how many of these names
  have a matching detail file); it isn't itself imported as data.
- `<sourceId>.json` — one file per exercise with the full record: `id`,
  `name`, `bodyPart`, `equipment`, `target`, `secondaryMuscles`,
  `instructions`, `description`, `difficulty`, `category`, `taxonomy`,
  `similarExercises`, `substitutions`, `progressions`, `regressions`.
- `<sourceId>-<resolution>.gif` — zero or more media files per exercise,
  one per resolution (`180`, `360`, `720`, `1080` in the sample pack).
  Any file matching `<sourceId>-*.gif` in the same directory is picked up;
  the resolution label is whatever follows the dash.

The importer (`lib/exercise-library/import.ts`, run via
`scripts/import-exercise-library.mjs`) walks the directory for `*.json`
files other than `exerciseList.json`, treating each as one exercise, and
looks for sibling GIFs by filename convention. A future full-dataset import
that follows this same shape works with zero code changes — point the
script at the new directory.

## Running an import

```bash
node scripts/import-exercise-library.mjs --dir import-data/sample-pack --dry-run
node scripts/import-exercise-library.mjs --dir import-data/sample-pack
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
environment (service role — not the publishable key; this bypasses RLS by
design, since import writes are a trusted server-side operation). The same
underlying module is also exposed to staff in-app at
`/staff/exercise-library`.
