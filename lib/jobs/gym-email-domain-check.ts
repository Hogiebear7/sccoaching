import { findGyms } from "@/lib/db";
import { refreshGymEmailDomain } from "@/lib/gym-email-domain-sync";
import type { JobDefinition } from "./types";

// Re-checks every gym email domain that is still waiting for its DNS records, so a gym's mail starts using its own domain by itself once the records are in place. No manual step.
export const gymEmailDomainCheckJob: JobDefinition = {
  name: "gym-email-domain-check",
  description: "Re-checks gym email domains that are not verified yet and switches a gym to its own domain once it is.",
  async run() {
    const waiting = findGyms().filter((g) => g.emailDomain && g.emailDomain.status !== "verified");
    let verified = 0;
    let failed = 0;
    for (const gym of waiting) {
      const result = await refreshGymEmailDomain(gym, true);
      if (!result.ok) failed += 1;
      else if (result.gym.emailDomain?.status === "verified") verified += 1;
    }
    return `Checked ${waiting.length} waiting domain${waiting.length === 1 ? "" : "s"}: ${verified} now verified, ${failed} could not be checked.`;
  },
};
