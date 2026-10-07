import { t } from "../i18n/index.ts";

/**
 * Shared "N units ago" formatter — extracted from RecentSessions/
 * DynamicSection/jobs/evals where the same function had been copy-pasted.
 *
 * Renders an ISO timestamp as the most-significant non-zero unit:
 *   - "just now"   if  < 1 minute
 *   - "{m}m ago"   if  < 1 hour
 *   - "{h}h ago"   if  < 1 day
 *   - "{d}d ago"   otherwise
 *
 * Empty input returns "" so callers can fall through to a "Never …" label
 * without sprinkling guards everywhere. Invalid input falls back to ""
 * for the same reason; we never throw from a display helper.
 */
export function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("lib.relative.justNow");
  if (mins < 60) return t("lib.relative.minutesAgo", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("lib.relative.hoursAgo", { n: hrs });
  return t("lib.relative.daysAgo", { n: Math.floor(hrs / 24) });
}
