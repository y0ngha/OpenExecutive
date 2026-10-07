// The Home screen's wording: the greeting, the one-line summary that replaced
// the row of status pills, and the single status chip a collapsed proposal
// card keeps. Kept apart from the components so `npm test` can check it (see
// scripts/briefingSummary.test.mjs). No imports, so the test can load this
// under `node --experimental-strip-types`.

import { t, tp } from "../i18n/index.ts";

/** "Good morning" before noon, "Good afternoon" until 6pm, then "Good evening". */
export function greeting(firstName: string | undefined, now: Date = new Date()): string {
  const h = now.getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = firstName?.trim();
  return name ? t(`lib.greeting.${part}Name` as const, { name }) : t(`lib.greeting.${part}` as const);
}

/** Where a summary phrase leads: a lane on the page, one of the tiles' side
 * panels, or another route. */
export type SummaryTarget =
  | { kind: "needsYou" }
  | { kind: "panel"; panel: "handled" | "people" | "departments" | "inFlight" | "monitoring" }
  | { kind: "href"; href: string };

export interface SummaryPart {
  text: string;
  target: SummaryTarget;
}

export interface SummaryCounts {
  needsYou: number;
  handledOvernight: number;
  peopleOverdue: number;
  peopleNeedReply: number;
  deptAtRisk: number;
  /** Solo only: at-risk + off-track goals, which have no tile on the page. */
  goalsAtRisk?: number;
  inFlight: number;
  monitoring: number;
}

/** The summary under the greeting, as phrases in the order they are read:
 * what needs you first, then what the Executive did on its own (trust and
 * relief), then the rest by urgency. Zero counts are dropped; an empty list
 * means all clear. Each phrase opens the detail it counts. */
export function briefingSummary(c: SummaryCounts): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (c.needsYou > 0)
    parts.push({
      text: tp("lib.summary.needsYou", c.needsYou),
      target: { kind: "needsYou" },
    });
  if (c.handledOvernight > 0)
    parts.push({
      text: t("lib.summary.handled", { n: c.handledOvernight }),
      target: { kind: "panel", panel: "handled" },
    });
  if (c.peopleOverdue > 0)
    parts.push({ text: t("lib.summary.overdue", { n: c.peopleOverdue }), target: { kind: "panel", panel: "people" } });
  if (c.peopleNeedReply > 0)
    parts.push({
      text: t("lib.summary.awaitingReply", { n: c.peopleNeedReply }),
      target: { kind: "panel", panel: "people" },
    });
  if (c.deptAtRisk > 0)
    parts.push({
      text: tp("lib.summary.deptAtRisk", c.deptAtRisk),
      target: { kind: "panel", panel: "departments" },
    });
  if (c.goalsAtRisk && c.goalsAtRisk > 0)
    parts.push({
      text: tp("lib.summary.goalsAtRisk", c.goalsAtRisk),
      target: { kind: "href", href: "/goals" },
    });
  if (c.inFlight > 0)
    parts.push({ text: t("lib.summary.underWay", { n: c.inFlight }), target: { kind: "panel", panel: "inFlight" } });
  if (c.monitoring > 0)
    parts.push({
      text: tp("lib.summary.monitored", c.monitoring),
      target: { kind: "panel", panel: "monitoring" },
    });
  return parts;
}

/** Compact age label ("3h", "9d") for a card chip; "" for an unparseable stamp. */
export function ageLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - at) / 60000));
  if (mins < 60) return t("lib.age.minutes", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t("lib.age.hours", { n: hours });
  return t("lib.age.days", { n: Math.round(hours / 24) });
}

/** Whole days between now and an ISO stamp: 0 = due within the day, negative =
 * past (floor, so an 11-hour-old deadline is -1 → "overdue", never "due
 * today"). null if unparseable. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.floor((at - now.getTime()) / 86400000);
}

export type ChipTone = "rose" | "amber" | "neutral";

/** The one status chip a collapsed proposal card shows: its deadline when it
 * has one (overdue in red), else "Likely stale" when the review says so, else
 * how long it has waited. The full chip row shows when the card is opened. */
export function proposalStatusChip(
  p: { due_at?: string | null; review_verdict?: string; created_at: string },
  now: Date = new Date(),
): { label: string; tone: ChipTone } | null {
  const dueIn = daysUntil(p.due_at, now);
  if (dueIn != null) {
    if (dueIn < 0) return { label: t("lib.chip.overdue"), tone: "rose" };
    return { label: dueIn === 0 ? t("lib.due.today") : t("lib.chip.dueIn", { n: dueIn }), tone: "amber" };
  }
  if ((p.review_verdict ?? "") === "likely_stale") return { label: t("lib.chip.likelyStale"), tone: "amber" };
  const age = ageLabel(p.created_at, now);
  return age ? { label: t("lib.chip.age", { age }), tone: "neutral" } : null;
}
