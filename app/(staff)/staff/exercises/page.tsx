import { findExercises } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { ExercisesView } from "./ExercisesView";

export default async function StaffExercisesPage() {
  await requireStaffPage("exercises.manage");
  const exercises = findExercises();
  return <ExercisesView exercises={exercises} />;
}
