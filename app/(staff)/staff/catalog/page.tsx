import {
  findClassCategories,
  findMembershipBillingOptions,
  findMembershipCategories,
  findMembershipPackages,
} from "@/lib/db";
import { sameGym, staffAuthorizedForCatalogPackage } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import { CatalogView } from "./CatalogView";

export const dynamic = "force-dynamic";

export default async function StaffCatalogPage() {
  const me = await requireStaffPage("catalog.manage");

  const allCategories = findMembershipCategories();

  // Packages are filtered first — same-gym (via their category) or the
  // global app-only exception. A package whose category can't be resolved
  // fails closed (excluded), matching the routes' behavior.
  const visiblePackages = findMembershipPackages().filter((p) =>
    staffAuthorizedForCatalogPackage(me, p, allCategories.find((c) => c.id === p.categoryId))
  );
  const visiblePackageIds = new Set(visiblePackages.map((p) => p.id));
  const visibleBillingOptions = findMembershipBillingOptions().filter((o) => visiblePackageIds.has(o.packageId));

  // Categories shown = the staff member's own gym, PLUS any category that
  // owns a surviving (already-authorized) package — this is how an
  // app-only package's category renders even when it belongs to a
  // different gym, without ever reintroducing that category's ordinary
  // (non-app-only) packages: those were already excluded from
  // visiblePackages above, so CatalogView's own
  // `packages.filter(p => p.categoryId === cat.id)` nesting can't surface
  // them even though the category itself is now included. Deliberately not
  // keyed on array order or gymId === null — see the approved decision
  // record.
  const visibleCategoryIds = new Set([
    ...allCategories.filter((c) => sameGym(me, c)).map((c) => c.id),
    ...visiblePackages.map((p) => p.categoryId),
  ]);
  const visibleCategories = allCategories.filter((c) => visibleCategoryIds.has(c.id));

  return (
    <CatalogView
      categories={visibleCategories}
      packages={visiblePackages}
      billingOptions={visibleBillingOptions}
      classCategories={findClassCategories()}
    />
  );
}
