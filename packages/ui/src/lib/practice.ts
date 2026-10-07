// Shared presentation helpers for practice-cockpit cards, used by both the
// /clients cockpit board and the briefing's "Across your clients" panel so
// the two surfaces can never drift.

import { displayLocale, t } from "../i18n/index.ts";
import type { ClientCockpitCard } from "@/lib/api";

// Renewal badge thresholds (days until renewal_date).
export const RENEWAL_WARN_DAYS = 30;
export const RENEWAL_URGENT_DAYS = 7;

export function renewalBadge(
  daysToRenewal: number | null | undefined,
): { label: string; urgent: boolean } | null {
  if (typeof daysToRenewal !== "number" || daysToRenewal > RENEWAL_WARN_DAYS) {
    return null;
  }
  return {
    label: daysToRenewal <= 0 ? t("lib.practice.renewalDue") : t("lib.practice.renewalIn", { n: daysToRenewal }),
    urgent: daysToRenewal <= RENEWAL_URGENT_DAYS,
  };
}

// One-line status summary for a card: counts that need attention, or the
// card's degraded/inactive state, plus the staleness stamp for parked cards.
export function clientCountsSummary(c: ClientCockpitCard): string {
  if (c.error) return t("lib.practice.unavailable");
  if (!c.has_state) return t("lib.practice.notActivated");
  const counts =
    [
      c.overdue_actions ? t("lib.summary.overdue", { n: c.overdue_actions }) : null,
      c.awaiting_replies ? t("lib.summary.awaitingReply", { n: c.awaiting_replies }) : null,
      c.unread_alerts ? t("lib.practice.alerts", { n: c.unread_alerts }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("lib.practice.allQuiet");
  const stamp =
    !c.is_active && c.saved_at
      ? ` · ${t("lib.practice.asOf", { date: new Date(c.saved_at).toLocaleDateString(displayLocale()) })}`
      : "";
  return counts + stamp;
}
