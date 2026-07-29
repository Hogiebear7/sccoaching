import {
  findClassCategories,
  findMembershipBillingOptions,
  findMembershipCategories,
  findMembershipPackages,
} from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { CatalogView } from "./CatalogView";

export const dynamic = "force-dynamic";

export default async function StaffCatalogPage() {
  await requireStaffPage("catalog.manage");
  return (
    <CatalogView
      categories={findMembershipCategories()}
      packages={findMembershipPackages()}
      billingOptions={findMembershipBillingOptions()}
      classCategories={findClassCategories()}
    />
  );
}
