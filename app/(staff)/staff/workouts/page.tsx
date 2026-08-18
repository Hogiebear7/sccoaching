import { findClassCategories, findClassWorkoutTemplates, findExercises } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { WorkoutsView } from "./WorkoutsView";

export default async function StaffWorkoutsPage() {
  await requireStaffPage("classes.manage");
  const templates = findClassWorkoutTemplates();
  const categories = findClassCategories();
  const exercises = findExercises();
  return <WorkoutsView templates={templates} categories={categories} exercises={exercises} />;
}
