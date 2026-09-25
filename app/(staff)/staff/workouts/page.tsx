import { findClassCategories, findExercises } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { findClassWorkoutTemplatesForStaff } from "@/lib/workout-template-scope";
import { WorkoutsView } from "./WorkoutsView";

export default async function StaffWorkoutsPage() {
  const staff = await requireStaffPage("classes.manage");
  // Only this staff member's own gym's templates — never another gym's.
  const templates = findClassWorkoutTemplatesForStaff(staff);
  const categories = findClassCategories();
  const exercises = findExercises();
  return <WorkoutsView templates={templates} categories={categories} exercises={exercises} />;
}
