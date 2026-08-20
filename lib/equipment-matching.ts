import { EQUIPMENT_CATALOG, findEquipmentBySlug } from "@/lib/equipment-catalog";

// V1 matching against the exercise library's existing single free-text
// `equipment` column (see lib/exercise-library/types.ts) — one exercise has
// exactly one equipment value from vendor data, not an array and not a
// required/optional/alternative model. Richer multi-equipment-per-exercise
// modeling would mean reworking the import pipeline itself; deliberately
// out of scope here (see lib/exercise-library/import.ts, which is untouched
// by this feature).

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// True when a catalog item's label or aliases match the exercise library's
// raw vendor equipment string (case-insensitive, exact match — the vendor
// strings are short single terms like "barbell" or "body weight", not
// prose, so exact match is the right comparison here).
export function equipmentSlugMatchesVendorString(slug: string, vendorEquipment: string): boolean {
  const def = findEquipmentBySlug(slug);
  if (!def) return false;
  const target = normalize(vendorEquipment);
  return normalize(def.label) === target || def.aliases.some((a) => normalize(a) === target);
}

// Whether an exercise (identified by its raw equipment string, possibly
// null/empty for bodyweight) is usable given a set of selected catalog
// slugs. No equipment listed = always includable, matching the existing
// convention in the mobile workout generator's matchesEquipment().
export function exerciseMatchesEquipmentSlugs(vendorEquipment: string | null, equipmentSlugs: string[]): boolean {
  if (!vendorEquipment || !vendorEquipment.trim()) return true;
  if (equipmentSlugs.length === 0) return true;
  return equipmentSlugs.some((slug) => equipmentSlugMatchesVendorString(slug, vendorEquipment));
}

// Free-text search across an equipment item's label + aliases, for the
// picker's search bar.
export function equipmentMatchesQuery(slug: string, query: string): boolean {
  const def = findEquipmentBySlug(slug);
  if (!def) return false;
  const q = normalize(query);
  if (!q) return true;
  return normalize(def.label).includes(q) || def.aliases.some((a) => normalize(a).includes(q));
}

// Distinct raw vendor equipment strings (from the live exercise library)
// that a given catalog slug currently resolves to — useful for diagnostics
// / admin visibility into how well the catalog covers the real data, not
// required for the matching logic itself.
export function vendorStringsForSlug(slug: string, allVendorEquipment: (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const v of allVendorEquipment) {
    if (v && equipmentSlugMatchesVendorString(slug, v)) seen.add(v);
  }
  return [...seen];
}

export { EQUIPMENT_CATALOG };
