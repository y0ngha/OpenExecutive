// Pure helpers for the "Your month" card and screen on Pulse
// (components/memories/ValueSection.tsx). Kept free of React so
// scripts/valueSummary.test.mjs can run them under plain node.

import { t, tp, type PluralKey } from "../i18n/index.ts";

export interface ValueLineLike {
  key: string;
  label: string;
  count: number;
  previous: number;
}

// The lines the overview card's one sentence names, in order, and how each
// reads with its number in front.
const HEADLINE: { key: string; label: PluralKey }[] = [
  { key: "messages_sent", label: "people.value.headline.messagesSent" },
  { key: "inbox_sent", label: "people.value.headline.inboxSent" },
  { key: "meetings_booked", label: "people.value.headline.meetingsBooked" },
  { key: "reports", label: "people.value.headline.reports" },
  { key: "follow_ups", label: "people.value.headline.followUps" },
  { key: "tasks_closed", label: "people.value.headline.tasksClosed" },
  { key: "answered", label: "people.value.headline.answered" },
];

/** "42 messages sent, 6 reports, 3 meetings booked": up to `max` non-zero
 * headline lines, or "" when there are none. */
export function headline(lines: ValueLineLike[], max = 3): string {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const parts: string[] = [];
  for (const h of HEADLINE) {
    const line = byKey.get(h.key);
    if (!line || line.count <= 0) continue;
    parts.push(tp(h.label, line.count));
    if (parts.length >= max) break;
  }
  return parts.join(", ");
}

/** "+3", "−2" or "same" against the period before; "" when both are zero. */
export function deltaLabel(count: number, previous: number): string {
  if (count === 0 && previous === 0) return "";
  const diff = count - previous;
  if (diff === 0) return t("people.value.same");
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

/** Lines with something in this period or the one before; the rest is noise. */
export function visibleLines<T extends ValueLineLike>(lines: T[]): T[] {
  return lines.filter((l) => l.count > 0 || l.previous > 0);
}
