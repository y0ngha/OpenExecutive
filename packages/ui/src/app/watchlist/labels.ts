import { t, type MessageKey } from "@/i18n/index.ts";

// Shown names for the watchlist's enum values. The values themselves are what
// the API stores; unknown values show as they are.
const LABELS: Record<string, MessageKey> = {
  real_time: "jobs.watch.cadenceRealTime",
  "15min": "jobs.watch.cadence15min",
  hourly: "jobs.watch.cadenceHourly",
  daily: "jobs.watch.cadenceDaily",
  weekly: "jobs.watch.cadenceWeekly",
  low: "jobs.watch.severityLow",
  medium: "jobs.watch.severityMedium",
  high: "jobs.watch.severityHigh",
  urgent: "jobs.watch.severityUrgent",
  active: "jobs.watch.modeActive",
  dry_run: "jobs.watch.modeDryRun",
};

/** Display label for a cadence, severity or mode value. */
export function valueLabel(value: string): string {
  const key = LABELS[value];
  return key ? t(key) : value;
}
