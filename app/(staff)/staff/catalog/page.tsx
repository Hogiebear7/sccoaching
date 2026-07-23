import {
  findClassCategories,
  findMembershipBillingOptions,
  findMembershipCategories,
  findMembershipPackages,
} from "@/lib/db";
import { CatalogView } from "./CatalogView";

export const dynamic = "force-dynamic";

export default async function StaffCatalogPage() {
  return (
    <CatalogView
      categories={findMembershipCategories()}
      packages={findMembershipPackages()}
      billingOptions={findMembershipBillingOptions()}
      classCategories={findClassCategories()}
    />
  );
}
