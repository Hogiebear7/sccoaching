import {
  findClassCategories,
  findMembershipBillingOptions,
  findMembershipCategories,
  findMembershipPackages,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import { CatalogView } from "./CatalogView";

export const dynamic = "force-dynamic";

export default async function StaffCatalogPage() {
  const me = await requireStaffPage("catalog.manage");
  // Packages and billing options are passed through unfiltered — they carry
  // no gymId of their own (see MembershipCategoryRecord's comment in
  // lib/db.ts). CatalogView only ever renders a package/option by looking it
  // up under a rendered category (packages.filter(p => p.categoryId ===
  // cat.id), never as an independent list), so filtering categories alone
  // already keeps every cross-gym package/option out of the rendered page.
  // Their own dedicated CRUD/listing isolation is a separate, deferred slice.
  return (
    <CatalogView
      categories={findMembershipCategories().filter((c) => sameGym(me, c))}
      packages={findMembershipPackages()}
      billingOptions={findMembershipBillingOptions()}
      classCategories={findClassCategories()}
    />
  );
}
