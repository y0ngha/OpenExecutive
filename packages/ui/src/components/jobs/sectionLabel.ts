import type { WorkflowSection } from "@/lib/api";
import { t, type MessageKey } from "@/i18n/index.ts";

// Display names for workflow sections; the section value itself is what the API stores.
const SECTION_LABEL: Record<WorkflowSection, MessageKey> = {
  Board: "jobs.section.board",
  "Capital & Investors": "jobs.section.capital",
  "Growth & GTM": "jobs.section.growth",
  Product: "jobs.section.product",
  People: "jobs.section.people",
  "Risk, Legal & Crisis": "jobs.section.risk",
  "Operating Cadence": "jobs.section.operating",
};

/** The shown name of a section; unknown sections show as they are. */
export function sectionLabel(section: string): string {
  const key = (SECTION_LABEL as Record<string, MessageKey>)[section];
  return key ? t(key) : section;
}
