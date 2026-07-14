import { ensureSeriesOccurrences } from "@/lib/class-series";
import type { JobDefinition } from "./types";

// Keeps the rolling window of recurring-class occurrences topped up. The
// staff Classes page also tops up on load, so this job is the guarantee
// that the window never drains even if nobody opens that page.
export const generateClassSeriesJob: JobDefinition = {
  name: "generate-class-series",
  description: "Generates upcoming occurrences for recurring class series on a rolling horizon.",
  async run() {
    const created = ensureSeriesOccurrences();
    return created === 0
      ? "Recurring class schedule is already fully generated."
      : `Generated ${created} upcoming class occurrence${created === 1 ? "" : "s"}.`;
  },
};
