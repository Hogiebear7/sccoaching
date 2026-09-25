// Tenant scope for class workout templates (ClassWorkoutTemplateRecord).
//
// A template has no gym field of its own. Ownership is derived the same way the
// rest of the codebase derives it for records without one: template ->
// createdByStaffId -> that creator's account -> its gym, compared with the acting
// staff member's gym by the canonical sameGym() logic (gymId: null is the primary
// gym; see lib/gym-scope.ts).
//
// Fail closed: a template whose createdByStaffId is empty, or names an account
// that no longer exists, belongs to NO gym as far as tenant staff are concerned —
// it is neither listed nor editable nor deletable. (A creator who was merely
// archived still resolves to their gym, so the gym keeps its templates.) Legacy
// records are never migrated or re-owned here.
//
// Nothing in this module takes a gym or tenant identifier from a request: the
// acting staff member's gym always comes from their own account.
import { findClassWorkoutTemplates, type ClassWorkoutTemplateRecord } from "./db";
import { sameGymAsStaff } from "./gym-scope";

type Staff = { gymId?: string | null };

export function templateInStaffGym(staff: Staff, template: Pick<ClassWorkoutTemplateRecord, "createdByStaffId">): boolean {
  return !!template.createdByStaffId && sameGymAsStaff(staff, template.createdByStaffId);
}

// Every template the acting staff member's gym owns, name-sorted (as
// findClassWorkoutTemplates already returns them). The creator lookup is
// memoized per call, so a long list costs one account read per distinct creator
// rather than one per template.
export function findClassWorkoutTemplatesForStaff(staff: Staff): ClassWorkoutTemplateRecord[] {
  const verdictByCreator = new Map<string, boolean>();

  return findClassWorkoutTemplates().filter((template) => {
    const creatorId = template.createdByStaffId;
    if (!creatorId) return false;

    let inGym = verdictByCreator.get(creatorId);
    if (inGym === undefined) {
      inGym = sameGymAsStaff(staff, creatorId);
      verdictByCreator.set(creatorId, inGym);
    }
    return inGym;
  });
}
