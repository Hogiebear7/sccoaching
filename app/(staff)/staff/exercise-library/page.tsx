import { requireStaffPage } from "@/lib/staff-auth";
import { ExerciseLibraryAdminView } from "./ExerciseLibraryAdminView";

export default async function StaffExerciseLibraryPage() {
  await requireStaffPage("exercises.manage");
  return <ExerciseLibraryAdminView />;
}
