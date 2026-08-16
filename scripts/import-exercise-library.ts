// Runs the exercise library importer (lib/exercise-library/import.ts) —
// the same module the staff admin "Import" button in the app calls, so a
// CLI run and an in-app run can never drift apart. Dry run by default,
// matching this repo's other seed scripts (see scripts/seed-exercise-library.mjs) —
// pass --confirm for a real write.
//
//   npm run import:exercises -- --dir import-data/sample-pack
//   npm run import:exercises -- --dir import-data/sample-pack --confirm
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
// environment (loaded from .env.local below — plain Node doesn't read
// Next.js's env files automatically).

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { runExerciseImport } from "../lib/exercise-library/import";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dirFlagIdx = args.indexOf("--dir");
  const dir = dirFlagIdx >= 0 ? args[dirFlagIdx + 1] : "import-data/sample-pack";
  const confirm = args.includes("--confirm");
  const source = args.includes("--source") ? args[args.indexOf("--source") + 1] : "sample-pack";
  return { dir: resolve(process.cwd(), dir), confirm, source };
}

async function main() {
  loadEnvLocal();
  const { dir, confirm, source } = parseArgs();

  if (!existsSync(dir)) {
    console.error(`✗ Directory not found: ${dir}`);
    process.exit(1);
  }

  console.log(`${confirm ? "Importing" : "Dry run —"} from ${dir} (source: "${source}")${confirm ? "" : ", nothing will be written. Pass --confirm to write for real."}\n`);

  const result = await runExerciseImport({
    dir,
    source,
    mode: confirm ? "import" : "dry_run",
    triggeredBy: "cli",
  });

  console.log(`Scanned ${result.totalRows} exercise file(s).`);
  if (result.catalogCoverage) {
    console.log(
      `Catalog index (exerciseList.json): ${result.catalogCoverage.totalNamesInList} name(s) listed, ${result.catalogCoverage.matchedDetailFiles} have a full detail file in this pack.`
    );
  }
  console.log(`  Created:  ${result.importedCount}`);
  console.log(`  Updated:  ${result.updatedCount}`);
  console.log(`  Failed:   ${result.failedCount}`);
  console.log(`  Media mapped:  ${result.mediaMappedCount} exercise(s)`);
  console.log(`  Media missing: ${result.mediaMissingCount} exercise(s)`);
  console.log("");

  for (const row of result.details) {
    const marker = row.outcome === "failed" ? "✗" : row.outcome === "created" ? "+" : "~";
    console.log(
      `  ${marker} [${row.sourceId}] ${row.name} — ${row.outcome}${row.message ? `: ${row.message}` : ""} (media: ${row.mediaUploaded}/${row.mediaFound})`
    );
  }

  if (!confirm) {
    console.log("\nDry run only — re-run with --confirm to write to Supabase.");
  }

  process.exit(result.failedCount > 0 && result.importedCount === 0 && result.updatedCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Import script crashed:", err);
  process.exit(1);
});
