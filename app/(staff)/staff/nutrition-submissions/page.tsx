import { findAllFoodSubmissions, findFoodById, findProfileByUserId, findUserById } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { NutritionSubmissionsView } from "./NutritionSubmissionsView";

export default async function StaffNutritionSubmissionsPage() {
  await requireStaffPage("foodCatalog.manage");

  const submissions = findAllFoodSubmissions().map((s) => {
    const food = findFoodById("custom", s.customFoodId);
    const user = findUserById(s.userId);
    const profile = findProfileByUserId(s.userId);
    return {
      ...s,
      food: food
        ? {
            id: food.id,
            name: food.name,
            brandName: food.brandName,
            barcode: food.barcode,
            nutrition100g: food.nutrition100g,
            defaultServing: food.defaultServing,
          }
        : null,
      submitterEmail: user?.email ?? "Unknown member",
      submitterName: profile?.fullName ?? null,
    };
  });

  return <NutritionSubmissionsView submissions={submissions} />;
}
