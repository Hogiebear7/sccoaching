import { findExercises } from "@/lib/db";
import { ExercisesView } from "./ExercisesView";

export default async function StaffExercisesPage() {
  const exercises = findExercises();
  return <ExercisesView exercises={exercises} />;
}
