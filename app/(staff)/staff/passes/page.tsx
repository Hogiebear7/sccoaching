import { countPurchasesByProductId, findClassPassProducts } from "@/lib/db";
import { PassesView } from "./PassesView";

export default async function StaffPassesPage() {
  const products = findClassPassProducts();
  // Any purchase reference (whatever its status) blocks hard delete.
  const purchaseCounts = Object.fromEntries(
    products.map((product) => [product.id, countPurchasesByProductId(product.id)])
  );

  return <PassesView products={products} purchaseCounts={purchaseCounts} />;
}
